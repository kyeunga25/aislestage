import { getAgentByName } from 'agents'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { CampaignAgent } from './agents/CampaignAgent'
import { accessLoginPath, normalizeAccessFailureReason, type AccessFailureReason } from './lib/access-login'
import { bytesToBase64, CAMPAIGN_COMPOSITION_VERSION, CAMPAIGN_OUTPUT_CONTENT_TYPE, composeCampaignSvg, validateCompositionInput } from './lib/campaign-compositor'
import { campaignBriefLimits, sanitizeCampaignBrief, validateCampaignBrief } from './lib/campaign-agent'
import { OpenAICopyProvider, OpenAIImageProvider } from './lib/providers'
import { agentMode, generationMode, maxActiveGenerations } from './lib/runtime-policy'
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
  ASSISTED_PROVIDER?: string
  ASSISTED_DATA_POLICY?: string
  ASSISTED_EVALUATION?: string
  ASSISTED_BUDGET_MODE?: string
  MAX_ACTIVE_GENERATIONS_PER_WORKSPACE?: string
}

export type GenerationMessage = { generationId: string; input: GenerationInput }
type AccountStatus = 'active' | 'suspended' | 'deactivated'
type AccountType = 'standard' | 'beta' | 'test'
type WorkspaceRole = 'owner' | 'admin' | 'member'
type ReviewStatus = 'draft' | 'approved' | 'rejected'
type CompletedGenerationMode = 'deterministic' | 'assisted'
type AuthUser = { id: string; email: string; name: string; accountStatus: AccountStatus; accountType: AccountType }
type Workspace = { id: string; name: string; role: WorkspaceRole; accessStatus: 'active' | 'suspended' | 'closed'; availableOutputs: number; reservedOutputs: number }
type SessionContext = { user: AuthUser; currentWorkspace: Workspace }
type AccessIdentity = { subject: string; email: string; name: string }
type GenerationRow = {
  id: string
  campaignPackId: string | null
  workflowId: GenerationInput['workflowId']
  aspectRatio: GenerationInput['aspectRatio']
  status: 'queued' | 'processing' | 'completed' | 'failed'
  contentType: 'image/svg+xml' | 'image/png' | null
  approvedRevision: number
  errorMessage: string | null
  createdAt: string
  reviewStatus: ReviewStatus
  reviewedAt: string | null
  compositionVersion: string | null
  generationMode: CompletedGenerationMode | null
  outputSha256: string | null
}
type StoredGenerationRow = GenerationRow & { outputKey: string | null }
// One generated output consumes one technical allowance unit for idempotent accounting.
const OUTPUT_COST = 1
const SESSION_COOKIE = 'aislestage_session'
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
const MAX_REVIEW_BODY_BYTES = 1_024
const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_UPLOAD_REQUEST_BYTES = MAX_PRODUCT_IMAGE_BYTES + 64 * 1024
const MAX_IMAGE_CONTAINER_CHUNKS = 4_096
const MAX_PRODUCT_IMAGE_DIMENSION = 8_192
const MAX_PRODUCT_IMAGE_PIXELS = 32_000_000
const MAX_AUTH_ATTEMPT_DAYS = 7
const MAX_USED_INVITE_DAYS = 30
const RETRYING_GENERATION_MESSAGE = '素材處理暫時未能完成，系統會自動重試。'
const FAILED_GENERATION_MESSAGE = '素材未能完成，可用輸出數已自動退回。'
const DUMMY_PASSWORD_SALT = 'YWlzbGVwYWNrLXB1YmxpYy1zYWx0'
const DUMMY_PASSWORD_HASH = 'P/FKiXHHJRFZsQ7MLmqKMp+SQoYtsIWL8P2EkVxfWsE='
const ACCESS_FAILURE_HEADER = 'x-aislestage-access-failure'
const accessJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

class TerminalGenerationError extends Error {}
class AuthenticationSecurityStateError extends Error {}

const json = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8')
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(JSON.stringify(body), { ...init, headers })
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

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
  return base64Url(new Uint8Array(await sha256Bytes(textEncoder.encode(value))))
}

async function sha256Bytes(value: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.digest('SHA-256', value)
}

async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS }, key, 256)
  return { hash: base64(new Uint8Array(bits)), salt: base64(salt) }
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = textEncoder.encode(left)
  const rightBytes = textEncoder.encode(right)
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean }
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

async function cancelRequestBody(request: Request) {
  await request.body?.cancel().catch(() => undefined)
}

async function readBoundedRequestBytes(request: Request, maxBytes: number) {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const normalized = declaredLength.trim()
    const parsed = /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
      await cancelRequestBody(request)
      return { bytes: null, tooLarge: true }
    }
  }

  if (!request.body) return { bytes: new Uint8Array(), tooLarge: false }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.byteLength > maxBytes - total) {
        await reader.cancel().catch(() => undefined)
        return { bytes: null, tooLarge: true }
      }
      chunks.push(value)
      total += value.byteLength
    }
  } catch {
    await reader.cancel().catch(() => undefined)
    return { bytes: null, tooLarge: false }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, tooLarge: false }
}

async function readBody(request: Request, maxBytes: number) {
  const bounded = await readBoundedRequestBytes(request, maxBytes)
  if (bounded.tooLarge || !bounded.bytes) return { body: null, tooLarge: bounded.tooLarge }
  try {
    return { body: JSON.parse(textDecoder.decode(bounded.bytes)) as unknown, tooLarge: false }
  } catch {
    return { body: null, tooLarge: false }
  }
}

function getClientIp(request: Request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}

function hasMediaType(request: Request, expected: string) {
  const contentType = request.headers.get('content-type')
  if (!contentType) return false
  return contentType.split(';', 1)[0].trim().toLowerCase() === expected
}

function hasJsonContent(request: Request) {
  return hasMediaType(request, 'application/json')
}

async function unsupportedMediaType(request: Request, expected: 'application/json' | 'multipart/form-data') {
  await cancelRequestBody(request)
  const error = expected === 'application/json'
    ? '需要 application/json。 Expected application/json.'
    : '需要 multipart/form-data。 Expected multipart/form-data.'
  return json({ error }, { status: 415 })
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
  const eventId = crypto.randomUUID()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await env.DB.prepare('INSERT INTO auth_attempts (id, email, ip_address, event_type) VALUES (?, ?, ?, ?)')
        .bind(eventId, emailKey, ipKey, eventType)
        .run()
      return
    } catch {
      try {
        const stored = await env.DB.prepare(`
          SELECT email, ip_address AS ipAddress, event_type AS eventType
          FROM auth_attempts
          WHERE id = ?
        `).bind(eventId).first<{ email: string; ipAddress: string; eventType: string }>()
        if (stored
          && stored.email === emailKey
          && stored.ipAddress === ipKey
          && stored.eventType === eventType) return
        if (stored) break
      } catch {
        // The same primary key makes one bounded retry safe even when the first read is unavailable.
      }
    }
  }
  console.error('auth-attempt-reconciliation-failed')
  throw new AuthenticationSecurityStateError('Authentication event storage is unavailable.')
}

async function authAttemptCount(env: Env, request: Request, options: { email?: string; eventTypes: string[]; minutes: number }) {
  const ip = await sha256(getClientIp(request))
  const email = options.email ? await sha256(options.email) : ''
  const placeholders = options.eventTypes.map(() => '?').join(',')
  const bindings: unknown[] = options.email ? [email, ip, ...options.eventTypes, `-${options.minutes} minutes`] : [ip, ...options.eventTypes, `-${options.minutes} minutes`]
  try {
    const result = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM auth_attempts
      WHERE ${options.email ? 'email = ? AND ip_address = ?' : 'ip_address = ?'}
        AND event_type IN (${placeholders})
        AND created_at >= datetime('now', ?)
    `).bind(...bindings).first<{ count: number }>()
    return result?.count ?? 0
  } catch {
    console.error('auth-rate-limit-read-failed')
    throw new AuthenticationSecurityStateError('Authentication rate-limit state is unavailable.')
  }
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

async function guardedPasswordAuth(action: 'login' | 'register', operation: () => Promise<Response>) {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof AuthenticationSecurityStateError)) throw error
    const message = action === 'login'
      ? '登入安全狀態暫時無法確認。 Authentication security state is temporarily unavailable.'
      : '註冊安全狀態暫時無法確認。 Registration security state is temporarily unavailable.'
    return json({ error: message }, { status: 503 })
  }
}

function isWorkspaceAppPath(pathname: string) {
  return pathname === '/app' || pathname.startsWith('/app/')
}

function accessError(code: AccessFailureReason, status: 401 | 403 | 503, message: string) {
  return json({ authenticated: false, code, error: message }, { status, headers: { [ACCESS_FAILURE_HEADER]: code } })
}

function loginRedirect(request: Request, reason: AccessFailureReason) {
  const requestUrl = new URL(request.url)
  const location = new URL(accessLoginPath(`${requestUrl.pathname}${requestUrl.search}`, reason), requestUrl.origin)
  return new Response(null, {
    status: 302,
    headers: {
      location: location.toString(),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff'
    }
  })
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
    return identity || accessError('identity-incomplete', 401, 'Cloudflare Access identity claims are incomplete.')
  } catch {
    return accessError('authentication-invalid', 401, 'Cloudflare Access authentication is invalid.')
  }
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
    && boundedString(input.intent, campaignBriefLimits.intent, false)
    && boundedString(input.brand?.name, campaignBriefLimits.brand.name)
    && boundedString(input.brand?.tone, campaignBriefLimits.brand.tone, false)
    && boundedStringArray(input.brand?.colors, campaignBriefLimits.brand.colors.items, campaignBriefLimits.brand.colors.itemLength)
    && boundedString(input.brand?.forbiddenWords, campaignBriefLimits.brand.forbiddenWords, false)
    && (input.brand?.locale === 'zh-Hant' || input.brand?.locale === 'en')
    && boundedString(input.brand?.cta, campaignBriefLimits.brand.cta, false)
    && boundedString(input.brand?.ctaEn, campaignBriefLimits.brand.ctaEn, false)
    && boundedString(input.product?.name, campaignBriefLimits.product.name)
    && boundedString(input.product?.nameEn, campaignBriefLimits.product.nameEn)
    && boundedString(input.product?.category, campaignBriefLimits.product.category)
    && boundedStringArray(input.product?.benefits, campaignBriefLimits.product.benefits.items, campaignBriefLimits.product.benefits.itemLength)
    && boundedStringArray(input.product?.benefitsEn, campaignBriefLimits.product.benefitsEn.items, campaignBriefLimits.product.benefitsEn.itemLength)
    && boundedString(input.product?.specifications, campaignBriefLimits.product.specifications, false)
    && boundedString(input.product?.price, campaignBriefLimits.product.price, false)
    && boundedString(input.product?.promotion, campaignBriefLimits.product.promotion, false)
    && boundedString(input.product?.promotionEn, campaignBriefLimits.product.promotionEn, false)
    && boundedStringArray(input.product?.channels, campaignBriefLimits.product.channels.items, campaignBriefLimits.product.channels.itemLength)
    && Array.isArray(input.referenceImageUrls) && input.referenceImageUrls.length === 0
    && boundedStringArray(input.referenceAssetIds, 1, campaignBriefLimits.assetId) && input.referenceAssetIds?.length === 1
}

function generationInputIdentity(input: GenerationInput) {
  return JSON.stringify([
    input.workspaceId,
    input.workflowId,
    input.aspectRatio,
    input.approvedRevision,
    input.intent,
    input.brand.name,
    input.brand.tone,
    input.brand.colors,
    input.brand.forbiddenWords,
    input.brand.locale,
    input.brand.cta,
    input.brand.ctaEn,
    input.product.name,
    input.product.nameEn,
    input.product.category,
    input.product.benefits,
    input.product.benefitsEn,
    input.product.specifications,
    input.product.price,
    input.product.promotion,
    input.product.promotionEn,
    input.product.channels,
    input.referenceImageUrls,
    input.referenceAssetIds
  ])
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

function uint32BigEndian(bytes: Uint8Array, offset: number) {
  return (bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3]) >>> 0
}

function uint32LittleEndian(bytes: Uint8Array, offset: number) {
  return (bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000 + bytes[offset + 3] * 0x1000000) >>> 0
}

function uint24LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000
}

const pngCrcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function hasValidPngChunkCrc(bytes: Uint8Array, typeOffset: number, crcOffset: number) {
  let crc = 0xffffffff
  for (let offset = typeOffset; offset < crcOffset; offset += 1) crc = pngCrcTable[(crc ^ bytes[offset]) & 0xff] ^ (crc >>> 8)
  return ((crc ^ 0xffffffff) >>> 0) === uint32BigEndian(bytes, crcOffset)
}

function hasValidPngStructure(bytes: Uint8Array) {
  let offset = 8
  let chunkCount = 0
  let sawHeader = false
  let sawPalette = false
  let sawImageData = false
  let endedImageData = false
  let imageDataBytes = 0
  let colorType = -1

  while (offset < bytes.length) {
    chunkCount += 1
    if (chunkCount > MAX_IMAGE_CONTAINER_CHUNKS) return false
    if (bytes.length - offset < 12) return false
    const length = uint32BigEndian(bytes, offset)
    if (length > bytes.length - offset - 12) return false
    const typeOffset = offset + 4
    const dataOffset = offset + 8
    const crcOffset = dataOffset + length
    const typeBytes = bytes.subarray(typeOffset, typeOffset + 4)
    if ([...typeBytes].some((value) => !((value >= 65 && value <= 90) || (value >= 97 && value <= 122)))) return false
    if ((typeBytes[2] & 0x20) !== 0 || !hasValidPngChunkCrc(bytes, typeOffset, crcOffset)) return false

    const name = chunkName(bytes, typeOffset)
    if (!sawHeader && name !== 'IHDR') return false
    if (sawImageData && name !== 'IDAT') endedImageData = true

    if (name === 'IHDR') {
      if (sawHeader || offset !== 8 || length !== 13) return false
      const width = uint32BigEndian(bytes, dataOffset)
      const height = uint32BigEndian(bytes, dataOffset + 4)
      const bitDepth = bytes[dataOffset + 8]
      colorType = bytes[dataOffset + 9]
      const validBitDepth = (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth))
        || (colorType === 2 && [8, 16].includes(bitDepth))
        || (colorType === 3 && [1, 2, 4, 8].includes(bitDepth))
        || ((colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth))
      if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff || !validBitDepth) return false
      if (bytes[dataOffset + 10] !== 0 || bytes[dataOffset + 11] !== 0 || bytes[dataOffset + 12] > 1) return false
      sawHeader = true
    } else if (name === 'PLTE') {
      if (sawPalette || sawImageData || colorType === 0 || colorType === 4 || length === 0 || length > 768 || length % 3 !== 0) return false
      sawPalette = true
    } else if (name === 'IDAT') {
      if (!sawHeader || endedImageData || (colorType === 3 && !sawPalette)) return false
      sawImageData = true
      imageDataBytes += length
    } else if (name === 'IEND') {
      return length === 0 && sawImageData && imageDataBytes > 0 && crcOffset + 4 === bytes.length
    } else if ((typeBytes[0] & 0x20) === 0) {
      return false
    }

    offset = crcOffset + 4
  }
  return false
}

function webpBitstreamDimensions(bytes: Uint8Array, name: string, dataOffset: number, length: number) {
  if (name === 'VP8L') {
    if (length < 5 || bytes[dataOffset] !== 0x2f) return null
    const header = uint32LittleEndian(bytes, dataOffset + 1)
    if ((header >>> 29) !== 0) return null
    return { width: (header & 0x3fff) + 1, height: ((header >>> 14) & 0x3fff) + 1 }
  }
  if (name === 'VP8 ') {
    if (length < 10 || (bytes[dataOffset] & 1) !== 0) return null
    if (bytes[dataOffset + 3] !== 0x9d || bytes[dataOffset + 4] !== 0x01 || bytes[dataOffset + 5] !== 0x2a) return null
    const width = (bytes[dataOffset + 6] + bytes[dataOffset + 7] * 0x100) & 0x3fff
    const height = (bytes[dataOffset + 8] + bytes[dataOffset + 9] * 0x100) & 0x3fff
    return width > 0 && height > 0 ? { width, height } : null
  }
  return null
}

function hasValidWebpStructure(bytes: Uint8Array) {
  if (bytes.length < 20 || uint32LittleEndian(bytes, 4) !== bytes.length - 8) return false
  let offset = 12
  let chunkCount = 0
  let extended = false
  let flags = 0
  let canvas: { width: number; height: number } | null = null
  let image: { name: string; width: number; height: number } | null = null
  let sawIccProfile = false
  let sawAlpha = false

  while (offset < bytes.length) {
    chunkCount += 1
    if (chunkCount > MAX_IMAGE_CONTAINER_CHUNKS) return false
    if (bytes.length - offset < 8) return false
    const name = chunkName(bytes, offset)
    const length = uint32LittleEndian(bytes, offset + 4)
    const dataOffset = offset + 8
    if (length > bytes.length - dataOffset) return false
    const dataEnd = dataOffset + length
    const paddedEnd = dataEnd + (length % 2)
    if (paddedEnd > bytes.length || (length % 2 === 1 && bytes[dataEnd] !== 0)) return false

    if (offset === 12 && name === 'VP8X') {
      if (length !== 10) return false
      flags = bytes[dataOffset]
      if ((flags & 0xc1) !== 0 || (flags & 0x0e) !== 0) return false
      if (bytes[dataOffset + 1] !== 0 || bytes[dataOffset + 2] !== 0 || bytes[dataOffset + 3] !== 0) return false
      const width = uint24LittleEndian(bytes, dataOffset + 4) + 1
      const height = uint24LittleEndian(bytes, dataOffset + 7) + 1
      if (width * height > 0xffffffff) return false
      canvas = { width, height }
      extended = true
    } else if (!extended) {
      if (offset !== 12 || image) return false
      const dimensions = webpBitstreamDimensions(bytes, name, dataOffset, length)
      if (!dimensions || paddedEnd !== bytes.length) return false
      image = { name, ...dimensions }
    } else if (name === 'VP8X' || name === 'ANIM' || name === 'ANMF' || name === 'EXIF' || name === 'XMP ') {
      return false
    } else if (name === 'ICCP') {
      if (sawIccProfile || image || length === 0) return false
      sawIccProfile = true
    } else if (name === 'ALPH') {
      if (sawAlpha || image || length === 0 || (bytes[dataOffset] & 0xc0) !== 0) return false
      sawAlpha = true
    } else if (name === 'VP8 ' || name === 'VP8L') {
      if (image || (name === 'VP8L' && sawAlpha)) return false
      const dimensions = webpBitstreamDimensions(bytes, name, dataOffset, length)
      if (!dimensions || !canvas || dimensions.width !== canvas.width || dimensions.height !== canvas.height) return false
      image = { name, ...dimensions }
    } else if (!image) {
      return false
    }

    offset = paddedEnd
  }

  if (!image) return false
  if (!extended) return true
  if (Boolean(flags & 0x20) !== sawIccProfile) return false
  if (image.name === 'VP8 ' && Boolean(flags & 0x10) !== sawAlpha) return false
  return true
}

function jpegImageDimensions(bytes: Uint8Array) {
  let offset = 2
  let markerCount = 0
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return null
    const marker = bytes[offset++]
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    markerCount += 1
    if (markerCount > MAX_IMAGE_CONTAINER_CHUNKS || marker === 0xd8 || marker === 0xd9 || offset + 2 > bytes.length) return null
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2 || length > bytes.length - offset) return null
    const isFrameMarker = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrameMarker) {
      if (length < 8) return null
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6]
      }
    }
    offset += length
  }
  return null
}

function productImageDimensions(contentType: string, bytes: Uint8Array) {
  if (contentType === 'image/png') return { width: uint32BigEndian(bytes, 16), height: uint32BigEndian(bytes, 20) }
  if (contentType === 'image/jpeg') return jpegImageDimensions(bytes)
  if (contentType === 'image/webp') {
    const name = chunkName(bytes, 12)
    if (name === 'VP8X') return { width: uint24LittleEndian(bytes, 24) + 1, height: uint24LittleEndian(bytes, 27) + 1 }
    return webpBitstreamDimensions(bytes, name, 20, uint32LittleEndian(bytes, 16))
  }
  return null
}

function hasSafeProductImageDimensions(contentType: string, bytes: Uint8Array) {
  const dimensions = productImageDimensions(contentType, bytes)
  return Boolean(dimensions
    && dimensions.width > 0 && dimensions.height > 0
    && dimensions.width <= MAX_PRODUCT_IMAGE_DIMENSION && dimensions.height <= MAX_PRODUCT_IMAGE_DIMENSION
    && dimensions.width * dimensions.height <= MAX_PRODUCT_IMAGE_PIXELS)
}

function hasPrivateImageMetadata(contentType: string, bytes: Uint8Array) {
  if (contentType === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return true
    let offset = 2
    let inScan = false
    let sawFrame = false
    let sawScan = false
    let markerCount = 0
    while (offset < bytes.length) {
      const markerWasInScan: boolean = inScan
      if (bytes[offset] !== 0xff) {
        if (!inScan) return true
        offset += 1
        continue
      }

      let fillBytes = 0
      while (offset < bytes.length && bytes[offset] === 0xff) {
        fillBytes += 1
        offset += 1
      }
      if (offset >= bytes.length) return true
      const marker = bytes[offset++]

      if (marker === 0x00) {
        if (!inScan || fillBytes !== 1) return true
        continue
      }
      if (marker >= 0xd0 && marker <= 0xd7) {
        if (!inScan) return true
        continue
      }
      if (marker === 0x01) continue
      markerCount += 1
      if (markerCount > MAX_IMAGE_CONTAINER_CHUNKS) return true
      if (marker === 0xe1 || marker === 0xed || marker === 0xfe) return true
      if (marker === 0xd9) return offset !== bytes.length || !sawFrame || !sawScan
      if (marker === 0xd8 || marker < 0xc0) return true
      if (offset + 2 > bytes.length) return true

      const length = (bytes[offset] << 8) | bytes[offset + 1]
      if (length < 2 || length > bytes.length - offset) return true
      const isFrameMarker = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrameMarker) {
        if (sawFrame || length < 8) return true
        const componentCount = bytes[offset + 7]
        if (componentCount < 1 || componentCount > 4 || length !== 8 + componentCount * 3) return true
        sawFrame = true
      }
      if (marker === 0xda) {
        if (!sawFrame || length < 6) return true
        const componentCount = bytes[offset + 2]
        if (componentCount < 1 || componentCount > 4 || length !== 6 + componentCount * 2) return true
        sawScan = true
      }
      if (marker === 0xdc && length !== 4) return true
      offset += length
      inScan = marker === 0xda || (markerWasInScan && marker === 0xdc)
    }
    return true
  }
  if (contentType === 'image/png') {
    const metadataChunks = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt'])
    let offset = 8
    let chunkCount = 0
    while (offset + 12 <= bytes.length) {
      chunkCount += 1
      if (chunkCount > MAX_IMAGE_CONTAINER_CHUNKS) return true
      const length = ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]
      if (metadataChunks.has(chunkName(bytes, offset + 4))) return true
      offset += 12 + length
    }
    return false
  }
  if (contentType === 'image/webp') {
    let offset = 12
    let chunkCount = 0
    while (offset + 8 <= bytes.length) {
      chunkCount += 1
      if (chunkCount > MAX_IMAGE_CONTAINER_CHUNKS) return true
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

function sessionUnavailable() {
  return json({ error: '未能建立登入工作階段。 Unable to create session.' }, { status: 503 })
}

function sessionAuthorizationUnavailable(includeAuthenticationState = false) {
  const error = '登入工作階段暫時無法確認。 Session authorization is temporarily unavailable.'
  return json(includeAuthenticationState
    ? { authenticated: false, code: 'unavailable', error }
    : { code: 'unavailable', error }, { status: 503 })
}

async function removeUndeliveredSession(env: Env, tokenHash: string) {
  try {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
  } catch {
    console.error('undelivered-session-cleanup-failed')
  }
}

async function sessionResponse(env: Env, request: Request, userId: string, status = 200) {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await sha256(token)
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  try {
    await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(tokenHash, userId, expiresAt).run()
  } catch {
    try {
      const stored = await env.DB.prepare(`
        SELECT user_id AS userId, expires_at AS expiresAt
        FROM sessions
        WHERE token_hash = ?
      `).bind(tokenHash).first<{ userId: string; expiresAt: string }>()
      if (!stored || stored.userId !== userId || stored.expiresAt !== expiresAt) {
        if (stored) console.error('session-create-reconciliation-conflict')
        return sessionUnavailable()
      }
    } catch {
      console.error('session-create-reconciliation-failed')
      await removeUndeliveredSession(env, tokenHash)
      return sessionUnavailable()
    }
  }
  let session: SessionContext | null
  try {
    session = await loadSessionByHash(env, tokenHash)
  } catch {
    console.error('session-authorization-reload-failed')
    await removeUndeliveredSession(env, tokenHash)
    return sessionUnavailable()
  }
  if (!session) {
    await removeUndeliveredSession(env, tokenHash)
    return sessionUnavailable()
  }
  return json({ user: session.user, currentWorkspace: session.currentWorkspace }, { status, headers: { 'set-cookie': sessionCookie(token, request) } })
}

async function workspacesForUser(env: Env, userId: string) {
  const result = await env.DB.prepare(`
    SELECT w.id, w.name, w.access_status AS accessStatus, wm.role, COALESCE(oa.available, 0) AS availableOutputs, COALESCE(oa.reserved, 0) AS reservedOutputs
    FROM workspace_memberships wm
    JOIN workspaces w ON w.id = wm.workspace_id
    LEFT JOIN output_allowances oa ON oa.workspace_id = w.id
    WHERE wm.user_id = ? AND w.access_status = 'active'
    ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
      wm.created_at ASC, w.created_at ASC, w.id ASC
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
  try {
    await env.DB.prepare('UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?').bind(tokenHash).run()
  } catch {
    console.error('session-last-seen-update-failed')
  }
  return { user, currentWorkspace: workspaces[0] }
}

async function accessSession(request: Request, env: Env): Promise<SessionContext | Response> {
  const identity = await verifyAccessIdentity(request, env)
  if (identity instanceof Response) return identity
  const subjectHash = await sha256(identity.subject)
  let user: AuthUser | null
  try {
    user = await env.DB.prepare(`
      SELECT id, email, name, account_status AS accountStatus, account_type AS accountType
      FROM users
      WHERE access_subject_hash = ? AND auth_mode = 'access' AND account_status = 'active'
    `).bind(subjectHash).first<AuthUser>()
  } catch {
    console.error('access-subject-lookup-failed')
    return accessError('unavailable', 503, 'Access account lookup is temporarily unavailable.')
  }

  if (user && normalizeEmail(user.email) !== identity.email) {
    return accessError('membership-required', 403, 'The verified identity does not match this workspace account.')
  }

  if (!user) {
    let emailAccount: (AuthUser & { authMode: 'password' | 'access'; accessSubjectHash: string | null }) | null
    try {
      emailAccount = await env.DB.prepare(`
        SELECT id, email, name, account_status AS accountStatus, account_type AS accountType,
          auth_mode AS authMode, access_subject_hash AS accessSubjectHash
        FROM users
        WHERE email = ?
      `).bind(identity.email).first<AuthUser & { authMode: 'password' | 'access'; accessSubjectHash: string | null }>()
    } catch {
      console.error('access-email-lookup-failed')
      return accessError('unavailable', 503, 'Access account onboarding is temporarily unavailable.')
    }

    if (emailAccount) {
      if (emailAccount.accountStatus !== 'active' || (emailAccount.accessSubjectHash && emailAccount.accessSubjectHash !== subjectHash)) {
        return accessError('membership-required', 403, 'This identity does not have an active workspace membership.')
      }
      let subjectUpdateReportedFailure = false
      try {
        await env.DB.prepare(`
          UPDATE users
          SET access_subject_hash = ?, auth_mode = 'access', name = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND (access_subject_hash IS NULL OR access_subject_hash = ?)
        `).bind(subjectHash, identity.name, emailAccount.id, subjectHash).run()
      } catch {
        subjectUpdateReportedFailure = true
      }
      try {
        user = await env.DB.prepare(`
          SELECT id, email, name, account_status AS accountStatus, account_type AS accountType
          FROM users
          WHERE id = ? AND email = ? AND name = ? AND access_subject_hash = ?
            AND auth_mode = 'access' AND account_status = 'active'
        `).bind(emailAccount.id, identity.email, identity.name, subjectHash).first<AuthUser>()
      } catch {
        console.error('access-subject-reconciliation-failed')
        return accessError('unavailable', 503, 'Access account binding is temporarily unavailable.')
      }
      if (subjectUpdateReportedFailure && !user) {
        console.error('access-subject-reconciliation-conflict')
        return accessError('unavailable', 503, 'Access account binding is temporarily unavailable.')
      }
    } else if (env.ACCESS_AUTO_PROVISION === 'enabled') {
      const userId = crypto.randomUUID()
      const workspaceId = crypto.randomUUID()
      const randomPassword = base64Url(crypto.getRandomValues(new Uint8Array(32)))
      const passwordHash = await hashPassword(randomPassword)
      let provisionReportedFailure = false
      try {
        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO users (id, email, name, password_hash, password_salt, account_type, auth_mode, access_subject_hash)
            VALUES (?, ?, ?, ?, ?, 'beta', 'access', ?)
          `).bind(userId, identity.email, identity.name, passwordHash.hash, passwordHash.salt, subjectHash),
          env.DB.prepare('INSERT INTO workspaces (id, owner_user_id, name, plan_status, access_status) VALUES (?, ?, ?, ?, ?)').bind(workspaceId, userId, 'AisleStage 工作區', 'active', 'active'),
          env.DB.prepare('INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (?, ?, ?)').bind(workspaceId, userId, 'owner'),
          env.DB.prepare('INSERT INTO output_allowances (workspace_id, available, reserved) VALUES (?, ?, 0)').bind(workspaceId, initialOutputAllowance(env))
        ])
      } catch {
        provisionReportedFailure = true
      }
      try {
        user = await env.DB.prepare(`
          SELECT id, email, name, account_status AS accountStatus, account_type AS accountType
          FROM users
          WHERE access_subject_hash = ? AND email = ? AND auth_mode = 'access' AND account_status = 'active'
        `).bind(subjectHash, identity.email).first<AuthUser>()
      } catch {
        console.error('access-provision-reconciliation-failed')
        return accessError('unavailable', 503, 'Access workspace provisioning is temporarily unavailable.')
      }
      if (!user) {
        if (provisionReportedFailure) console.error('access-provision-reconciliation-missing')
        return accessError('unavailable', 503, 'Access workspace provisioning is temporarily unavailable.')
      }
    }
  }

  if (!user) return accessError('membership-required', 403, 'This Access identity has not been invited to an AisleStage workspace.')
  let workspaces: Workspace[]
  try {
    workspaces = await workspacesForUser(env, user.id)
  } catch {
    console.error('access-workspace-reconciliation-failed')
    return accessError('unavailable', 503, 'Access workspace membership is temporarily unavailable.')
  }
  if (!workspaces[0]) return accessError('membership-required', 403, 'This account has no active workspace membership.')
  return { user, currentWorkspace: workspaces[0] }
}

async function cleanExpiredAuthState(env: Env) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP'),
    env.DB.prepare("DELETE FROM auth_attempts WHERE created_at < datetime('now', ?)").bind(`-${MAX_AUTH_ATTEMPT_DAYS} days`),
    env.DB.prepare(`
      DELETE FROM beta_invites
      WHERE (status IN ('pending', 'revoked') AND expires_at <= CURRENT_TIMESTAMP)
        OR (status = 'used' AND used_at IS NOT NULL AND used_at < datetime('now', ?))
    `).bind(`-${MAX_USED_INVITE_DAYS} days`)
  ])
}

async function requireSession(request: Request, env: Env): Promise<SessionContext | Response> {
  if (authMode(env) === 'access') return accessSession(request, env)
  const token = parseCookie(request, SESSION_COOKIE)
  if (!token) return json({ error: 'Authentication required.' }, { status: 401 })
  let session: SessionContext | null
  try {
    session = await loadSessionByHash(env, await sha256(token))
  } catch {
    console.error('session-authorization-read-failed')
    return sessionAuthorizationUnavailable()
  }
  if (!session) return json({ error: 'Authentication required.' }, { status: 401, headers: { 'set-cookie': expiredSessionCookie(request) } })
  return session
}

async function workspaceApp(request: Request, env: Env, activeAuthMode: 'access' | 'password') {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'Method not allowed.' }, { status: 405, headers: { allow: 'GET, HEAD' } })
  }

  if (activeAuthMode === 'access') {
    const session = await requireSession(request, env)
    if (session instanceof Response) {
      return loginRedirect(request, normalizeAccessFailureReason(session.headers.get(ACCESS_FAILURE_HEADER)) || 'authentication-required')
    }
  }

  try {
    const assetResponse = await env.ASSETS.fetch(request)
    const headers = new Headers(assetResponse.headers)
    headers.set('cache-control', 'private, no-store')
    headers.set('x-content-type-options', 'nosniff')
    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers
    })
  } catch {
    return activeAuthMode === 'access'
      ? loginRedirect(request, 'unavailable')
      : json({ error: 'Workspace application is unavailable.' }, { status: 503 })
  }
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
  if (!hasMediaType(request, 'multipart/form-data')) return unsupportedMediaType(request, 'multipart/form-data')

  const bounded = await readBoundedRequestBytes(request, MAX_UPLOAD_REQUEST_BYTES)
  if (bounded.tooLarge) return json({ error: '圖片檔案不可超過 4 MB。' }, { status: 413 })
  if (!bounded.bytes) return json({ error: 'Unable to read multipart upload.' }, { status: 400 })
  const headers = new Headers({ 'content-type': request.headers.get('content-type')! })
  const boundedRequest = new Request(request.url, { method: 'POST', headers, body: bounded.bytes as BodyInit })
  const form = await boundedRequest.formData().catch(() => null)
  const value = form?.get('file')
  if (!(value instanceof File)) return json({ error: '請選擇商品圖片。' }, { status: 400 })
  if (!productImageTypes.has(value.type)) return json({ error: '只支援 PNG、JPEG 或靜態 WebP 圖片。' }, { status: 415 })
  if (value.size <= 0 || value.size > MAX_PRODUCT_IMAGE_BYTES) return json({ error: '圖片檔案不可超過 4 MB。' }, { status: 413 })

  const bytes = new Uint8Array(await value.arrayBuffer())
  if (!hasValidProductImageSignature(value.type, bytes)) return json({ error: '圖片內容與檔案格式不符。' }, { status: 415 })
  if (hasPrivateImageMetadata(value.type, bytes)) {
    return json({ error: '圖片含有 EXIF、XMP、文字 metadata 或過度複雜結構；請重新匯出後再上傳。 Invalid image metadata or structure; export the image again.' }, { status: 400 })
  }
  if ((value.type === 'image/png' && !hasValidPngStructure(bytes)) || (value.type === 'image/webp' && !hasValidWebpStructure(bytes))) {
    return json({ error: '圖片檔案結構無效，請重新匯出後再上傳。 Invalid image structure; export the image again.' }, { status: 400 })
  }
  if (!hasSafeProductImageDimensions(value.type, bytes)) {
    return json({ error: '圖片尺寸不可超過 8192 px 單邊或 3,200 萬像素。 Image dimensions must not exceed 8192 px per side or 32 megapixels.' }, { status: 413 })
  }

  const assetId = crypto.randomUUID()
  const storedFilename = `product-image.${extensionForContentType(value.type)}`
  const objectKey = `workspaces/${session.currentWorkspace.id}/assets/product-source/${assetId}.${extensionForContentType(value.type)}`
  const contentDigest = await sha256Bytes(bytes)
  const contentSha256 = base64Url(new Uint8Array(contentDigest))
  const createdResponse = () => json({
    asset: {
      id: assetId,
      name: storedFilename,
      contentType: value.type,
      sizeBytes: value.size,
      previewUrl: `/api/assets/${assetId}`
    }
  }, { status: 201 })

  try {
    const stored = await env.MEDIA_BUCKET.put(objectKey, bytes, {
      httpMetadata: { contentType: value.type },
      customMetadata: { kind: 'product-source', workspaceId: session.currentWorkspace.id },
      sha256: contentDigest
    })
    if (!stored || r2Sha256(stored) !== contentSha256) throw new TypeError('Product asset storage integrity verification failed.')
  } catch {
    await env.MEDIA_BUCKET.delete(objectKey).catch(() => null)
    return json({ error: '未能儲存商品圖片。' }, { status: 503 })
  }

  try {
    await env.DB.prepare(`
      INSERT INTO media_assets (
        id, workspace_id, created_by_user_id, kind, object_key,
        original_filename, content_type, size_bytes, content_sha256
      )
      VALUES (?, ?, ?, 'product-source', ?, ?, ?, ?, ?)
    `).bind(assetId, session.currentWorkspace.id, session.user.id, objectKey, storedFilename, value.type, value.size, contentSha256).run()
  } catch {
    try {
      const committed = await productAssetForWorkspace(env, session.currentWorkspace.id, assetId)
      if (committed) {
        if (committed.objectKey === objectKey
          && committed.contentType === value.type
          && committed.sizeBytes === value.size
          && committed.contentSha256 === contentSha256) return createdResponse()
        return json({ error: '未能核對商品圖片記錄。 Unable to reconcile the product image record.' }, { status: 503 })
      }
    } catch {
      console.error('product-asset-upload-reconciliation-failed')
      return json({ error: '未能核對商品圖片記錄。 Unable to reconcile the product image record.' }, { status: 503 })
    }
    await env.MEDIA_BUCKET.delete(objectKey).catch(() => null)
    return json({ error: '未能儲存商品圖片。' }, { status: 503 })
  }

  return createdResponse()
}

type StoredProductAsset = {
  objectKey: string
  workspaceId: string
  contentType: 'image/png' | 'image/jpeg' | 'image/webp'
  sizeBytes: number
  contentSha256: string | null
}

async function productAssetForWorkspace(env: Env, workspaceId: string, assetId: string) {
  return env.DB.prepare(`
    SELECT a.object_key AS objectKey, a.workspace_id AS workspaceId,
      a.content_type AS contentType, a.size_bytes AS sizeBytes,
      a.content_sha256 AS contentSha256
    FROM media_assets a
    JOIN workspaces w ON w.id = a.workspace_id
    WHERE a.id = ? AND a.workspace_id = ? AND a.kind = 'product-source'
      AND w.access_status = 'active'
  `).bind(assetId, workspaceId).first<StoredProductAsset>()
}

function hasCanonicalProductAssetMetadata(asset: StoredProductAsset, object: R2Object) {
  const metadata = object.customMetadata
  return productImageTypes.has(asset.contentType)
    && Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0 && object.size === asset.sizeBytes
    && typeof asset.contentSha256 === 'string' && /^[A-Za-z0-9_-]{43}$/.test(asset.contentSha256)
    && r2Sha256(object) === asset.contentSha256
    && object.httpMetadata?.contentType === asset.contentType
    && metadata?.kind === 'product-source'
    && metadata?.workspaceId === asset.workspaceId
}

function invalidProductAsset() {
  return json({ error: '商品圖片完整性驗證失敗，請重新上傳。 Product image integrity check failed; upload it again.' }, { status: 409 })
}

function productAssetNotFound() {
  return json({ error: '找不到這張商品圖片。 Product asset not found.' }, { status: 404 })
}

async function productAsset(request: Request, env: Env, session: SessionContext, assetId: string) {
  const asset = await productAssetForWorkspace(env, session.currentWorkspace.id, assetId)
  if (!asset) return json({ error: 'Image not found.' }, { status: 404 })
  const object = await env.MEDIA_BUCKET.get(asset.objectKey)
  if (!object) return json({ error: 'Image not found.' }, { status: 404 })
  if (!hasCanonicalProductAssetMetadata(asset, object)) {
    await object.body.cancel().catch(() => undefined)
    return invalidProductAsset()
  }
  return new Response(object.body, { headers: { 'content-type': asset.contentType, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } })
}

async function deleteProductAsset(env: Env, session: SessionContext, assetId: string) {
  const asset = await env.DB.prepare(`
    SELECT a.object_key AS objectKey, a.workspace_id AS workspaceId
    FROM media_assets a
    JOIN workspaces w ON w.id = a.workspace_id
    WHERE a.id = ? AND a.workspace_id = ? AND a.kind = 'product-source' AND w.access_status = 'active'
  `).bind(assetId, session.currentWorkspace.id).first<{ objectKey: string; workspaceId: string }>()
  if (!asset) return json({ error: 'Image not found.' }, { status: 404 })
  const deletedResponse = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  try {
    // Keep the D1 row as the retry anchor until private storage and Agent cleanup succeed.
    await env.MEDIA_BUCKET.delete(asset.objectKey)
    const agent = await getAgentByName(env.CAMPAIGN_AGENT, asset.workspaceId)
    await agent.resetPlanForAsset(assetId)
    await env.DB.prepare('DELETE FROM media_assets WHERE id = ? AND workspace_id = ?').bind(assetId, asset.workspaceId).run()
    return deletedResponse()
  } catch {
    try {
      const remaining = await env.DB.prepare(`
        SELECT 1 AS present
        FROM media_assets
        WHERE id = ? AND workspace_id = ? AND kind = 'product-source'
      `).bind(assetId, asset.workspaceId).first<{ present: number }>()
      if (!remaining) return deletedResponse()
      console.error('product-asset-delete-reconciliation-pending')
    } catch {
      console.error('product-asset-delete-reconciliation-failed')
    }
    return json({ error: '未能刪除商品圖片。 Unable to delete product image.' }, { status: 503 })
  }
}

async function campaignAgentRequest(request: Request, env: Env, session: SessionContext, action: 'state' | 'plan' | 'approve') {
  const agent = await getAgentByName(env.CAMPAIGN_AGENT, session.currentWorkspace.id)
  try {
    if (request.method === 'GET' && action === 'state') return json({ state: await agent.getPlan() })
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, { status: 405 })
    if (!hasJsonContent(request)) return unsupportedMediaType(request, 'application/json')
    const parsed = await readBody(request, MAX_AGENT_BODY_BYTES)
    if (parsed.tooLarge) return json({ error: 'Campaign Agent 請求過大。 Campaign Agent payload is too large.' }, { status: 413 })
    const body = parsed.body && typeof parsed.body === 'object' ? parsed.body as Record<string, unknown> : {}
    if (action === 'plan') {
      const keys = Object.keys(body)
      const briefValue = body.brief
      if (keys.length !== 1 || keys[0] !== 'brief' || !briefValue || typeof briefValue !== 'object' || Array.isArray(briefValue)) {
        return json({ error: 'Campaign Brief 請求格式無效。 Campaign Brief request must contain exactly one brief object.' }, { status: 400 })
      }
      const briefIssues = validateCampaignBrief(briefValue)
      if (briefIssues.length) return json({ error: briefIssues[0], issues: briefIssues }, { status: 422 })
      const brief = sanitizeCampaignBrief(briefValue)
      if (brief.assetId) {
        const asset = await productAssetForWorkspace(env, session.currentWorkspace.id, brief.assetId)
        if (!asset) return productAssetNotFound()
        const object = await env.MEDIA_BUCKET.head(asset.objectKey)
        if (!object || !hasCanonicalProductAssetMetadata(asset, object)) return invalidProductAsset()
      }
      return json({ state: await agent.planBrief(brief) })
    }
    if (action === 'approve') {
      const keys = Object.keys(body)
      const revision = body.revision
      if (keys.length !== 1 || keys[0] !== 'revision' || !Number.isSafeInteger(revision) || Number(revision) <= 0) {
        return json({ error: '批准版本格式無效。 Approval revision must be a positive integer.' }, { status: 400 })
      }
      const state = await agent.getPlan()
      if (state.stage === 'awaiting-approval' && state.brief?.assetId) {
        const asset = await productAssetForWorkspace(env, session.currentWorkspace.id, state.brief.assetId)
        const object = asset ? await env.MEDIA_BUCKET.head(asset.objectKey) : null
        if (!asset || !object || !hasCanonicalProductAssetMetadata(asset, object)) return invalidProductAsset()
      }
      const result = await agent.approvePlan(revision as number)
      return result.ok ? json({ state: result.state, replayed: result.replayed }) : json({ error: result.error }, { status: 409 })
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

async function requireCurrentGenerationExecution(
  env: Env,
  generationId: string,
  processingAttempt: number,
  input: GenerationInput
) {
  const current = await env.DB.prepare(`
    SELECT 1 AS current
    FROM generations g
    JOIN workspaces w ON w.id = g.workspace_id
    JOIN media_assets a ON a.workspace_id = w.id
    WHERE g.id = ? AND g.workspace_id = ?
      AND g.status = 'processing' AND g.processing_attempt = ?
      AND w.access_status = 'active'
      AND a.id = ? AND a.kind = 'product-source'
  `).bind(generationId, input.workspaceId, processingAttempt, input.referenceAssetIds[0]).first<{ current: number }>()
  if (!current || !await approvedGenerationInput(env, input)) {
    throw new TerminalGenerationError('Generation execution approval is stale.')
  }
}

async function generationSourceAsset(env: Env, input: GenerationInput) {
  const asset = await productAssetForWorkspace(env, input.workspaceId, input.referenceAssetIds[0])
  if (!asset) throw new TerminalGenerationError('Approved product asset is unavailable.')
  const object = await env.MEDIA_BUCKET.get(asset.objectKey)
  if (!object) throw new TerminalGenerationError('Approved product asset is unavailable.')
  if (!hasCanonicalProductAssetMetadata(asset, object)) {
    await object.body.cancel().catch(() => undefined)
    throw new TerminalGenerationError('Approved product asset integrity check failed.')
  }
  return {
    base64: bytesToBase64(new Uint8Array(await object.arrayBuffer())),
    contentType: asset.contentType
  }
}

async function reconcilePasswordRegistration(
  env: Env,
  expected: {
    userId: string
    email: string
    name: string
    passwordHash: string
    passwordSalt: string
    accountType: AccountType
    workspaceId: string
    workspaceName: string
    initialAllowance: number
    invite: { id: string; accountType: 'beta' | 'test' } | null
  }
): Promise<'committed' | 'not-committed' | 'conflict'> {
  const user = await env.DB.prepare(`
    SELECT email, name, password_hash AS passwordHash, password_salt AS passwordSalt,
      account_status AS accountStatus, account_type AS accountType,
      auth_mode AS authMode, access_subject_hash AS accessSubjectHash
    FROM users
    WHERE id = ?
  `).bind(expected.userId).first<{
    email: string
    name: string
    passwordHash: string
    passwordSalt: string
    accountStatus: string
    accountType: string
    authMode: string
    accessSubjectHash: string | null
  }>()
  if (!user) {
    const generatedArtifacts = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM workspaces WHERE id = ?) AS workspaces,
        (SELECT COUNT(*) FROM workspace_memberships WHERE workspace_id = ? OR user_id = ?) AS memberships,
        (SELECT COUNT(*) FROM output_allowances WHERE workspace_id = ?) AS allowances
    `).bind(expected.workspaceId, expected.workspaceId, expected.userId, expected.workspaceId).first<{
      workspaces: number
      memberships: number
      allowances: number
    }>()
    return generatedArtifacts
      && generatedArtifacts.workspaces === 0
      && generatedArtifacts.memberships === 0
      && generatedArtifacts.allowances === 0
      ? 'not-committed'
      : 'conflict'
  }
  if (user.email !== expected.email
    || user.name !== expected.name
    || user.passwordHash !== expected.passwordHash
    || user.passwordSalt !== expected.passwordSalt
    || user.accountStatus !== 'active'
    || user.accountType !== expected.accountType
    || user.authMode !== 'password'
    || user.accessSubjectHash !== null) return 'conflict'

  const [workspace, membership, allowance] = await Promise.all([
    env.DB.prepare(`
      SELECT owner_user_id AS ownerUserId, name, plan_status AS planStatus,
        access_status AS accessStatus
      FROM workspaces
      WHERE id = ?
    `).bind(expected.workspaceId).first<{
      ownerUserId: string
      name: string
      planStatus: string
      accessStatus: string
    }>(),
    env.DB.prepare(`
      SELECT role
      FROM workspace_memberships
      WHERE workspace_id = ? AND user_id = ?
    `).bind(expected.workspaceId, expected.userId).first<{ role: string }>(),
    env.DB.prepare(`
      SELECT available, reserved
      FROM output_allowances
      WHERE workspace_id = ?
    `).bind(expected.workspaceId).first<{ available: number; reserved: number }>()
  ])
  if (!workspace
    || workspace.ownerUserId !== expected.userId
    || workspace.name !== expected.workspaceName
    || workspace.planStatus !== 'active'
    || workspace.accessStatus !== 'active'
    || membership?.role !== 'owner'
    || allowance?.available !== expected.initialAllowance
    || allowance.reserved !== 0) return 'conflict'

  if (expected.invite) {
    const invite = await env.DB.prepare(`
      SELECT account_type AS accountType, status, used_by_user_id AS usedByUserId,
        used_at AS usedAt
      FROM beta_invites
      WHERE id = ?
    `).bind(expected.invite.id).first<{
      accountType: string
      status: string
      usedByUserId: string | null
      usedAt: string | null
    }>()
    if (!invite
      || invite.accountType !== expected.invite.accountType
      || invite.status !== 'used'
      || invite.usedByUserId !== expected.userId
      || !invite.usedAt) return 'conflict'
  }

  return 'committed'
}

async function register(request: Request, env: Env) {
  const mode = registrationMode(env)
  if (mode === 'closed') return json({ error: 'AisleStage 現時只開放已有帳號登入。' }, { status: 403 })
  if (!hasJsonContent(request)) return unsupportedMediaType(request, 'application/json')
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
    try {
      const reconciliation = await reconcilePasswordRegistration(env, {
        userId,
        email,
        name,
        passwordHash: passwordHash.hash,
        passwordSalt: passwordHash.salt,
        accountType: invite?.accountType || 'standard',
        workspaceId,
        workspaceName,
        initialAllowance: initialOutputAllowance(env),
        invite
      })
      if (reconciliation !== 'committed') {
        if (reconciliation === 'conflict') console.error('password-registration-reconciliation-conflict')
        await recordAuthAttempt(env, request, 'register_failed', email)
        return json({ error: invite ? '邀請註冊未能完成，請重新取得邀請。' : '這個電郵已經註冊。' }, { status: 409 })
      }
    } catch {
      console.error('password-registration-reconciliation-failed')
      return json({ error: '註冊狀態暫時無法確認。 Registration state is temporarily unavailable.' }, { status: 503 })
    }
  }
  await recordAuthAttempt(env, request, 'register_success', email)
  return sessionResponse(env, request, userId, 201)
}

async function login(request: Request, env: Env) {
  if (!hasJsonContent(request)) return unsupportedMediaType(request, 'application/json')
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
  if (token) {
    const tokenHash = await sha256(token)
    try {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
    } catch {
      try {
        const existing = await env.DB.prepare('SELECT 1 AS existing FROM sessions WHERE token_hash = ?')
          .bind(tokenHash)
          .first<{ existing: number }>()
        if (existing) return json({ error: '未能確認登出狀態。 Unable to confirm logout.' }, { status: 503 })
      } catch {
        console.error('session-delete-reconciliation-failed')
        return json({ error: '未能確認登出狀態。 Unable to confirm logout.' }, { status: 503 })
      }
    }
  }
  return json({ ok: true }, { headers: { 'set-cookie': expiredSessionCookie(request) } })
}

async function reserveOutput(env: Env, workspaceId: string, generationId: string) {
  const activeLimit = maxActiveGenerations(env)
  const [ledger, balance] = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO output_ledger (id, workspace_id, generation_id, event_type, amount, note)
      SELECT ?, ?, ?, 'reservation', ?, 'Output allowance reservation'
      WHERE EXISTS (
        SELECT 1 FROM output_allowances
        WHERE workspace_id = ? AND available >= ? AND reserved + ? <= ?
      )
    `).bind(crypto.randomUUID(), workspaceId, generationId, -OUTPUT_COST, workspaceId, OUTPUT_COST, OUTPUT_COST, activeLimit),
    env.DB.prepare(`
      UPDATE output_allowances
      SET available = available - ?, reserved = reserved + ?, updated_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND available >= ? AND reserved + ? <= ? AND changes() = 1
    `).bind(OUTPUT_COST, OUTPUT_COST, workspaceId, OUTPUT_COST, OUTPUT_COST, activeLimit)
  ])
  if (!ledger.meta.changes || !balance.meta.changes) {
    const current = await env.DB.prepare('SELECT available, reserved FROM output_allowances WHERE workspace_id = ?')
      .bind(workspaceId)
      .first<{ available: number; reserved: number }>()
    if (current && current.reserved + OUTPUT_COST > activeLimit) throw new Error('ACTIVE_GENERATION_LIMIT')
    throw new Error('INSUFFICIENT_OUTPUT_ALLOWANCE')
  }
}

async function reconcileGenerationReservation(env: Env, workspaceId: string, generationId: string): Promise<'committed' | 'not-committed' | 'conflict'> {
  const ledger = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN event_type = 'reservation' AND amount = ? THEN 1 ELSE 0 END) AS reservations,
      SUM(CASE WHEN event_type = 'settlement' THEN 1 ELSE 0 END) AS settlements,
      SUM(CASE WHEN event_type = 'release' THEN 1 ELSE 0 END) AS releases
    FROM output_ledger
    WHERE workspace_id = ? AND generation_id = ?
  `).bind(-OUTPUT_COST, workspaceId, generationId).first<{ total: number; reservations: number; settlements: number; releases: number }>()
  if (!ledger?.total) return 'not-committed'
  return ledger.total === 1 && ledger.reservations === 1 && ledger.settlements === 0 && ledger.releases === 0
    ? 'committed'
    : 'conflict'
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

async function failGenerationAndRelease(
  env: Env,
  workspaceId: string,
  generationId: string,
  reason: string,
  processingAttempt: number | null = null
) {
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE generations
      SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ?
        AND (
          (? IS NULL AND status = 'queued')
          OR (? IS NOT NULL AND status = 'processing' AND processing_attempt = ?)
        )
    `).bind(
      reason.slice(0, 500),
      generationId,
      workspaceId,
      processingAttempt,
      processingAttempt,
      processingAttempt
    ),
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

async function completeGenerationAndSettle(
  env: Env,
  workspaceId: string,
  generationId: string,
  processingAttempt: number,
  outputKey: string,
  outputContentType: string,
  outputSha256: string,
  completedMode: CompletedGenerationMode
) {
  const [completion] = await env.DB.batch([
    env.DB.prepare(`
      UPDATE generations
      SET status = 'completed', output_key = ?, output_content_type = ?,
        review_status = 'draft', reviewed_at = NULL, reviewed_by_user_id = NULL,
        composition_version = ?, generation_mode = ?, output_sha256 = ?, error_message = NULL,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workspace_id = ? AND status = 'processing' AND processing_attempt = ?
    `).bind(outputKey, outputContentType, CAMPAIGN_COMPOSITION_VERSION, completedMode, outputSha256, generationId, workspaceId, processingAttempt),
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
  if (!completion.meta.changes) throw new TerminalGenerationError('Generation processing attempt is stale.')
}

async function reconcileGenerationCompletion(
  env: Env,
  workspaceId: string,
  generationId: string,
  input: GenerationInput,
  outputKey: string,
  outputSha256: string,
  completedMode: CompletedGenerationMode
): Promise<'committed' | 'not-committed' | 'conflict'> {
  const row = await env.DB.prepare(`
    SELECT g.id, g.campaign_pack_id AS campaignPackId, g.workflow_id AS workflowId,
      g.aspect_ratio AS aspectRatio, g.status, g.output_content_type AS contentType,
      g.output_key AS outputKey, g.approved_revision AS approvedRevision,
      g.error_message AS errorMessage, g.created_at AS createdAt,
      g.review_status AS reviewStatus, g.reviewed_at AS reviewedAt,
      g.composition_version AS compositionVersion, g.generation_mode AS generationMode,
      g.output_sha256 AS outputSha256
    FROM generations g
    WHERE g.id = ? AND g.workspace_id = ?
  `).bind(generationId, workspaceId).first<StoredGenerationRow>()
  if (!row || row.status !== 'completed') return 'not-committed'
  if (row.outputKey !== outputKey
    || row.contentType !== CAMPAIGN_OUTPUT_CONTENT_TYPE
    || row.outputSha256 !== outputSha256
    || row.compositionVersion !== CAMPAIGN_COMPOSITION_VERSION
    || row.generationMode !== completedMode
    || row.workflowId !== input.workflowId
    || row.aspectRatio !== input.aspectRatio
    || row.approvedRevision !== input.approvedRevision
    || row.reviewStatus !== 'draft'
    || row.reviewedAt !== null
    || row.errorMessage !== null) return 'conflict'

  const [object, ledger] = await Promise.all([
    env.MEDIA_BUCKET.head(outputKey),
    env.DB.prepare(`
      SELECT
        SUM(CASE WHEN event_type = 'settlement' THEN 1 ELSE 0 END) AS settlements,
        SUM(CASE WHEN event_type = 'release' THEN 1 ELSE 0 END) AS releases
      FROM output_ledger
      WHERE generation_id = ?
    `).bind(generationId).first<{ settlements: number; releases: number }>()
  ])
  return object && hasCanonicalOutputMetadata(row, object)
    && ledger?.settlements === 1 && ledger.releases === 0
    ? 'committed'
    : 'conflict'
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

const campaignPackRequestKeys = [
  'idempotencyKey',
  'workspaceId',
  'approvedRevision',
  'intent',
  'brand',
  'product',
  'referenceAssetIds',
  'outputs'
] as const
const campaignPackOutputKeys = ['workflowId', 'aspectRatio'] as const
const generationInputRequestKeys = [
  'workspaceId',
  'workflowId',
  'aspectRatio',
  'approvedRevision',
  'intent',
  'brand',
  'product',
  'referenceImageUrls',
  'referenceAssetIds'
] as const

function hasExactKeys(value: unknown, expectedKeys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length === expectedKeys.length && keys.every((key) => expectedKeys.includes(key))
}

function hasKnownCampaignBriefFields(input: GenerationInput) {
  return validateCampaignBrief({
    assetId: input.referenceAssetIds[0],
    intent: input.intent,
    brand: input.brand,
    product: input.product
  }).length === 0
}

function strictGenerationInput(value: unknown): value is GenerationInput {
  return hasExactKeys(value, generationInputRequestKeys) && validInput(value) && hasKnownCampaignBriefFields(value)
}

function campaignPackInputs(value: unknown): { request: CampaignPackRequest; inputs: GenerationInput[] } | null {
  if (!hasExactKeys(value, campaignPackRequestKeys)) return null
  const request = value as Partial<CampaignPackRequest>
  if (!boundedString(request.idempotencyKey, 100) || !/^[a-z0-9_-]{16,100}$/i.test(request.idempotencyKey!)) return null
  if (!boundedString(request.workspaceId, 64) || !Number.isSafeInteger(request.approvedRevision) || Number(request.approvedRevision) <= 0) return null
  if (!Array.isArray(request.outputs) || request.outputs.length < 1 || request.outputs.length > 3) return null
  if (!request.outputs.every((output) => hasExactKeys(output, campaignPackOutputKeys))) return null
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
  if (!inputs.every((input) => validInput(input) && hasKnownCampaignBriefFields(input))) return null
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

function generationPayload(item: GenerationRow) {
  const completed = item.status === 'completed'
  return {
    id: item.id,
    campaignPackId: item.campaignPackId,
    workflowId: item.workflowId,
    aspectRatio: item.aspectRatio,
    status: item.status,
    contentType: item.contentType,
    approvedRevision: item.approvedRevision,
    errorMessage: item.errorMessage,
    createdAt: item.createdAt,
    reviewStatus: item.reviewStatus,
    reviewedAt: item.reviewedAt,
    imageUrl: completed ? `/api/generations/${item.id}/image` : null,
    downloadUrl: completed && item.reviewStatus === 'approved' ? `/api/generations/${item.id}/download` : null,
    provenance: {
      approvedRevision: item.approvedRevision,
      compositionVersion: item.compositionVersion,
      generationMode: item.generationMode
    }
  }
}

async function generationForWorkspace(env: Env, workspaceId: string, generationId: string) {
  return env.DB.prepare(`
    SELECT g.id, g.campaign_pack_id AS campaignPackId, g.workflow_id AS workflowId,
      g.aspect_ratio AS aspectRatio, g.status, g.output_content_type AS contentType,
      g.output_key AS outputKey,
      g.approved_revision AS approvedRevision, g.error_message AS errorMessage,
      g.created_at AS createdAt, g.review_status AS reviewStatus,
      g.reviewed_at AS reviewedAt, g.composition_version AS compositionVersion,
      g.generation_mode AS generationMode, g.output_sha256 AS outputSha256
    FROM generations g
    JOIN workspaces w ON w.id = g.workspace_id
    WHERE g.id = ? AND g.workspace_id = ? AND w.access_status = 'active'
  `).bind(generationId, workspaceId).first<StoredGenerationRow>()
}

async function packGenerations(env: Env, workspaceId: string, campaignPackId: string) {
  const result = await env.DB.prepare(`
    SELECT id, campaign_pack_id AS campaignPackId, workflow_id AS workflowId, aspect_ratio AS aspectRatio,
      status, output_content_type AS contentType, approved_revision AS approvedRevision,
      error_message AS errorMessage, created_at AS createdAt, review_status AS reviewStatus,
      reviewed_at AS reviewedAt, composition_version AS compositionVersion,
      generation_mode AS generationMode, output_sha256 AS outputSha256
    FROM generations
    WHERE workspace_id = ? AND campaign_pack_id = ?
    ORDER BY created_at ASC
  `).bind(workspaceId, campaignPackId).all<GenerationRow>()
  return result.results.map(generationPayload)
}

async function campaignPackReplayResponse(env: Env, workspaceId: string, idempotencyKey: string, inputs: GenerationInput[]) {
  const existing = await env.DB.prepare('SELECT id FROM campaign_packs WHERE workspace_id = ? AND idempotency_key = ?')
    .bind(workspaceId, idempotencyKey)
    .first<{ id: string }>()
  if (!existing) return null

  const stored = await env.DB.prepare(`
    SELECT input_json AS inputJson
    FROM generations
    WHERE workspace_id = ? AND campaign_pack_id = ?
  `).bind(workspaceId, existing.id).all<{ inputJson: string }>()
  const requestedIdentities = inputs.map(generationInputIdentity).sort()
  const storedIdentities: string[] = []
  for (const row of stored.results) {
    if (typeof row.inputJson !== 'string' || row.inputJson.length > MAX_GENERATION_BODY_BYTES) break
    try {
      const input = JSON.parse(row.inputJson) as unknown
      if (!validInput(input)) break
      storedIdentities.push(generationInputIdentity(input))
    } catch {
      break
    }
  }
  storedIdentities.sort()
  if (storedIdentities.length !== requestedIdentities.length
    || storedIdentities.some((identity, index) => identity !== requestedIdentities[index])) {
    return json({ error: '此 idempotency key 已用於不同的 Campaign Pack 請求。 This idempotency key is already bound to a different Campaign Pack request.' }, { status: 409 })
  }
  return json({ campaignPackId: existing.id, generations: await packGenerations(env, workspaceId, existing.id), replayed: true })
}

async function reconcileCampaignPackCreation(
  env: Env,
  workspaceId: string,
  campaignPackId: string,
  idempotencyKey: string,
  approvedRevision: number,
  queued: ReadonlyArray<{ generationId: string; input: GenerationInput }>
): Promise<'committed' | 'not-committed' | 'conflict'> {
  const pack = await env.DB.prepare(`
    SELECT workspace_id AS workspaceId, idempotency_key AS idempotencyKey,
      approved_revision AS approvedRevision
    FROM campaign_packs
    WHERE id = ? AND workspace_id = ?
  `).bind(campaignPackId, workspaceId).first<{
    workspaceId: string
    idempotencyKey: string
    approvedRevision: number
  }>()
  if (!pack) return 'not-committed'
  if (pack.workspaceId !== workspaceId
    || pack.idempotencyKey !== idempotencyKey
    || pack.approvedRevision !== approvedRevision) return 'conflict'

  const generations = await env.DB.prepare(`
    SELECT id, workspace_id AS workspaceId, campaign_pack_id AS campaignPackId,
      workflow_id AS workflowId, aspect_ratio AS aspectRatio, status,
      output_cost AS outputCost, credit_cost AS creditCost, input_json AS inputJson,
      approved_revision AS approvedRevision, output_key AS outputKey,
      output_content_type AS outputContentType, processing_attempt AS processingAttempt,
      error_message AS errorMessage, review_status AS reviewStatus,
      reviewed_at AS reviewedAt, reviewed_by_user_id AS reviewedByUserId,
      composition_version AS compositionVersion, generation_mode AS generationMode,
      output_sha256 AS outputSha256, completed_at AS completedAt
    FROM generations
    WHERE workspace_id = ? AND campaign_pack_id = ?
  `).bind(workspaceId, campaignPackId).all<{
    id: string
    workspaceId: string
    campaignPackId: string
    workflowId: string
    aspectRatio: string
    status: string
    outputCost: number
    creditCost: number
    inputJson: string
    approvedRevision: number
    outputKey: string | null
    outputContentType: string | null
    processingAttempt: number
    errorMessage: string | null
    reviewStatus: string
    reviewedAt: string | null
    reviewedByUserId: string | null
    compositionVersion: string | null
    generationMode: string | null
    outputSha256: string | null
    completedAt: string | null
  }>()
  if (generations.results.length !== queued.length) return 'conflict'
  const rowsById = new Map(generations.results.map((row) => [row.id, row]))

  for (const item of queued) {
    const row = rowsById.get(item.generationId)
    if (!row
      || row.workspaceId !== workspaceId
      || row.campaignPackId !== campaignPackId
      || row.workflowId !== item.input.workflowId
      || row.aspectRatio !== item.input.aspectRatio
      || row.status !== 'queued'
      || row.outputCost !== OUTPUT_COST
      || row.creditCost !== OUTPUT_COST
      || row.inputJson !== JSON.stringify(item.input)
      || row.approvedRevision !== item.input.approvedRevision
      || row.outputKey !== null
      || row.outputContentType !== null
      || row.processingAttempt !== 0
      || row.errorMessage !== null
      || row.reviewStatus !== 'draft'
      || row.reviewedAt !== null
      || row.reviewedByUserId !== null
      || row.compositionVersion !== null
      || row.generationMode !== null
      || row.outputSha256 !== null
      || row.completedAt !== null) return 'conflict'

    const ledger = await env.DB.prepare(`
      SELECT event_type AS eventType, amount, provider_event_id AS providerEventId, note
      FROM output_ledger
      WHERE workspace_id = ? AND generation_id = ?
    `).bind(workspaceId, item.generationId).all<{
      eventType: string
      amount: number
      providerEventId: string | null
      note: string
    }>()
    if (ledger.results.length !== 1
      || ledger.results[0].eventType !== 'reservation'
      || ledger.results[0].amount !== -OUTPUT_COST
      || ledger.results[0].providerEventId !== null
      || ledger.results[0].note !== 'Campaign Pack output reservation') return 'conflict'
  }

  return 'committed'
}

async function createCampaignPack(request: Request, env: Env, session: SessionContext) {
  if (generationMode(env) === 'disabled') return json({ error: '素材生成服務目前未開放。' }, { status: 503 })
  if (!hasJsonContent(request)) return unsupportedMediaType(request, 'application/json')
  const parsed = await readBody(request, MAX_GENERATION_BODY_BYTES)
  if (parsed.tooLarge) return json({ error: 'Campaign Pack payload is too large.' }, { status: 413 })
  const parsedPack = campaignPackInputs(parsed.body)
  if (!parsedPack) return json({ error: 'Invalid Campaign Pack payload.' }, { status: 400 })
  if (parsedPack.request.workspaceId !== session.currentWorkspace.id) return json({ error: 'Workspace not found.' }, { status: 404 })
  const workspace = await getWorkspace(env, session.user.id, parsedPack.request.workspaceId)
  if (!workspace) return json({ error: 'Workspace not found.' }, { status: 404 })

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
  try {
    const replay = await campaignPackReplayResponse(env, workspace.id, parsedPack.request.idempotencyKey, inputs)
    if (replay) return replay
  } catch {
    return json({ error: 'Campaign Pack replay state is temporarily unavailable.' }, { status: 503 })
  }
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
  const activeLimit = maxActiveGenerations(env)
  let creationReconciliationUnavailable = false
  try {
    const statements = [
      env.DB.prepare(`
        UPDATE output_allowances
        SET available = available - ?, reserved = reserved + ?, updated_at = CURRENT_TIMESTAMP
        WHERE workspace_id = ? AND available >= ? AND reserved + ? <= ?
      `).bind(outputCount, outputCount, workspace.id, outputCount, outputCount, activeLimit),
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
      const replay = await campaignPackReplayResponse(env, workspace.id, parsedPack.request.idempotencyKey, inputs)
      if (replay) return replay
      const current = await env.DB.prepare('SELECT available, reserved FROM output_allowances WHERE workspace_id = ?')
        .bind(workspace.id)
        .first<{ available: number; reserved: number }>()
      if (current && current.reserved + outputCount > activeLimit) {
        return json({ error: `同一工作區最多可同時處理 ${activeLimit} 個輸出。` }, { status: 429 })
      }
      return json({ error: `至少需要 ${outputCount} 個可用輸出。` }, { status: 409 })
    }
  } catch {
    try {
      const reconciliation = await reconcileCampaignPackCreation(
        env,
        workspace.id,
        campaignPackId,
        parsedPack.request.idempotencyKey,
        parsedPack.request.approvedRevision,
        queued
      )
      if (reconciliation === 'not-committed') {
        const replay = await campaignPackReplayResponse(env, workspace.id, parsedPack.request.idempotencyKey, inputs)
        if (replay) return replay
        return json({ error: 'Unable to create Campaign Pack.' }, { status: 503 })
      }
      if (reconciliation === 'conflict') {
        console.error('campaign-pack-create-reconciliation-conflict')
        return json({ error: 'Unable to create Campaign Pack.' }, { status: 503 })
      }
    } catch {
      console.error('campaign-pack-create-reconciliation-failed')
      creationReconciliationUnavailable = true
    }
  }

  try {
    await env.GENERATION_QUEUE.sendBatch(queued.map((item) => ({ body: { generationId: item.generationId, input: item.input } })))
  } catch {
    for (const item of queued) await failGenerationAndRelease(env, workspace.id, item.generationId, 'Unable to enqueue Campaign Pack output.').catch(() => null)
    return json({ error: 'Unable to queue Campaign Pack.' }, { status: 503 })
  }

  if (creationReconciliationUnavailable) return json({ error: 'Unable to create Campaign Pack.' }, { status: 503 })

  return json({ campaignPackId, generations: await packGenerations(env, workspace.id, campaignPackId), reservedOutputs: outputCount }, { status: 202 })
}

async function reconcileQueuedGeneration(env: Env, workspaceId: string, generationId: string, input: GenerationInput): Promise<'committed' | 'not-committed' | 'conflict'> {
  const row = await env.DB.prepare(`
    SELECT workspace_id AS workspaceId, campaign_pack_id AS campaignPackId,
      workflow_id AS workflowId, aspect_ratio AS aspectRatio, status,
      output_cost AS outputCost, credit_cost AS creditCost, input_json AS inputJson,
      approved_revision AS approvedRevision, output_key AS outputKey,
      output_content_type AS outputContentType, processing_attempt AS processingAttempt,
      error_message AS errorMessage, review_status AS reviewStatus
    FROM generations
    WHERE id = ? AND workspace_id = ?
  `).bind(generationId, workspaceId).first<{
    workspaceId: string
    campaignPackId: string | null
    workflowId: string
    aspectRatio: string
    status: string
    outputCost: number
    creditCost: number
    inputJson: string
    approvedRevision: number
    outputKey: string | null
    outputContentType: string | null
    processingAttempt: number
    errorMessage: string | null
    reviewStatus: string
  }>()
  if (!row) return 'not-committed'
  return row.workspaceId === workspaceId
    && row.campaignPackId === null
    && row.workflowId === input.workflowId
    && row.aspectRatio === input.aspectRatio
    && row.status === 'queued'
    && row.outputCost === OUTPUT_COST
    && row.creditCost === OUTPUT_COST
    && row.inputJson === JSON.stringify(input)
    && row.approvedRevision === input.approvedRevision
    && row.outputKey === null
    && row.outputContentType === null
    && row.processingAttempt === 0
    && row.errorMessage === null
    && row.reviewStatus === 'draft'
    ? 'committed'
    : 'conflict'
}

async function createGeneration(request: Request, env: Env, session: SessionContext) {
  if (generationMode(env) === 'disabled') return json({ error: '素材生成服務目前未開放。' }, { status: 503 })
  if (!hasJsonContent(request)) return unsupportedMediaType(request, 'application/json')
  const parsed = await readBody(request, MAX_GENERATION_BODY_BYTES)
  if (parsed.tooLarge) return json({ error: 'Generation payload is too large.' }, { status: 413 })
  const input = parsed.body
  if (!strictGenerationInput(input)) return json({ error: 'Invalid generation payload.' }, { status: 400 })
  if (input.workspaceId !== session.currentWorkspace.id) return json({ error: 'Workspace not found.' }, { status: 404 })
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
  try {
    await reserveOutput(env, workspace.id, id)
  } catch (error) {
    if (error instanceof Error && error.message === 'ACTIVE_GENERATION_LIMIT') {
      return json({ error: `同一工作區最多可同時處理 ${maxActiveGenerations(env)} 個輸出。` }, { status: 429 })
    }
    if (error instanceof Error && error.message === 'INSUFFICIENT_OUTPUT_ALLOWANCE') return json({ error: '可用輸出數不足。' }, { status: 409 })
    try {
      const reconciliation = await reconcileGenerationReservation(env, workspace.id, id)
      if (reconciliation !== 'committed') {
        if (reconciliation === 'conflict') console.error('generation-reservation-reconciliation-conflict')
        return json({ error: 'Unable to queue generation.' }, { status: 503 })
      }
    } catch {
      console.error('generation-reservation-reconciliation-failed')
      return json({ error: 'Unable to queue generation.' }, { status: 503 })
    }
  }

  try {
    await env.DB.prepare('INSERT INTO generations (id, workspace_id, workflow_id, aspect_ratio, status, output_cost, credit_cost, input_json, approved_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, workspace.id, safeInput.workflowId, safeInput.aspectRatio, 'queued', OUTPUT_COST, OUTPUT_COST, JSON.stringify(safeInput), safeInput.approvedRevision).run()
  } catch {
    try {
      const reconciliation = await reconcileQueuedGeneration(env, workspace.id, id, safeInput)
      if (reconciliation !== 'committed') {
        if (reconciliation === 'not-committed') {
          await releaseOrphanReservation(env, workspace.id, id, 'Unable to create generation record.').catch(() => null)
        } else {
          console.error('generation-create-reconciliation-conflict')
        }
        return json({ error: 'Unable to queue generation.' }, { status: 503 })
      }
    } catch {
      console.error('generation-create-reconciliation-failed')
      return json({ error: 'Unable to queue generation.' }, { status: 503 })
    }
  }

  try {
    await env.GENERATION_QUEUE.send({ generationId: id, input: safeInput })
    return json({ id, status: 'queued', reservedOutputs: OUTPUT_COST }, { status: 202 })
  } catch {
    await failGenerationAndRelease(env, workspace.id, id, 'Unable to enqueue generation.').catch(() => null)
    return json({ error: 'Unable to queue generation.' }, { status: 503 })
  }
}

async function listGenerations(request: Request, env: Env, session: SessionContext) {
  const url = new URL(request.url)
  const workspaceId = url.searchParams.get('workspaceId') || session.currentWorkspace.id
  if (workspaceId !== session.currentWorkspace.id) return json({ error: 'Workspace not found.' }, { status: 404 })
  const workspace = await getWorkspace(env, session.user.id, workspaceId)
  if (!workspace) return json({ error: 'Workspace not found.' }, { status: 404 })
  const result = await env.DB.prepare(`
    SELECT id, campaign_pack_id AS campaignPackId, workflow_id AS workflowId, aspect_ratio AS aspectRatio, status,
      output_content_type AS contentType, approved_revision AS approvedRevision,
      error_message AS errorMessage, created_at AS createdAt, review_status AS reviewStatus,
      reviewed_at AS reviewedAt, composition_version AS compositionVersion,
      generation_mode AS generationMode, output_sha256 AS outputSha256
    FROM generations
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(workspace.id).all<GenerationRow>()
  return json({ generations: result.results.map(generationPayload) })
}

type CanonicalOutputResult =
  | { state: 'ready'; object: R2ObjectBody }
  | { state: 'missing' }
  | { state: 'invalid' }

function hasCanonicalOutputMetadata(row: StoredGenerationRow, object: R2Object) {
  const metadata = object.customMetadata
  return row.contentType === CAMPAIGN_OUTPUT_CONTENT_TYPE
    && Boolean(row.compositionVersion && row.generationMode)
    && typeof row.outputSha256 === 'string' && /^[A-Za-z0-9_-]{43}$/.test(row.outputSha256)
    && r2Sha256(object) === row.outputSha256
    && object.httpMetadata?.contentType === row.contentType
    && metadata?.workflow === row.workflowId
    && metadata?.approvedRevision === String(row.approvedRevision)
    && metadata?.compositionVersion === row.compositionVersion
    && metadata?.generationMode === row.generationMode
}

function r2Sha256(object: R2Object) {
  const checksum = object.checksums.sha256
  return checksum?.byteLength === 32 ? base64Url(new Uint8Array(checksum)) : null
}

async function canonicalGenerationOutput(env: Env, row: StoredGenerationRow): Promise<CanonicalOutputResult> {
  if (!row.outputKey) return { state: 'missing' }
  const object = await env.MEDIA_BUCKET.get(row.outputKey)
  if (!object) return { state: 'missing' }
  if (!hasCanonicalOutputMetadata(row, object)) {
    await object.body.cancel().catch(() => undefined)
    return { state: 'invalid' }
  }
  return { state: 'ready', object }
}

function invalidOutputFormat() {
  return json({ error: '輸出格式驗證失敗，請重新建立。 Output format validation failed; recreate this output.' }, { status: 409 })
}

async function generationImage(request: Request, env: Env, session: SessionContext, generationId: string) {
  const row = await generationForWorkspace(env, session.currentWorkspace.id, generationId)
  if (!row || row.status !== 'completed' || !row.outputKey) return json({ error: 'Image not found.' }, { status: 404 })
  const output = await canonicalGenerationOutput(env, row)
  if (output.state === 'missing') return json({ error: 'Image not found.' }, { status: 404 })
  if (output.state === 'invalid') return invalidOutputFormat()
  const headers = new Headers({
    'content-type': CAMPAIGN_OUTPUT_CONTENT_TYPE,
    'cache-control': 'private, max-age=300',
    'content-disposition': 'inline',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  })
  headers.set('content-security-policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
  return new Response(output.object.body, { headers })
}

async function generationDownload(env: Env, session: SessionContext, generationId: string) {
  const row = await generationForWorkspace(env, session.currentWorkspace.id, generationId)
  if (!row || row.status !== 'completed' || !row.outputKey) return json({ error: 'Output not found.' }, { status: 404 })
  if (row.reviewStatus !== 'approved') return json({ error: '輸出需經人工核准後才可下載。' }, { status: 409 })
  const output = await canonicalGenerationOutput(env, row)
  if (output.state === 'missing') return json({ error: 'Output not found.' }, { status: 404 })
  if (output.state === 'invalid') return invalidOutputFormat()
  const ratio = row.aspectRatio.replace(':', 'x')
  const headers = new Headers({
    'content-type': CAMPAIGN_OUTPUT_CONTENT_TYPE,
    'cache-control': 'private, no-store',
    'content-disposition': `attachment; filename="aislestage-${ratio}.svg"`,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  })
  headers.set('content-security-policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
  return new Response(output.object.body, { headers })
}

async function reviewGeneration(request: Request, env: Env, session: SessionContext, generationId: string) {
  if (session.currentWorkspace.role !== 'owner' && session.currentWorkspace.role !== 'admin') {
    return json({ error: '只有 owner 或 admin 可以核准正式下載。' }, { status: 403 })
  }
  if (!hasJsonContent(request)) return unsupportedMediaType(request, 'application/json')
  const parsed = await readBody(request, MAX_REVIEW_BODY_BYTES)
  if (parsed.tooLarge) return json({ error: 'Review payload is too large.' }, { status: 413 })
  if (!parsed.body || typeof parsed.body !== 'object' || Array.isArray(parsed.body)) {
    return json({ error: 'Invalid review decision.' }, { status: 400 })
  }
  const body = parsed.body as Record<string, unknown>
  const keys = Object.keys(body)
  const decision = body.decision
  const expectedApprovedRevision = body.expectedApprovedRevision
  if (keys.length !== 2 || !keys.every((key) => key === 'decision' || key === 'expectedApprovedRevision')
    || (decision !== 'approve' && decision !== 'reject')
    || !Number.isSafeInteger(expectedApprovedRevision) || Number(expectedApprovedRevision) <= 0) {
    return json({ error: 'Invalid review decision.' }, { status: 400 })
  }

  const current = await generationForWorkspace(env, session.currentWorkspace.id, generationId)
  if (!current) return json({ error: 'Output not found.' }, { status: 404 })
  if (current.status !== 'completed') return json({ error: '只有已完成的輸出可以審核。' }, { status: 409 })
  if (current.approvedRevision !== expectedApprovedRevision) {
    return json({ error: '輸出版本已改變，請重新載入後再審核。' }, { status: 409 })
  }

  const targetStatus: ReviewStatus = decision === 'approve' ? 'approved' : 'rejected'
  if (targetStatus === 'approved') {
    if (!current.outputKey) return json({ error: '輸出檔案不存在，請重新建立。 Output file is missing; recreate this output.' }, { status: 409 })
    const object = await env.MEDIA_BUCKET.head(current.outputKey)
    if (!object) return json({ error: '輸出檔案不存在，請重新建立。 Output file is missing; recreate this output.' }, { status: 409 })
    if (!hasCanonicalOutputMetadata(current, object)) return invalidOutputFormat()
  }
  if (current.reviewStatus === targetStatus) {
    return json({ generation: generationPayload(current), replayed: true })
  }
  if (current.reviewStatus !== 'draft') {
    return json({ error: '這個輸出已有不可變更的審核決定。' }, { status: 409 })
  }

  let updateChanges: number
  try {
    const updated = await env.DB.prepare(`
      UPDATE generations
      SET review_status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by_user_id = ?
      WHERE id = ? AND workspace_id = ? AND status = 'completed'
        AND review_status = 'draft' AND approved_revision = ?
    `).bind(targetStatus, session.user.id, generationId, session.currentWorkspace.id, expectedApprovedRevision).run()
    updateChanges = updated.meta.changes
  } catch {
    try {
      const reconciliation = await env.DB.prepare(`
        SELECT status, review_status AS reviewStatus, reviewed_at AS reviewedAt,
          approved_revision AS approvedRevision
        FROM generations
        WHERE id = ? AND workspace_id = ?
      `).bind(generationId, session.currentWorkspace.id).first<{
        status: string
        reviewStatus: string
        reviewedAt: string | null
        approvedRevision: number
      }>()
      if (reconciliation?.status === 'completed'
        && reconciliation.reviewStatus === targetStatus
        && reconciliation.reviewedAt
        && reconciliation.approvedRevision === expectedApprovedRevision) {
        const latest = await generationForWorkspace(env, session.currentWorkspace.id, generationId)
        if (!latest) return json({ error: 'Output not found.' }, { status: 404 })
        return json({ generation: generationPayload(latest), replayed: true })
      }
      if (reconciliation?.reviewStatus && reconciliation.reviewStatus !== 'draft') {
        return json({ error: '這個輸出已有不可變更的審核決定。' }, { status: 409 })
      }
      console.error('generation-review-reconciliation-conflict')
      return json({ error: '未能確認輸出審核狀態。 Unable to confirm output review.' }, { status: 503 })
    } catch {
      console.error('generation-review-reconciliation-failed')
      return json({ error: '未能確認輸出審核狀態。 Unable to confirm output review.' }, { status: 503 })
    }
  }
  const latest = await generationForWorkspace(env, session.currentWorkspace.id, generationId)
  if (!latest) return json({ error: 'Output not found.' }, { status: 404 })
  if (!updateChanges) {
    if (latest.reviewStatus === targetStatus) return json({ generation: generationPayload(latest), replayed: true })
    return json({ error: '這個輸出已有不可變更的審核決定。' }, { status: 409 })
  }
  return json({ generation: generationPayload(latest), replayed: false })
}

async function deleteGeneration(env: Env, session: SessionContext, generationId: string) {
  const row = await env.DB.prepare(`
    SELECT g.output_key AS outputKey, g.status
    FROM generations g
    JOIN workspaces w ON w.id = g.workspace_id
    WHERE g.id = ? AND g.workspace_id = ? AND w.access_status = 'active'
  `).bind(generationId, session.currentWorkspace.id).first<{ outputKey: string | null; status: string }>()
  if (!row) return json({ error: 'Output not found.' }, { status: 404 })
  if (row.status === 'queued' || row.status === 'processing') return json({ error: '仍在處理的輸出不可刪除。' }, { status: 409 })
  const deletedResponse = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  try {
    if (row.outputKey) await env.MEDIA_BUCKET.delete(row.outputKey)
    await env.DB.prepare('DELETE FROM generations WHERE id = ? AND workspace_id = ?')
      .bind(generationId, session.currentWorkspace.id)
      .run()
    return deletedResponse()
  } catch {
    try {
      const remaining = await env.DB.prepare(`
        SELECT 1 AS present
        FROM generations
        WHERE id = ? AND workspace_id = ?
      `).bind(generationId, session.currentWorkspace.id).first<{ present: number }>()
      if (!remaining) return deletedResponse()
      console.error('generation-delete-reconciliation-pending')
    } catch {
      console.error('generation-delete-reconciliation-failed')
    }
    return json({ error: '未能刪除輸出。 Unable to delete output.' }, { status: 503 })
  }
}

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url)
    const activeAuthMode = authMode(env)
    if (isWorkspaceAppPath(url.pathname)) return workspaceApp(request, env, activeAuthMode)

    if (url.pathname === '/api/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'Method not allowed.' }, { status: 405, headers: { allow: 'GET, HEAD' } })
      }
      return json({
        status: 'ok',
        service: 'campaign-asset-worker',
        releaseMode: 'restricted',
        authMode: activeAuthMode,
        registrationMode: activeAuthMode === 'access' ? 'closed' : registrationMode(env),
        registrationOpen: activeAuthMode === 'password' && registrationMode(env) !== 'closed',
        generationEnabled: generationMode(env) !== 'disabled',
        generationMode: generationMode(env),
        agentMode: agentMode(env)
      })
    }
    if (url.pathname === '/api/workflows') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'Method not allowed.' }, { status: 405, headers: { allow: 'GET, HEAD' } })
      }
      return json({ workflows: ['store-main', 'detail-banner', 'promo-poster', 'meta-ad', 'package-showcase'] })
    }

    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !isAllowedOrigin(request, env)) {
      return json({ error: 'Request origin is not allowed.' }, { status: 403 })
    }
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      if (!isAllowedOrigin(request, env)) return json({ error: 'Request origin is not allowed.' }, { status: 403 })
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
    }
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      return activeAuthMode === 'access'
        ? json({ error: 'Password registration is disabled.' }, { status: 404 })
        : guardedPasswordAuth('register', () => register(request, env))
    }
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      return activeAuthMode === 'access'
        ? json({ error: 'Password login is disabled.' }, { status: 404 })
        : guardedPasswordAuth('login', () => login(request, env))
    }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      if (activeAuthMode === 'access') {
        const session = await requireSession(request, env)
        if (session instanceof Response) return session
        return json({ ok: true, logoutUrl: '/cdn-cgi/access/logout' })
      }
      return logout(request, env)
    }
    if (url.pathname === '/api/session' && request.method === 'GET') {
      const session = await requireSession(request, env)
      if (session instanceof Response) {
        if (activeAuthMode === 'access') return session
        return session.status === 503
          ? sessionAuthorizationUnavailable(true)
          : json({ authenticated: false }, { headers: session.headers })
      }
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
    const downloadMatch = url.pathname.match(/^\/api\/generations\/([^/]+)\/download$/)
    if (downloadMatch && request.method === 'GET') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return generationDownload(env, session, downloadMatch[1])
    }
    const reviewMatch = url.pathname.match(/^\/api\/generations\/([^/]+)\/review$/)
    if (reviewMatch && request.method === 'POST') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return reviewGeneration(request, env, session, reviewMatch[1])
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
    if (url.pathname.startsWith('/api/')) {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
    }
    return json({ error: 'Not found.' }, { status: 404 })
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(cleanExpiredAuthState(env))
  },

  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      const queuedMessage = message.body && typeof message.body === 'object'
        ? message.body as Partial<GenerationMessage>
        : null
      const generationId = typeof queuedMessage?.generationId === 'string' ? queuedMessage.generationId : ''
      if (!boundedString(generationId, 64)) {
        message.ack()
        continue
      }

      let workspaceId: string | null = null
      let storedOutputKey: string | null = null
      let claimEstablished = false
      try {
        let claimChanges: number
        try {
          const claim = await env.DB.prepare(`
            UPDATE generations
            SET status = 'processing', processing_attempt = ?, error_message = NULL
            WHERE id = ?
              AND (status = 'queued' OR (status = 'processing' AND processing_attempt < ?))
          `).bind(message.attempts, generationId, message.attempts).run()
          claimChanges = claim.meta.changes
        } catch (error) {
          if (message.attempts <= 3) {
            try {
              const state = await env.DB.prepare(`
                SELECT status, processing_attempt AS processingAttempt
                FROM generations
                WHERE id = ?
              `).bind(generationId).first<{ status: string; processingAttempt: number }>()
              if (!state || state.status === 'completed' || state.status === 'failed' || state.status === 'rejected') {
                message.ack()
                continue
              }
              if (state.status === 'processing' && state.processingAttempt > message.attempts) {
                message.ack()
                continue
              }
            } catch {
              console.error('generation-claim-reconciliation-failed')
            }
            message.retry({ delaySeconds: 60 })
            continue
          }
          throw error
        }
        if (!claimChanges) {
          message.ack()
          continue
        }
        claimEstablished = true

        const canonical = await env.DB.prepare(`
          SELECT g.workspace_id AS workspaceId, g.input_json AS inputJson, w.access_status AS accessStatus
          FROM generations g
          LEFT JOIN workspaces w ON w.id = g.workspace_id
          WHERE g.id = ? AND g.status = 'processing' AND g.processing_attempt = ?
        `).bind(generationId, message.attempts).first<{ workspaceId: string; inputJson: string; accessStatus: string | null }>()
        if (!canonical) throw new TerminalGenerationError('Canonical generation record is unavailable.')
        workspaceId = canonical.workspaceId
        if (canonical.accessStatus !== 'active') throw new TerminalGenerationError('Canonical workspace is inactive.')
        if (typeof canonical.inputJson !== 'string' || canonical.inputJson.length > MAX_GENERATION_BODY_BYTES) {
          throw new TerminalGenerationError('Canonical generation input is invalid.')
        }

        let input: unknown
        try {
          input = JSON.parse(canonical.inputJson)
        } catch {
          throw new TerminalGenerationError('Canonical generation input is invalid.')
        }
        if (!validInput(input) || input.workspaceId !== workspaceId) {
          throw new TerminalGenerationError('Canonical generation input is invalid.')
        }
        if (!validInput(queuedMessage?.input) || generationInputIdentity(queuedMessage.input) !== generationInputIdentity(input)) {
          throw new TerminalGenerationError('Queue message identity does not match canonical input.')
        }

        const workflow = workflowById(input.workflowId)
        if (!workflow.ratios.includes(input.aspectRatio) || validateCompositionInput(input).length) {
          throw new TerminalGenerationError('Canonical generation input is invalid.')
        }
        await requireCurrentGenerationExecution(env, generationId, message.attempts, input)

        const mode = generationMode(env)
        if (mode === 'disabled') throw new TerminalGenerationError('Campaign generation is disabled for this deployment.')
        const source = await generationSourceAsset(env, input)
        let background: { base64: string; contentType: 'image/png' } | undefined
        if (mode === 'assisted' && env.OPENAI_API_KEY) {
          await requireCurrentGenerationExecution(env, generationId, message.attempts, input)
          const copy = await new OpenAICopyProvider(env.OPENAI_API_KEY).createCopy({ brand: input.brand, product: input.product, workflowTitle: workflow.title, aspectRatio: input.aspectRatio })
          await requireCurrentGenerationExecution(env, generationId, message.attempts, input)
          const generated = await new OpenAIImageProvider(env.OPENAI_API_KEY).generate({ prompt: `${copy.imagePrompt}\nBackground scene only. Do not render text, logos, prices, claims, or a replacement product.`, aspectRatio: input.aspectRatio, referenceImageUrls: [] })
          background = { base64: generated.imageBase64, contentType: 'image/png' }
        }
        const output = composeCampaignSvg({ input, source, background })
        const outputBytes = textEncoder.encode(output)
        const outputDigest = await sha256Bytes(outputBytes)
        const outputSha256 = base64Url(new Uint8Array(outputDigest))
        const key = `workspaces/${input.workspaceId}/generations/${generationId}.svg`
        await requireCurrentGenerationExecution(env, generationId, message.attempts, input)
        storedOutputKey = key
        const stored = await env.MEDIA_BUCKET.put(key, outputBytes, {
          httpMetadata: { contentType: CAMPAIGN_OUTPUT_CONTENT_TYPE },
          customMetadata: {
            workflow: input.workflowId,
            sourceAssetId: input.referenceAssetIds[0],
            approvedRevision: String(input.approvedRevision),
            compositionVersion: CAMPAIGN_COMPOSITION_VERSION,
            generationMode: mode
          },
          sha256: outputDigest
        })
        if (!stored || r2Sha256(stored) !== outputSha256) throw new TypeError('Output storage integrity verification failed.')
        try {
          await completeGenerationAndSettle(env, workspaceId, generationId, message.attempts, key, CAMPAIGN_OUTPUT_CONTENT_TYPE, outputSha256, mode)
        } catch (error) {
          try {
            const reconciliation = await reconcileGenerationCompletion(env, workspaceId, generationId, input, key, outputSha256, mode)
            if (reconciliation === 'committed') {
              storedOutputKey = null
              message.ack()
              continue
            }
            if (reconciliation === 'conflict') {
              storedOutputKey = null
              console.error('generation-completion-reconciliation-conflict')
            }
          } catch {
            storedOutputKey = null
            console.error('generation-completion-reconciliation-failed')
          }
          throw error
        }
        storedOutputKey = null
        message.ack()
      } catch (error) {
        if (storedOutputKey) await env.MEDIA_BUCKET.delete(storedOutputKey).catch(() => null)
        if (!workspaceId) {
          workspaceId = await env.DB.prepare('SELECT workspace_id AS workspaceId FROM generations WHERE id = ?')
            .bind(generationId)
            .first<{ workspaceId: string }>()
            .then((row) => row?.workspaceId ?? null)
            .catch(() => null)
        }
        const internalReason = error instanceof Error ? error.message : ''
        const retryable = !(error instanceof TerminalGenerationError)
          && (error instanceof TypeError || /request failed: (408|409|429|5\d\d)/i.test(internalReason))
        if (retryable && message.attempts <= 3) {
          const reset = workspaceId
            ? await env.DB.prepare(`
              UPDATE generations SET status = 'queued', error_message = ?
              WHERE id = ? AND workspace_id = ? AND status = 'processing' AND processing_attempt = ?
            `).bind(RETRYING_GENERATION_MESSAGE, generationId, workspaceId, message.attempts).run()
            : await env.DB.prepare(`
              UPDATE generations SET status = 'queued', error_message = ?
              WHERE id = ? AND status = 'processing' AND processing_attempt = ?
            `).bind(RETRYING_GENERATION_MESSAGE, generationId, message.attempts).run()
          if (reset.meta.changes) {
            message.retry({ delaySeconds: 60 })
            continue
          }
        }
        try {
          if (!workspaceId) throw new Error('Generation workspace is unavailable.')
          await failGenerationAndRelease(
            env,
            workspaceId,
            generationId,
            FAILED_GENERATION_MESSAGE,
            claimEstablished ? message.attempts : null
          )
          message.ack()
        } catch {
          console.error('generation-settlement-failed')
          const reset = workspaceId
            ? await env.DB.prepare("UPDATE generations SET status = 'queued' WHERE id = ? AND workspace_id = ? AND status = 'processing' AND processing_attempt = ?").bind(generationId, workspaceId, message.attempts).run()
            : await env.DB.prepare("UPDATE generations SET status = 'queued' WHERE id = ? AND status = 'processing' AND processing_attempt = ?").bind(generationId, message.attempts).run()
          if (reset.meta.changes) message.retry({ delaySeconds: 60 })
          else message.ack()
        }
      }
    }
  }
} satisfies ExportedHandler<Env, GenerationMessage>
