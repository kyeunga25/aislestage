import { getAgentByName } from 'agents'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { CampaignAgent } from './agents/CampaignAgent'
import { bytesToBase64, CAMPAIGN_COMPOSITION_VERSION, CAMPAIGN_OUTPUT_CONTENT_TYPE, composeCampaignSvg, validateCompositionInput } from './lib/campaign-compositor'
import { sanitizeCampaignBrief } from './lib/campaign-agent'
import { OpenAICopyProvider, OpenAIImageProvider } from './lib/providers'
import { workflowById } from './lib/workflows'
import type { GenerationInput } from './lib/types'

export { CampaignAgent }

export type Env = Omit<WorkerEnv, 'GENERATION_QUEUE'> & {
  GENERATION_QUEUE: Queue<GenerationMessage>
  OPENAI_API_KEY?: string
  INITIAL_OUTPUT_ALLOWANCE?: string
  AUTH_MODE?: string
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  ACCESS_AUTO_PROVISION?: string
}

export type GenerationMessage = { generationId: string; input: GenerationInput }
type AccountStatus = 'active' | 'suspended' | 'deactivated'
type AccountType = 'standard' | 'beta' | 'test'
type AuthUser = { id: string; email: string; name: string; accountStatus: AccountStatus; accountType: AccountType }
type Workspace = { id: string; name: string; role: string; accessStatus: 'active' | 'paused'; availableOutputs: number; reservedOutputs: number }
type SessionContext = { user: AuthUser; currentWorkspace: Workspace }
type AccessIdentity = { subject: string; email: string; name: string }
type AccessFailureCode = 'authentication-required' | 'membership-required' | 'configuration-error'
// One generated output consumes one technical allowance unit for idempotent accounting.
const OUTPUT_COST = 1
const SESSION_COOKIE = 'aislepack_session'
const SESSION_DAYS = 60
const PASSWORD_ITERATIONS = 100_000
const LOGIN_WINDOW_MINUTES = 15
const LOGIN_EMAIL_IP_LIMIT = 8
const LOGIN_IP_LIMIT = 30
const REGISTER_WINDOW_MINUTES = 60
const REGISTER_IP_LIMIT = 12
const MAX_AUTH_BODY_BYTES = 8_192
const MAX_GENERATION_BODY_BYTES = 32_768
const MAX_AGENT_BODY_BYTES = 48_000
const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_UPLOAD_REQUEST_BYTES = MAX_PRODUCT_IMAGE_BYTES + 64 * 1024
const MAX_AUTH_ATTEMPT_DAYS = 7
const RETRYING_GENERATION_MESSAGE = '素材處理暫時未能完成，系統會自動重試。'
const FAILED_GENERATION_MESSAGE = '素材未能完成，可用輸出數已自動退回。'
const DUMMY_PASSWORD_SALT = 'YWlzbGVwYWNrLXB1YmxpYy1zYWx0'
const DUMMY_PASSWORD_HASH = 'P/FKiXHHJRFZsQ7MLmqKMp+SQoYtsIWL8P2EkVxfWsE='
const accessJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

const json = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8')
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(JSON.stringify(body), { ...init, headers })
}

const textEncoder = new TextEncoder()

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

async function sha256(value: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(value))))
}

async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS }, key, 256)
  return { hash: base64(new Uint8Array(bits)), salt: base64(salt) }
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = textEncoder.encode(left)
  const rightBytes = textEncoder.encode(right)
  const subtle = crypto.subtle as unknown as SubtleCrypto & { timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean }
  return leftBytes.length === rightBytes.length && subtle.timingSafeEqual(leftBytes, rightBytes)
}

async function verifyPassword(password: string, storedHash: string, storedSalt: string) {
  const { hash } = await hashPassword(password, fromBase64(storedSalt))
  return constantTimeEqual(hash, storedHash)
}

function parseCookie(request: Request, name: string) {
  const cookie = request.headers.get('cookie')
  if (!cookie) return null
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return null
}

function sessionCookie(token: string, request: Request) {
  const hostname = new URL(request.url).hostname
  const secure = hostname === 'localhost' || hostname === '127.0.0.1' ? '' : '; Secure'
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure}`
}

function expiredSessionCookie(request: Request) {
  const hostname = new URL(request.url).hostname
  const secure = hostname === 'localhost' || hostname === '127.0.0.1' ? '' : '; Secure'
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function cleanString(value: unknown, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

async function readBody(request: Request, maxBytes: number) {
  const contentLength = Number(request.headers.get('content-length') || '0')
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return { body: null, tooLarge: true }
  const raw = await request.text().catch(() => '')
  if (textEncoder.encode(raw).byteLength > maxBytes) return { body: null, tooLarge: true }
  try {
    return { body: JSON.parse(raw) as unknown, tooLarge: false }
  } catch {
    return { body: null, tooLarge: false }
  }
}

function getClientIp(request: Request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}

function hasJsonContent(request: Request) {
  return request.headers.get('content-type')?.toLowerCase().includes('application/json') ?? false
}

function validEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isAllowedOrigin(request: Request, env: Env) {
  const url = new URL(request.url)
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  const allowedOrigins = new Set([url.origin])
  if (env.APP_ORIGIN) allowedOrigins.add(env.APP_ORIGIN)
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') allowedOrigins.add(`${url.protocol}//${url.host}`)
  if (origin && !allowedOrigins.has(origin)) return false
  if (!origin && fetchSite === 'cross-site') return false
  return true
}

async function recordAuthAttempt(env: Env, request: Request, eventType: 'login_failed' | 'login_success' | 'register_failed' | 'register_success' | 'rate_limited', email = '') {
  const [emailKey, ipKey] = await Promise.all([email ? sha256(email) : '', sha256(getClientIp(request))])
  await env.DB.prepare('INSERT INTO auth_attempts (id, email, ip_address, event_type) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), emailKey, ipKey, eventType).run()
}

async function authAttemptCount(env: Env, request: Request, options: { email?: string; eventTypes: string[]; minutes: number }) {
  const ip = await sha256(getClientIp(request))
  const email = options.email ? await sha256(options.email) : ''
  const placeholders = options.eventTypes.map(() => '?').join(',')
  const bindings: unknown[] = options.email ? [email, ip, ...options.eventTypes, `-${options.minutes} minutes`] : [ip, ...options.eventTypes, `-${options.minutes} minutes`]
  const result = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM auth_attempts
    WHERE ${options.email ? 'email = ? AND ip_address = ?' : 'ip_address = ?'}
      AND event_type IN (${placeholders})
      AND created_at >= datetime('now', ?)
  `).bind(...bindings).first<{ count: number }>()
  return result?.count ?? 0
}

async function isLoginRateLimited(env: Env, request: Request, email: string) {
  const emailIpFailures = await authAttemptCount(env, request, { email, eventTypes: ['login_failed', 'rate_limited'], minutes: LOGIN_WINDOW_MINUTES })
  if (emailIpFailures >= LOGIN_EMAIL_IP_LIMIT) return true
  const ipFailures = await authAttemptCount(env, request, { eventTypes: ['login_failed', 'rate_limited'], minutes: LOGIN_WINDOW_MINUTES })
  return ipFailures >= LOGIN_IP_LIMIT
}

async function isRegisterRateLimited(env: Env, request: Request) {
  const ipAttempts = await authAttemptCount(env, request, { eventTypes: ['register_failed', 'register_success', 'rate_limited'], minutes: REGISTER_WINDOW_MINUTES })
  return ipAttempts >= REGISTER_IP_LIMIT
}

function boundedString(value: unknown, max: number, required = true) {
  return typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0)
}

function boundedStringArray(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => boundedString(item, maxLength, false))
}

function initialOutputAllowance(env: Env) {
  const value = Number(env.INITIAL_OUTPUT_ALLOWANCE)
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function registrationMode(env: Env) {
  return env.REGISTRATION_MODE === 'open' || env.REGISTRATION_MODE === 'invite' ? env.REGISTRATION_MODE : 'closed'
}

function authMode(env: Env): 'access' | 'password' {
  return env.AUTH_MODE === 'access' ? 'access' : 'password'
}

function accessError(code: AccessFailureCode, status: 401 | 403 | 503, message: string) {
  return json({ authenticated: false, code, error: message }, { status })
}

function accessConfiguration(env: Env) {
  const rawDomain = env.ACCESS_TEAM_DOMAIN?.trim() || ''
  const audience = env.ACCESS_AUD?.trim() || ''
  try {
    const domain = new URL(rawDomain)
    const validDomain = domain.protocol === 'https:'
      && domain.hostname.endsWith('.cloudflareaccess.com')
      && domain.pathname === '/'
      && !domain.search
      && !domain.hash
    if (!validDomain || !audience || audience.length > 512) return null
    return { teamDomain: domain.origin, audience }
  } catch {
    return null
  }
}

function identityFromPayload(payload: JWTPayload): AccessIdentity | null {
  const subject = cleanString(payload.sub, 512)
  const email = normalizeEmail(payload.email)
  const name = cleanString(payload.name || payload.common_name, 120) || email.split('@')[0]
  if (!subject || !validEmail(email)) return null
  return { subject, email, name }
}

async function verifyAccessIdentity(request: Request, env: Env): Promise<AccessIdentity | Response> {
  const configuration = accessConfiguration(env)
  if (!configuration) return accessError('configuration-error', 503, 'Access configuration is unavailable.')
  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token) return accessError('authentication-required', 401, 'Cloudflare Access authentication is required.')
  try {
    let jwks = accessJwks.get(configuration.teamDomain)
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`${configuration.teamDomain}/cdn-cgi/access/certs`))
      accessJwks.set(configuration.teamDomain, jwks)
    }
    const { payload } = await jwtVerify(token, jwks, {
      issuer: configuration.teamDomain,
      audience: configuration.audience,
      algorithms: ['RS256']
    })
    const identity = identityFromPayload(payload)
    return identity || accessError('authentication-required', 401, 'Cloudflare Access identity is incomplete.')
  } catch {
    return accessError('authentication-required', 401, 'Cloudflare Access authentication is invalid.')
  }
}

function generationMode(env: Env): 'disabled' | 'deterministic' | 'assisted' {
  if (env.GENERATION_MODE === 'deterministic') return 'deterministic'
  if ((env.GENERATION_MODE === 'assisted' || env.GENERATION_MODE === 'enabled') && env.OPENAI_API_KEY) return 'assisted'
  return 'disabled'
}

function validInput(value: unknown): value is GenerationInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<GenerationInput>
  const workflowIds = new Set(['store-main', 'detail-banner', 'promo-poster', 'meta-ad', 'package-showcase'])
  const ratios = new Set(['1:1', '4:5', '9:16', '16:5'])
  return boundedString(input.workspaceId, 64)
    && typeof input.workflowId === 'string' && workflowIds.has(input.workflowId)
    && typeof input.aspectRatio === 'string' && ratios.has(input.aspectRatio)
    && Number.isSafeInteger(input.approvedRevision) && Number(input.approvedRevision) > 0
    && boundedString(input.intent, 120, false)
    && boundedString(input.brand?.name, 120)
    && boundedString(input.brand?.tone, 240, false)
    && boundedStringArray(input.brand?.colors, 8, 24)
    && boundedString(input.brand?.forbiddenWords, 500, false)
    && (input.brand?.locale === 'zh-Hant' || input.brand?.locale === 'en')
    && boundedString(input.brand?.cta, 120, false)
    && boundedString(input.brand?.ctaEn, 120, false)
    && boundedString(input.product?.name, 160)
    && boundedString(input.product?.nameEn, 160)
    && boundedString(input.product?.category, 120)
    && boundedStringArray(input.product?.benefits, 8, 240)
    && boundedStringArray(input.product?.benefitsEn, 8, 240)
    && boundedString(input.product?.specifications, 1_000, false)
    && boundedString(input.product?.price, 120, false)
    && boundedString(input.product?.promotion, 240, false)
    && boundedString(input.product?.promotionEn, 240, false)
    && boundedStringArray(input.product?.channels, 12, 80)
    && Array.isArray(input.referenceImageUrls) && input.referenceImageUrls.length === 0
    && boundedStringArray(input.referenceAssetIds, 1, 80) && input.referenceAssetIds?.length === 1
}

const productImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])

function hasValidProductImageSignature(contentType: string, bytes: Uint8Array) {
  if (contentType === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (contentType === 'image/webp') return bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  return false
}

function chunkName(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + 4))
}

function hasPrivateImageMetadata(contentType: string, bytes: Uint8Array) {
  if (contentType === 'image/jpeg') {
    let offset = 2
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0xe1 || marker === 0xed || marker === 0xfe) return true
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
      if (length < 2) break
      offset += length + 2
    }
    return false
  }
  if (contentType === 'image/png') {
    const metadataChunks = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt'])
    let offset = 8
    while (offset + 12 <= bytes.length) {
      const length = ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]
      if (metadataChunks.has(chunkName(bytes, offset + 4))) return true
      offset += 12 + length
    }
    return false
  }
  if (contentType === 'image/webp') {
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const name = chunkName(bytes, offset)
      if (name === 'EXIF' || name === 'XMP ') return true
      const length = bytes[offset + 4] + (bytes[offset + 5] << 8) + (bytes[offset + 6] << 16) + ((bytes[offset + 7] << 24) >>> 0)
      offset += 8 + length + (length % 2)
    }
  }
  return false
}

function extensionForContentType(contentType: string) {
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  return 'jpg'
}

async function sessionResponse(env: Env, request: Request, userId: string, status = 200) {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await sha256(token)
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(tokenHash, userId, expiresAt).run()
  const session = await loadSessionByHash(env, tokenHash)
  if (!session) return json({ error: 'Unable to create session.' }, { status: 503 })
  return json({ user: session.user, currentWorkspace: session.currentWorkspace }, { status, headers: { 'set-cookie': sessionCookie(token, request) } })
}

async function workspacesForUser(env: Env, userId: string) {
  const result = await env.DB.prepare(`
    SELECT w.id, w.name, w.access_status AS accessStatus, wm.role, COALESCE(oa.available, 0) AS availableOutputs, COALESCE(oa.reserved, 0) AS reservedOutputs
    FROM workspace_memberships wm
    JOIN workspaces w ON w.id = wm.workspace_id
    LEFT JOIN output_allowances oa ON oa.workspace_id = w.id
    WHERE wm.user_id = ? AND w.access_status = 'active'
    ORDER BY wm.created_at ASC
  `).bind(userId).all<Workspace>()
  return result.results
}

async function loadSessionByHash(env: Env, tokenHash: string): Promise<SessionContext | null> {
  const user = await env.DB.prepare(`
    SELECT u.id, u.email, u.name, u.account_status AS accountStatus, u.account_type AS accountType
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.account_status = 'active'
  `).bind(tokenHash).first<AuthUser>()
  if (!user) return null
  const workspaces = await workspacesForUser(env, user.id)
  if (!workspaces[0]) return null
  await env.DB.prepare('UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?').bind(tokenHash).run()
  return { user, currentWorkspace: workspaces[0] }
}

async function accessSession(request: Request, env: Env): Promise<SessionContext | Response> {
  const identity = await verifyAccessIdentity(request, env)
  if (identity instanceof Response) return identity
  const subjectHash = await sha256(identity.subject)
  let user = await env.DB.prepare(`
    SELECT id, email, name, account_status AS accountStatus, account_type AS accountType
    FROM users
    WHERE access_subject_hash = ? AND auth_mode = 'access' AND account_status = 'active'
  `).bind(subjectHash).first<AuthUser>()

  if (user && normalizeEmail(user.email) !== identity.email) {
    return accessError('membership-required', 403, 'The verified identity does not match this workspace account.')
  }

  if (!user) {
    const emailAccount = await env.DB.prepare(`
      SELECT id, email, name, account_status AS accountStatus, account_type AS accountType,
        auth_mode AS authMode, access_subject_hash AS accessSubjectHash
      FROM users
      WHERE email = ?
    `).bind(identity.email).first<AuthUser & { authMode: 'password' | 'access'; accessSubjectHash: string | null }>()

    if (emailAccount) {
      if (emailAccount.accountStatus !== 'active' || (emailAccount.accessSubjectHash && emailAccount.accessSubjectHash !== subjectHash)) {
        return accessError('membership-required', 403, 'This identity does not have an active workspace membership.')
      }
      await env.DB.prepare(`
        UPDATE users
        SET access_subject_hash = ?, auth_mode = 'access', name = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND (access_subject_hash IS NULL OR access_subject_hash = ?)
      `).bind(subjectHash, identity.name, emailAccount.id, subjectHash).run()
      user = await env.DB.prepare(`
        SELECT id, email, name, account_status AS accountStatus, account_type AS accountType
        FROM users
        WHERE id = ? AND email = ? AND access_subject_hash = ? AND auth_mode = 'access' AND account_status = 'active'
      `).bind(emailAccount.id, identity.email, subjectHash).first<AuthUser>()
    } else if (env.ACCESS_AUTO_PROVISION === 'enabled') {
      const userId = crypto.randomUUID()
      const workspaceId = crypto.randomUUID()
      const randomPassword = base64Url(crypto.getRandomValues(new Uint8Array(32)))
      const passwordHash = await hashPassword(randomPassword)
      try {
        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO users (id, email, name, password_hash, password_salt, account_type, auth_mode, access_subject_hash)
            VALUES (?, ?, ?, ?, ?, 'beta', 'access', ?)
          `).bind(userId, identity.email, identity.name, passwordHash.hash, passwordHash.salt, subjectHash),
          env.DB.prepare('INSERT INTO workspaces (id, owner_user_id, name, plan_status, access_status) VALUES (?, ?, ?, ?, ?)').bind(workspaceId, userId, 'AislePack 工作區', 'active', 'active'),
          env.DB.prepare('INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (?, ?, ?)').bind(workspaceId, userId, 'owner'),
          env.DB.prepare('INSERT INTO output_allowances (workspace_id, available, reserved) VALUES (?, ?, 0)').bind(workspaceId, initialOutputAllowance(env))
        ])
      } catch {
        // A concurrent first request may have provisioned the same identity.
      }
      user = await env.DB.prepare(`
        SELECT id, email, name, account_status AS accountStatus, account_type AS accountType
        FROM users
        WHERE access_subject_hash = ? AND email = ? AND auth_mode = 'access' AND account_status = 'active'
      `).bind(subjectHash, identity.email).first<AuthUser>()
    }
  }

  if (!user) return accessError('membership-required', 403, 'This Access identity has not been invited to an AislePack workspace.')
  const workspaces = await workspacesForUser(env, user.id)
  if (!workspaces[0]) return accessError('membership-required', 403, 'This account has no active workspace membership.')
  return { user, currentWorkspace: workspaces[0] }
}

async function cleanExpiredSessions(env: Env) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP'),
    env.DB.prepare("DELETE FROM auth_attempts WHERE created_at < datetime('now', ?)").bind(`-${MAX_AUTH_ATTEMPT_DAYS} days`)
  ])
}

async function requireSession(request: Request, env: Env): Promise<SessionContext | Response> {
  if (authMode(env) === 'access') return accessSession(request, env)
  const token = parseCookie(request, SESSION_COOKIE)
  if (!token) return json({ error: 'Authentication required.' }, { status: 401 })
  const session = await loadSessionByHash(env, await sha256(token))
  if (!session) return json({ error: 'Authentication required.' }, { status: 401, headers: { 'set-cookie': expiredSessionCookie(request) } })
  return session
}

async function getWorkspace(env: Env, userId: string, workspaceId: string) {
  return env.DB.prepare(`
    SELECT w.id, w.name, w.access_status AS accessStatus, wm.role, COALESCE(oa.available, 0) AS availableOutputs, COALESCE(oa.reserved, 0) AS reservedOutputs
    FROM workspace_memberships wm
    JOIN workspaces w ON w.id = wm.workspace_id
    LEFT JOIN output_allowances oa ON oa.workspace_id = w.id
    WHERE wm.user_id = ? AND wm.workspace_id = ? AND w.access_status = 'active'
  `).bind(userId, workspaceId).first<Workspace>()
}

async function uploadProductAsset(request: Request, env: Env, session: SessionContext) {
  const contentLength = Number(request.headers.get('content-length') || '0')
  if (contentLength > MAX_UPLOAD_REQUEST_BYTES) return json({ error: '圖片檔案不可超過 4 MB。' }, { status: 413 })
  if (!request.headers.get('content-type')?.toLowerCase().includes('multipart/form-data')) return json({ error: 'Expected multipart/form-data.' }, { status: 415 })

  const form = await request.formData().catch(() => null)
  const value = form?.get('file')
  if (!(value instanceof File)) return json({ error: '請選擇商品圖片。' }, { status: 400 })
  if (!productImageTypes.has(value.type)) return json({ error: '只支援 PNG、JPEG 或 WebP 圖片。' }, { status: 415 })
  if (value.size <= 0 || value.size > MAX_PRODUCT_IMAGE_BYTES) return json({ error: '圖片檔案不可超過 4 MB。' }, { status: 413 })

  const bytes = new Uint8Array(await value.arrayBuffer())
  if (!hasValidProductImageSignature(value.type, bytes)) return json({ error: '圖片內容與檔案格式不符。' }, { status: 415 })
  if (hasPrivateImageMetadata(value.type, bytes)) return json({ error: '圖片含有 EXIF、XMP 或文字 metadata；請先移除隱藏資料再上傳。' }, { status: 400 })

  const assetId = crypto.randomUUID()
  const storedFilename = `product-image.${extensionForContentType(value.type)}`
  const objectKey = `workspaces/${session.currentWorkspace.id}/assets/product-source/${assetId}.${extensionForContentType(value.type)}`
  await env.MEDIA_BUCKET.put(objectKey, bytes, {
    httpMetadata: { contentType: value.type },
    customMetadata: { kind: 'product-source', workspaceId: session.currentWorkspace.id }
  })

  try {
    await env.DB.prepare(`
      INSERT INTO media_assets (id, workspace_id, created_by_user_id, kind, object_key, original_filename, content_type, size_bytes)
      VALUES (?, ?, ?, 'product-source', ?, ?, ?, ?)
    `).bind(assetId, session.currentWorkspace.id, session.user.id, objectKey, storedFilename, value.type, value.size).run()
  } catch {
    await env.MEDIA_BUCKET.delete(objectKey).catch(() => null)
    return json({ error: '未能儲存商品圖片。' }, { status: 503 })
  }

  return json({
    asset: {
      id: assetId,
      name: storedFilename,
      contentType: value.type,
      sizeBytes: value.size,
      previewUrl: `/api/assets/${assetId}`
    }
  }, { status: 201 })
}

async function productAsset(request: Request, env: Env, session: SessionContext, assetId: string) {
  const asset = await env.DB.prepare(`
    SELECT a.object_key AS objectKey, a.content_type AS contentType
    FROM media_assets a
    JOIN workspace_memberships wm ON wm.workspace_id = a.workspace_id
    WHERE a.id = ? AND wm.user_id = ? AND a.kind = 'product-source'
  `).bind(assetId, session.user.id).first<{ objectKey: string; contentType: string }>()
  if (!asset) return json({ error: 'Image not found.' }, { status: 404 })
  const object = await env.MEDIA_BUCKET.get(asset.objectKey)
  if (!object) return json({ error: 'Image not found.' }, { status: 404 })
  return new Response(object.body, { headers: { 'content-type': asset.contentType, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } })
}

async function deleteProductAsset(env: Env, session: SessionContext, assetId: string) {
  const asset = await env.DB.prepare(`
    SELECT a.object_key AS objectKey, a.workspace_id AS workspaceId
    FROM media_assets a
    JOIN workspace_memberships wm ON wm.workspace_id = a.workspace_id
    JOIN workspaces w ON w.id = a.workspace_id
    WHERE a.id = ? AND wm.user_id = ? AND a.kind = 'product-source' AND w.access_status = 'active'
  `).bind(assetId, session.user.id).first<{ objectKey: string; workspaceId: string }>()
  if (!asset) return json({ error: 'Image not found.' }, { status: 404 })
  try {
    const agent = await getAgentByName(env.CAMPAIGN_AGENT, asset.workspaceId)
    await agent.resetPlan()
    await env.MEDIA_BUCKET.delete(asset.objectKey)
    await env.DB.prepare('DELETE FROM media_assets WHERE id = ? AND workspace_id = ?').bind(assetId, asset.workspaceId).run()
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  } catch {
    return json({ error: '未能刪除商品圖片。' }, { status: 503 })
  }
}

async function campaignAgentRequest(request: Request, env: Env, session: SessionContext, action: 'state' | 'plan' | 'approve') {
  const agent = await getAgentByName(env.CAMPAIGN_AGENT, session.currentWorkspace.id)
  try {
    if (request.method === 'GET' && action === 'state') return json({ state: await agent.getPlan() })
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, { status: 405 })
    if (!hasJsonContent(request)) return json({ error: 'Expected application/json.' }, { status: 415 })
    const parsed = await readBody(request, MAX_AGENT_BODY_BYTES)
    if (parsed.tooLarge) return json({ error: 'Campaign brief is too large.' }, { status: 413 })
    const body = parsed.body && typeof parsed.body === 'object' ? parsed.body as Record<string, unknown> : {}
    if (action === 'plan') return json({ state: await agent.planBrief(body.brief) })
    if (action === 'approve') {
      const result = await agent.approvePlan(Number(body.revision))
      return result.ok ? json({ state: result.state }) : json({ error: result.error }, { status: 409 })
    }
    return json({ error: 'Not found.' }, { status: 404 })
  } catch {
    console.error('campaign-agent-request-failed', { action })
    return json({ error: 'Campaign Agent 暫時未能完成這個動作。' }, { status: 503 })
  }
}

async function referenceAssetsBelongToWorkspace(env: Env, workspaceId: string, assetIds: string[]) {
  if (!assetIds.length) return true
  const placeholders = assetIds.map(() => '?').join(',')
  const result = await env.DB.prepare(`SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ? AND id IN (${placeholders}) AND kind = 'product-source'`)
    .bind(workspaceId, ...assetIds)
    .first<{ count: number }>()
  return result?.count === new Set(assetIds).size
}

async function approvedGenerationInput(env: Env, input: GenerationInput) {
  const agent = await getAgentByName(env.CAMPAIGN_AGENT, input.workspaceId)
  const state = await agent.getPlan()
  if (state.stage !== 'approved' || state.revision !== input.approvedRevision || !state.brief) return false
  const approvedOutput = state.plan.some((item) => item.selected && item.workflowId === input.workflowId && item.ratio === input.aspectRatio)
  if (!approvedOutput) return false
  const submittedBrief = sanitizeCampaignBrief({
    assetId: input.referenceAssetIds[0],
    intent: input.intent,
    brand: input.brand,
    product: input.product
  })
  return JSON.stringify(submittedBrief) === JSON.stringify(state.brief)
}

async function generationSourceAsset(env: Env, input: GenerationInput) {
  const asset = await env.DB.prepare(`
    SELECT object_key AS objectKey, content_type AS contentType
    FROM media_assets
    WHERE id = ? AND workspace_id = ? AND kind = 'product-source'
  `).bind(input.referenceAssetIds[0], input.workspaceId).first<{ objectKey: string; contentType: 'image/png' | 'image/jpeg' | 'image/webp' }>()
  if (!asset) throw new Error('Approved product asset is unavailable.')
  const object = await env.MEDIA_BUCKET.get(asset.objectKey)
  if (!object) throw new Error('Approved product asset is unavailable.')
  return {
    base64: bytesToBase64(new Uint8Array(await object.arrayBuffer())),
    contentType: asset.contentType
  }
}

async function register(request: Request, env: Env) {
  const mode = registrationMode(env)
  if (mode === 'closed') return json({ error: 'AislePack 現時只開放已有帳號登入。' }, { status: 403 })
  if (!hasJsonContent(request)) return json({ error: 'Expected application/json.' }, { status: 415 })
  const parsed = await readBody(request, MAX_AUTH_BODY_BYTES)
  if (parsed.tooLarge) return json({ error: 'Authentication payload is too large.' }, { status: 413 })
  const body = parsed.body as Record<string, unknown> | null
  const email = normalizeEmail(body?.email)
  const password = cleanString(body?.password, 256)
  const inviteCode = cleanString(body?.inviteCode, 256)
  const name = cleanString(body?.name) || email.split('@')[0]
  const workspaceName = cleanString(body?.workspaceName) || `${name} 的工作區`
  if (await isRegisterRateLimited(env, request)) {
    await recordAuthAttempt(env, request, 'rate_limited', email)
    return json({ error: '嘗試次數過多，請稍後再試。' }, { status: 429 })
  }
  if (!validEmail(email)) {
    await recordAuthAttempt(env, request, 'register_failed', email)
    return json({ error: '請輸入有效電郵地址。' }, { status: 400 })
  }
  if (password.length < 8) {
    await recordAuthAttempt(env, request, 'register_failed', email)
    return json({ error: '密碼至少需要 8 個字元。' }, { status: 400 })
  }

  let invite: { id: string; accountType: 'beta' | 'test' } | null = null
  if (mode === 'invite') {
    if (inviteCode.length < 12) {
      await recordAuthAttempt(env, request, 'register_failed', email)
      return json({ error: '請輸入有效的 Beta 邀請碼。' }, { status: 400 })
    }
    invite = await env.DB.prepare(`
      SELECT id, account_type AS accountType
      FROM beta_invites
      WHERE token_hash = ? AND recipient_hash = ? AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP
    `).bind(await sha256(inviteCode), await sha256(`${email}\n${inviteCode}`)).first<{ id: string; accountType: 'beta' | 'test' }>()
    if (!invite) {
      await recordAuthAttempt(env, request, 'register_failed', email)
      return json({ error: '邀請碼無效、已使用或與電郵不符。' }, { status: 403 })
    }
  }

  const userId = crypto.randomUUID()
  const workspaceId = crypto.randomUUID()
  const passwordHash = await hashPassword(password)
  try {
    const createUser = invite
      ? env.DB.prepare(`
        INSERT INTO users (id, email, name, password_hash, password_salt, account_type)
        SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM beta_invites
          WHERE id = ? AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP
        )
      `).bind(userId, email, name, passwordHash.hash, passwordHash.salt, invite.accountType, invite.id)
      : env.DB.prepare('INSERT INTO users (id, email, name, password_hash, password_salt, account_type) VALUES (?, ?, ?, ?, ?, ?)').bind(userId, email, name, passwordHash.hash, passwordHash.salt, 'standard')
    const statements = [
      createUser,
      env.DB.prepare('INSERT INTO workspaces (id, owner_user_id, name, plan_status, access_status) VALUES (?, ?, ?, ?, ?)').bind(workspaceId, userId, workspaceName, 'active', 'active'),
      env.DB.prepare('INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (?, ?, ?)').bind(workspaceId, userId, 'owner'),
      env.DB.prepare('INSERT INTO output_allowances (workspace_id, available, reserved) VALUES (?, ?, 0)').bind(workspaceId, initialOutputAllowance(env))
    ]
    if (invite) statements.push(env.DB.prepare(`
      UPDATE beta_invites
      SET status = 'used', used_by_user_id = ?, used_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).bind(userId, invite.id))
    await env.DB.batch(statements)
  } catch {
    await recordAuthAttempt(env, request, 'register_failed', email)
    return json({ error: invite ? '邀請註冊未能完成，請重新取得邀請。' : '這個電郵已經註冊。' }, { status: 409 })
  }
  await recordAuthAttempt(env, request, 'register_success', email)
  return sessionResponse(env, request, userId, 201)
}

async function login(request: Request, env: Env) {
  if (!hasJsonContent(request)) return json({ error: 'Expected application/json.' }, { status: 415 })
  const parsed = await readBody(request, MAX_AUTH_BODY_BYTES)
  if (parsed.tooLarge) return json({ error: 'Authentication payload is too large.' }, { status: 413 })
  const body = parsed.body as Record<string, unknown> | null
  const email = normalizeEmail(body?.email)
  const password = cleanString(body?.password, 256)
  if (await isLoginRateLimited(env, request, email)) {
    await recordAuthAttempt(env, request, 'rate_limited', email)
    return json({ error: '登入嘗試次數過多，請稍後再試。' }, { status: 429 })
  }
  const user = await env.DB.prepare(`
    SELECT id, email, name, account_status AS accountStatus, account_type AS accountType,
      password_hash AS passwordHash, password_salt AS passwordSalt, auth_mode AS authMode
    FROM users WHERE email = ?
  `).bind(email).first<AuthUser & { passwordHash: string; passwordSalt: string; authMode: 'password' | 'access' }>()
  const passwordMatches = user?.authMode === 'password'
    ? await verifyPassword(password, user.passwordHash, user.passwordSalt)
    : await verifyPassword(password, DUMMY_PASSWORD_HASH, DUMMY_PASSWORD_SALT)
  if (!user || !passwordMatches) {
    await recordAuthAttempt(env, request, 'login_failed', email)
    return json({ error: '電郵或密碼不正確。' }, { status: 401 })
  }
  if (user.accountStatus !== 'active') {
    await recordAuthAttempt(env, request, 'login_failed', email)
    return json({ error: '帳號目前不可使用。' }, { status: 403 })
  }
  await recordAuthAttempt(env, request, 'login_success', email)
  return sessionResponse(env, request, user.id)
}

async function logout(request: Request, env: Env) {
  const token = parseCookie(request, SESSION_COOKIE)
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
  return json({ ok: true }, { headers: { 'set-cookie': expiredSessionCookie(request) } })
}

async function reserveOutput(env: Env, workspaceId: string, generationId: string) {
  const [ledger, balance] = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO output_ledger (id, workspace_id, generation_id, event_type, amount, note)
      SELECT ?, ?, ?, 'reservation', ?, 'Output allowance reservation'
      WHERE EXISTS (
        SELECT 1 FROM output_allowances WHERE workspace_id = ? AND available >= ?
      )
    `).bind(crypto.randomUUID(), workspaceId, generationId, -OUTPUT_COST, workspaceId, OUTPUT_COST),
    env.DB.prepare(`
      UPDATE output_allowances
      SET available = available - ?, reserved = reserved + ?, updated_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND available >= ? AND changes() = 1
    `).bind(OUTPUT_COST, OUTPUT_COST, workspaceId, OUTPUT_COST)
  ])
  if (!ledger.meta.changes || !balance.meta.changes) throw new Error('INSUFFICIENT_OUTPUT_ALLOWANCE')
}

async function releaseOrphanReservation(env: Env, workspaceId: string, generationId: string, reason: string) {
  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR IGNORE INTO output_ledger (id, workspace_id, generation_id, event_type, amount, note)
      SELECT ?, ?, ?, 'release', ?, ?
      WHERE EXISTS (
        SELECT 1 FROM output_ledger WHERE generation_id = ? AND event_type = 'reservation'
      )
    `).bind(crypto.randomUUID(), workspaceId, generationId, OUTPUT_COST, reason, generationId),
    env.DB.prepare(`
      UPDATE output_allowances
      SET available = available + ?, reserved = MAX(reserved - ?, 0), updated_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND changes() = 1
    `).bind(OUTPUT_COST, OUTPUT_COST, workspaceId)
  ])
}

async function failGenerationAndRelease(env: Env, workspaceId: string, generationId: string, reason: string) {
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE generations
      SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ? AND status IN ('queued', 'processing')
    `).bind(reason.slice(0, 500), generationId, workspaceId),
    env.DB.prepare(`
      INSERT OR IGNORE INTO output_ledger (id, workspace_id, generation_id, event_type, amount, note)
      SELECT ?, ?, ?, 'release', ?, ?
      WHERE changes() = 1
        AND EXISTS (SELECT 1 FROM output_ledger WHERE generation_id = ? AND event_type = 'reservation')
    `).bind(crypto.randomUUID(), workspaceId, generationId, OUTPUT_COST, reason.slice(0, 500), generationId),
    env.DB.prepare(`
      UPDATE output_allowances
      SET available = available + ?, reserved = MAX(reserved - ?, 0), updated_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND changes() = 1
    `).bind(OUTPUT_COST, OUTPUT_COST, workspaceId)
  ])
}

async function completeGenerationAndSettle(env: Env, workspaceId: string, generationId: string, outputKey: string, outputContentType: string) {
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE generations
      SET status = 'completed', output_key = ?, output_content_type = ?, error_message = NULL, completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ? AND status = 'processing'
    `).bind(outputKey, outputContentType, generationId, workspaceId),
    env.DB.prepare(`
      INSERT OR IGNORE INTO output_ledger (id, workspace_id, generation_id, event_type, amount, note)
      SELECT ?, ?, ?, 'settlement', 0, 'Generation completed'
      WHERE changes() = 1
        AND EXISTS (SELECT 1 FROM output_ledger WHERE generation_id = ? AND event_type = 'reservation')
    `).bind(crypto.randomUUID(), workspaceId, generationId, generationId),
    env.DB.prepare(`
      UPDATE output_allowances
      SET reserved = MAX(reserved - ?, 0), updated_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND changes() = 1
    `).bind(OUTPUT_COST, workspaceId)
  ])
}

type CampaignPackRequest = {
  idempotencyKey: string
  workspaceId: string
  approvedRevision: number
  intent: string
  brand: GenerationInput['brand']
  product: GenerationInput['product']
  referenceAssetIds: string[]
  outputs: Array<Pick<GenerationInput, 'workflowId' | 'aspectRatio'>>
}

function campaignPackInputs(value: unknown): { request: CampaignPackRequest; inputs: GenerationInput[] } | null {
  if (!value || typeof value !== 'object') return null
  const request = value as Partial<CampaignPackRequest>
  if (!boundedString(request.idempotencyKey, 100) || !/^[a-z0-9_-]{16,100}$/i.test(request.idempotencyKey!)) return null
  if (!boundedString(request.workspaceId, 64) || !Number.isSafeInteger(request.approvedRevision) || Number(request.approvedRevision) <= 0) return null
  if (!Array.isArray(request.outputs) || request.outputs.length < 1 || request.outputs.length > 3) return null
  const inputs = request.outputs.map((output) => ({
    workspaceId: request.workspaceId!,
    workflowId: output?.workflowId,
    aspectRatio: output?.aspectRatio,
    approvedRevision: request.approvedRevision!,
    intent: request.intent,
    brand: request.brand,
    product: request.product,
    referenceImageUrls: [],
    referenceAssetIds: request.referenceAssetIds
  }))
  if (!inputs.every(validInput)) return null
  const outputKeys = inputs.map((input) => `${input.workflowId}:${input.aspectRatio}`)
  if (new Set(outputKeys).size !== outputKeys.length) return null
  return { request: request as CampaignPackRequest, inputs: inputs as GenerationInput[] }
}

async function approvedCampaignPackInputs(env: Env, inputs: GenerationInput[]) {
  const first = inputs[0]
  const agent = await getAgentByName(env.CAMPAIGN_AGENT, first.workspaceId)
  const state = await agent.getPlan()
  if (state.stage !== 'approved' || state.revision !== first.approvedRevision || !state.brief) return false
  const submittedBrief = sanitizeCampaignBrief({
    assetId: first.referenceAssetIds[0],
    intent: first.intent,
    brand: first.brand,
    product: first.product
  })
  if (JSON.stringify(submittedBrief) !== JSON.stringify(state.brief)) return false
  return inputs.every((input) => state.plan.some((item) => item.selected && item.workflowId === input.workflowId && item.ratio === input.aspectRatio))
}

async function packGenerations(env: Env, workspaceId: string, campaignPackId: string) {
  const result = await env.DB.prepare(`
    SELECT id, campaign_pack_id AS campaignPackId, workflow_id AS workflowId, aspect_ratio AS aspectRatio,
      status, output_content_type AS contentType, approved_revision AS approvedRevision,
      error_message AS errorMessage, created_at AS createdAt
    FROM generations
    WHERE workspace_id = ? AND campaign_pack_id = ?
    ORDER BY created_at ASC
  `).bind(workspaceId, campaignPackId).all<{
    id: string
    campaignPackId: string
    workflowId: GenerationInput['workflowId']
    aspectRatio: GenerationInput['aspectRatio']
    status: 'queued' | 'processing' | 'completed' | 'failed'
    contentType: 'image/svg+xml' | 'image/png' | null
    approvedRevision: number
    errorMessage: string | null
    createdAt: string
  }>()
  return result.results.map((item) => ({ ...item, imageUrl: item.status === 'completed' ? `/api/generations/${item.id}/image` : null }))
}

async function createCampaignPack(request: Request, env: Env, session: SessionContext) {
  if (generationMode(env) === 'disabled') return json({ error: '素材生成服務目前未開放。' }, { status: 503 })
  if (!hasJsonContent(request)) return json({ error: 'Expected application/json.' }, { status: 415 })
  const parsed = await readBody(request, MAX_GENERATION_BODY_BYTES)
  if (parsed.tooLarge) return json({ error: 'Campaign Pack payload is too large.' }, { status: 413 })
  const parsedPack = campaignPackInputs(parsed.body)
  if (!parsedPack) return json({ error: 'Invalid Campaign Pack payload.' }, { status: 400 })
  const workspace = await getWorkspace(env, session.user.id, parsedPack.request.workspaceId)
  if (!workspace) return json({ error: 'Workspace not found.' }, { status: 404 })

  const existing = await env.DB.prepare('SELECT id FROM campaign_packs WHERE workspace_id = ? AND idempotency_key = ?')
    .bind(workspace.id, parsedPack.request.idempotencyKey)
    .first<{ id: string }>()
  if (existing) return json({ campaignPackId: existing.id, generations: await packGenerations(env, workspace.id, existing.id), replayed: true })

  const brief = sanitizeCampaignBrief({
    assetId: parsedPack.request.referenceAssetIds[0],
    intent: parsedPack.request.intent,
    brand: parsedPack.request.brand,
    product: parsedPack.request.product
  })
  const inputs = parsedPack.inputs.map((input) => ({
    ...input,
    workspaceId: workspace.id,
    intent: brief.intent,
    brand: brief.brand,
    product: brief.product,
    referenceImageUrls: [],
    referenceAssetIds: [parsedPack.request.referenceAssetIds[0]]
  }))
  for (const input of inputs) {
    const issues = validateCompositionInput(input)
    if (issues.length) return json({ error: issues[0], issues }, { status: 422 })
    if (!workflowById(input.workflowId).ratios.includes(input.aspectRatio)) return json({ error: 'The selected ratio is not available for this workflow.' }, { status: 400 })
  }
  if (!await referenceAssetsBelongToWorkspace(env, workspace.id, inputs[0].referenceAssetIds)) return json({ error: 'Product asset not found.' }, { status: 400 })
  try {
    if (!await approvedCampaignPackInputs(env, inputs)) return json({ error: 'Campaign plan approval is missing, stale, or does not match this pack.' }, { status: 409 })
  } catch {
    return json({ error: 'Campaign approval state is temporarily unavailable.' }, { status: 503 })
  }

  const campaignPackId = crypto.randomUUID()
  const queued = inputs.map((input) => ({ generationId: crypto.randomUUID(), input }))
  const outputCount = queued.length * OUTPUT_COST
  try {
    const statements = [
      env.DB.prepare(`
        UPDATE output_allowances
        SET available = available - ?, reserved = reserved + ?, updated_at = CURRENT_TIMESTAMP
        WHERE workspace_id = ? AND available >= ?
      `).bind(outputCount, outputCount, workspace.id, outputCount),
      env.DB.prepare(`
        INSERT INTO campaign_packs (id, workspace_id, idempotency_key, approved_revision)
        SELECT ?, ?, ?, ? WHERE changes() = 1
      `).bind(campaignPackId, workspace.id, parsedPack.request.idempotencyKey, parsedPack.request.approvedRevision)
    ]
    for (const item of queued) {
      statements.push(env.DB.prepare(`
        INSERT INTO output_ledger (id, workspace_id, generation_id, event_type, amount, note)
        SELECT ?, ?, ?, 'reservation', ?, 'Campaign Pack output reservation'
        WHERE EXISTS (SELECT 1 FROM campaign_packs WHERE id = ? AND workspace_id = ?)
      `).bind(crypto.randomUUID(), workspace.id, item.generationId, -OUTPUT_COST, campaignPackId, workspace.id))
    }
    for (const item of queued) {
      statements.push(env.DB.prepare(`
        INSERT INTO generations (id, workspace_id, campaign_pack_id, workflow_id, aspect_ratio, status, output_cost, credit_cost, input_json, approved_revision)
        SELECT ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM campaign_packs WHERE id = ? AND workspace_id = ?)
      `).bind(item.generationId, workspace.id, campaignPackId, item.input.workflowId, item.input.aspectRatio, OUTPUT_COST, OUTPUT_COST, JSON.stringify(item.input), item.input.approvedRevision, campaignPackId, workspace.id))
    }
    const results = await env.DB.batch(statements)
    if (!results[0].meta.changes) {
      const replay = await env.DB.prepare('SELECT id FROM campaign_packs WHERE workspace_id = ? AND idempotency_key = ?')
        .bind(workspace.id, parsedPack.request.idempotencyKey)
        .first<{ id: string }>()
      if (replay) return json({ campaignPackId: replay.id, generations: await packGenerations(env, workspace.id, replay.id), replayed: true })
      return json({ error: `至少需要 ${outputCount} 個可用輸出。` }, { status: 409 })
    }
  } catch {
    const replay = await env.DB.prepare('SELECT id FROM campaign_packs WHERE workspace_id = ? AND idempotency_key = ?')
      .bind(workspace.id, parsedPack.request.idempotencyKey)
      .first<{ id: string }>()
    if (replay) return json({ campaignPackId: replay.id, generations: await packGenerations(env, workspace.id, replay.id), replayed: true })
    return json({ error: 'Unable to create Campaign Pack.' }, { status: 503 })
  }

  try {
    await env.GENERATION_QUEUE.sendBatch(queued.map((item) => ({ body: { generationId: item.generationId, input: item.input } })))
  } catch {
    for (const item of queued) await failGenerationAndRelease(env, workspace.id, item.generationId, 'Unable to enqueue Campaign Pack output.').catch(() => null)
    return json({ error: 'Unable to queue Campaign Pack.' }, { status: 503 })
  }

  return json({ campaignPackId, generations: await packGenerations(env, workspace.id, campaignPackId), reservedOutputs: outputCount }, { status: 202 })
}

async function createGeneration(request: Request, env: Env, session: SessionContext) {
  if (generationMode(env) === 'disabled') return json({ error: '素材生成服務目前未開放。' }, { status: 503 })
  if (!hasJsonContent(request)) return json({ error: 'Expected application/json.' }, { status: 415 })
  const contentLength = Number(request.headers.get('content-length') || '0')
  if (contentLength > MAX_GENERATION_BODY_BYTES) return json({ error: 'Generation payload is too large.' }, { status: 413 })
  const input = await request.json().catch(() => null)
  if (!validInput(input)) return json({ error: 'Invalid generation payload.' }, { status: 400 })
  const workspace = await getWorkspace(env, session.user.id, input.workspaceId)
  if (!workspace) return json({ error: 'Workspace not found.' }, { status: 404 })
  const brief = sanitizeCampaignBrief({ assetId: input.referenceAssetIds[0], intent: input.intent, brand: input.brand, product: input.product })
  const safeInput: GenerationInput = { ...input, workspaceId: workspace.id, intent: brief.intent, brand: brief.brand, product: brief.product, referenceImageUrls: [], referenceAssetIds: [input.referenceAssetIds[0]] }
  const compositionIssues = validateCompositionInput(safeInput)
  if (compositionIssues.length) return json({ error: compositionIssues[0], issues: compositionIssues }, { status: 422 })
  if (!await referenceAssetsBelongToWorkspace(env, workspace.id, safeInput.referenceAssetIds)) return json({ error: 'Product asset not found.' }, { status: 400 })
  const workflow = workflowById(input.workflowId)
  if (!workflow.ratios.includes(input.aspectRatio)) return json({ error: 'The selected ratio is not available for this workflow.' }, { status: 400 })
  try {
    if (!await approvedGenerationInput(env, safeInput)) return json({ error: 'Campaign plan approval is missing, stale, or does not match this output.' }, { status: 409 })
  } catch {
    return json({ error: 'Campaign approval state is temporarily unavailable.' }, { status: 503 })
  }
  const id = crypto.randomUUID()
  let reservationCreated = false
  let generationCreated = false
  try {
    await reserveOutput(env, workspace.id, id)
    reservationCreated = true
    await env.DB.prepare('INSERT INTO generations (id, workspace_id, workflow_id, aspect_ratio, status, output_cost, credit_cost, input_json, approved_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, workspace.id, safeInput.workflowId, safeInput.aspectRatio, 'queued', OUTPUT_COST, OUTPUT_COST, JSON.stringify(safeInput), safeInput.approvedRevision).run()
    generationCreated = true
    await env.GENERATION_QUEUE.send({ generationId: id, input: safeInput })
    return json({ id, status: 'queued', reservedOutputs: OUTPUT_COST }, { status: 202 })
  } catch (error) {
    if (error instanceof Error && error.message === 'INSUFFICIENT_OUTPUT_ALLOWANCE') return json({ error: '可用輸出數不足。' }, { status: 409 })
    if (reservationCreated) {
      if (generationCreated) await failGenerationAndRelease(env, workspace.id, id, 'Unable to enqueue generation.').catch(() => null)
      else await releaseOrphanReservation(env, workspace.id, id, 'Unable to create generation record.').catch(() => null)
    }
    return json({ error: 'Unable to queue generation.' }, { status: 503 })
  }
}

async function listGenerations(request: Request, env: Env, session: SessionContext) {
  const url = new URL(request.url)
  const workspaceId = url.searchParams.get('workspaceId') || session.currentWorkspace.id
  const workspace = await getWorkspace(env, session.user.id, workspaceId)
  if (!workspace) return json({ error: 'Workspace not found.' }, { status: 404 })
  const result = await env.DB.prepare(`
    SELECT id, campaign_pack_id AS campaignPackId, workflow_id AS workflowId, aspect_ratio AS aspectRatio, status, output_key AS outputKey,
      output_content_type AS contentType, approved_revision AS approvedRevision,
      error_message AS errorMessage, created_at AS createdAt
    FROM generations
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(workspace.id).all<{ id: string; campaignPackId: string | null; workflowId: string; aspectRatio: string; status: string; outputKey: string | null; contentType: string | null; approvedRevision: number; errorMessage: string | null; createdAt: string }>()
  return json({ generations: result.results.map((item) => ({ ...item, imageUrl: item.outputKey ? `/api/generations/${item.id}/image` : null })) })
}

async function generationImage(request: Request, env: Env, session: SessionContext, generationId: string) {
  const row = await env.DB.prepare(`
    SELECT g.output_key AS outputKey
    FROM generations g
    JOIN workspace_memberships wm ON wm.workspace_id = g.workspace_id
    WHERE g.id = ? AND wm.user_id = ? AND g.status = 'completed'
  `).bind(generationId, session.user.id).first<{ outputKey: string | null }>()
  if (!row?.outputKey) return json({ error: 'Image not found.' }, { status: 404 })
  const object = await env.MEDIA_BUCKET.get(row.outputKey)
  if (!object) return json({ error: 'Image not found.' }, { status: 404 })
  const contentType = object.httpMetadata?.contentType || 'image/png'
  const headers = new Headers({
    'content-type': contentType,
    'cache-control': 'private, max-age=300',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  })
  if (contentType === CAMPAIGN_OUTPUT_CONTENT_TYPE) headers.set('content-security-policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
  return new Response(object.body, { headers })
}

async function deleteGeneration(env: Env, session: SessionContext, generationId: string) {
  const row = await env.DB.prepare(`
    SELECT g.output_key AS outputKey, g.status
    FROM generations g
    JOIN workspace_memberships wm ON wm.workspace_id = g.workspace_id
    JOIN workspaces w ON w.id = g.workspace_id
    WHERE g.id = ? AND wm.user_id = ? AND w.access_status = 'active'
  `).bind(generationId, session.user.id).first<{ outputKey: string | null; status: string }>()
  if (!row) return json({ error: 'Output not found.' }, { status: 404 })
  if (row.status === 'queued' || row.status === 'processing') return json({ error: '仍在處理的輸出不可刪除。' }, { status: 409 })
  try {
    if (row.outputKey) await env.MEDIA_BUCKET.delete(row.outputKey)
    await env.DB.prepare('DELETE FROM generations WHERE id = ?').bind(generationId).run()
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  } catch {
    return json({ error: '未能刪除輸出。' }, { status: 503 })
  }
}

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url)
    const activeAuthMode = authMode(env)
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !isAllowedOrigin(request, env)) {
      return json({ error: 'Request origin is not allowed.' }, { status: 403 })
    }
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) return new Response(null, { status: 204 })
    if (url.pathname === '/api/health') return json({
      status: 'ok',
      service: 'campaign-asset-worker',
      releaseMode: 'restricted',
      authMode: activeAuthMode,
      registrationMode: activeAuthMode === 'access' ? 'closed' : registrationMode(env),
      registrationOpen: activeAuthMode === 'password' && registrationMode(env) !== 'closed',
      generationEnabled: generationMode(env) !== 'disabled',
      generationMode: generationMode(env),
      agentMode: env.AGENT_MODE === 'assisted' && Boolean(env.OPENAI_API_KEY) ? 'assisted' : 'deterministic'
    })
    if (url.pathname === '/api/workflows' && request.method === 'GET') return json({ workflows: ['store-main', 'detail-banner', 'promo-poster', 'meta-ad', 'package-showcase'] })
    if (url.pathname === '/api/auth/register' && request.method === 'POST') return activeAuthMode === 'access' ? json({ error: 'Password registration is disabled.' }, { status: 404 }) : register(request, env)
    if (url.pathname === '/api/auth/login' && request.method === 'POST') return activeAuthMode === 'access' ? json({ error: 'Password login is disabled.' }, { status: 404 }) : login(request, env)
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return activeAuthMode === 'access' ? json({ ok: true, logoutUrl: '/cdn-cgi/access/logout' }) : logout(request, env)
    if (url.pathname === '/api/session' && request.method === 'GET') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return activeAuthMode === 'access' ? session : json({ authenticated: false }, { headers: session.headers })
      return json({ authenticated: true, user: session.user, currentWorkspace: session.currentWorkspace })
    }
    if (url.pathname === '/api/workspaces' && request.method === 'GET') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return json({ workspaces: await workspacesForUser(env, session.user.id), currentWorkspace: session.currentWorkspace })
    }
    if (url.pathname === '/api/assets/product' && request.method === 'POST') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return uploadProductAsset(request, env, session)
    }
    const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)$/)
    if (assetMatch && request.method === 'GET') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return productAsset(request, env, session, assetMatch[1])
    }
    if (assetMatch && request.method === 'DELETE') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return deleteProductAsset(env, session, assetMatch[1])
    }
    const agentAction = url.pathname.match(/^\/api\/campaign-agent(?:\/(plan|approve))?$/)
    if (agentAction && (request.method === 'GET' || request.method === 'POST')) {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return campaignAgentRequest(request, env, session, agentAction[1] as 'plan' | 'approve' || 'state')
    }
    const imageMatch = url.pathname.match(/^\/api\/generations\/([^/]+)\/image$/)
    if (imageMatch && request.method === 'GET') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return generationImage(request, env, session, imageMatch[1])
    }
    const generationMatch = url.pathname.match(/^\/api\/generations\/([^/]+)$/)
    if (generationMatch && request.method === 'DELETE') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return deleteGeneration(env, session, generationMatch[1])
    }
    if (url.pathname === '/api/generations' && request.method === 'GET') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return listGenerations(request, env, session)
    }
    if (url.pathname === '/api/generations' && request.method === 'POST') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return createGeneration(request, env, session)
    }
    if (url.pathname === '/api/campaign-packs' && request.method === 'POST') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return createCampaignPack(request, env, session)
    }
    return json({ error: 'Not found.' }, { status: 404 })
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(cleanExpiredSessions(env))
  },

  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      const { generationId, input } = message.body as GenerationMessage
      let storedOutputKey: string | null = null
      try {
        const claim = await env.DB.prepare(`
          UPDATE generations
          SET status = 'processing', processing_attempt = ?, error_message = NULL
          WHERE id = ? AND workspace_id = ?
            AND (status = 'queued' OR (status = 'processing' AND processing_attempt < ?))
        `).bind(message.attempts, generationId, input.workspaceId, message.attempts).run()
        if (!claim.meta.changes) {
          message.ack()
          continue
        }
        const mode = generationMode(env)
        if (mode === 'disabled') throw new Error('Campaign generation is disabled for this deployment.')
        const workflow = workflowById(input.workflowId)
        const source = await generationSourceAsset(env, input)
        let background: { base64: string; contentType: 'image/png' } | undefined
        if (mode === 'assisted' && env.OPENAI_API_KEY) {
          const copy = await new OpenAICopyProvider(env.OPENAI_API_KEY).createCopy({ brand: input.brand, product: input.product, workflowTitle: workflow.title, aspectRatio: input.aspectRatio })
          const generated = await new OpenAIImageProvider(env.OPENAI_API_KEY).generate({ prompt: `${copy.imagePrompt}\nBackground scene only. Do not render text, logos, prices, claims, or a replacement product.`, aspectRatio: input.aspectRatio, referenceImageUrls: [] })
          background = { base64: generated.imageBase64, contentType: 'image/png' }
        }
        const output = composeCampaignSvg({ input, source, background })
        const key = `workspaces/${input.workspaceId}/generations/${generationId}.svg`
        await env.MEDIA_BUCKET.put(key, output, {
          httpMetadata: { contentType: CAMPAIGN_OUTPUT_CONTENT_TYPE },
          customMetadata: {
            workflow: input.workflowId,
            sourceAssetId: input.referenceAssetIds[0],
            approvedRevision: String(input.approvedRevision),
            compositionVersion: CAMPAIGN_COMPOSITION_VERSION,
            generationMode: mode
          }
        })
        storedOutputKey = key
        await completeGenerationAndSettle(env, input.workspaceId, generationId, key, CAMPAIGN_OUTPUT_CONTENT_TYPE)
        storedOutputKey = null
        message.ack()
      } catch (error) {
        if (storedOutputKey) await env.MEDIA_BUCKET.delete(storedOutputKey).catch(() => null)
        const internalReason = error instanceof Error ? error.message : ''
        const retryable = error instanceof TypeError || /request failed: (408|409|429|5\d\d)/i.test(internalReason)
        if (retryable && message.attempts <= 3) {
          const reset = await env.DB.prepare(`
            UPDATE generations SET status = 'queued', error_message = ?
            WHERE id = ? AND workspace_id = ? AND status = 'processing'
          `).bind(RETRYING_GENERATION_MESSAGE, generationId, input.workspaceId).run()
          if (reset.meta.changes) {
            message.retry({ delaySeconds: 60 })
            continue
          }
        }
        try {
          await failGenerationAndRelease(env, input.workspaceId, generationId, FAILED_GENERATION_MESSAGE)
          message.ack()
        } catch {
          console.error('generation-settlement-failed')
          const reset = await env.DB.prepare("UPDATE generations SET status = 'queued' WHERE id = ? AND workspace_id = ? AND status = 'processing'").bind(generationId, input.workspaceId).run()
          if (reset.meta.changes) message.retry({ delaySeconds: 60 })
          else message.ack()
        }
      }
    }
  }
} satisfies ExportedHandler<Env, GenerationMessage>
