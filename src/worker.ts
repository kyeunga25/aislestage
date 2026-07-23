import { OpenAICopyProvider, OpenAIImageProvider, WonderBillingProvider } from './lib/providers'
import { workflowById } from './lib/workflows'
import type { GenerationInput } from './lib/types'

type Env = {
  DB: D1Database
  MEDIA_BUCKET: R2Bucket
  GENERATION_QUEUE: Queue<GenerationMessage>
  OPENAI_API_KEY?: string
  WONDER_WEBHOOK_PUBLIC_KEY?: string
  APP_ORIGIN?: string
}

type GenerationMessage = { generationId: string; input: GenerationInput }
type AuthUser = { id: string; email: string; name: string }
type Workspace = { id: string; name: string; role: string; planStatus: string; availableCredits: number; reservedCredits: number }
type SessionContext = { user: AuthUser; currentWorkspace: Workspace }
const CREDIT_COST = 2
const STARTER_CREDITS = 20
const SESSION_COOKIE = 'motive_session'
const SESSION_DAYS = 60
const PASSWORD_ITERATIONS = 100_000
const LOGIN_WINDOW_MINUTES = 15
const LOGIN_EMAIL_IP_LIMIT = 8
const LOGIN_IP_LIMIT = 30
const REGISTER_WINDOW_MINUTES = 60
const REGISTER_IP_LIMIT = 12
const DUMMY_PASSWORD_SALT = 'bW90aXZlLWR1bW15LXNhbHQ='
const DUMMY_PASSWORD_HASH = 'P/FKiXHHJRFZsQ7MLmqKMp+SQoYtsIWL8P2EkVxfWsE='

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
  const length = Math.max(leftBytes.length, rightBytes.length)
  let diff = leftBytes.length ^ rightBytes.length
  for (let index = 0; index < length; index += 1) diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  return diff === 0
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
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure}`
}

function expiredSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function cleanString(value: unknown, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

async function readBody(request: Request) {
  return request.json().catch(() => null)
}

function getClientIp(request: Request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}

function hasJsonContent(request: Request) {
  return request.headers.get('content-type')?.toLowerCase().includes('application/json') ?? false
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
  await env.DB.prepare('INSERT INTO auth_attempts (id, email, ip_address, event_type) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), email, getClientIp(request), eventType).run()
}

async function authAttemptCount(env: Env, request: Request, options: { email?: string; eventTypes: string[]; minutes: number }) {
  const ip = getClientIp(request)
  const placeholders = options.eventTypes.map(() => '?').join(',')
  const bindings: unknown[] = options.email ? [options.email, ip, ...options.eventTypes, `-${options.minutes} minutes`] : [ip, ...options.eventTypes, `-${options.minutes} minutes`]
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

function validInput(value: unknown): value is GenerationInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<GenerationInput>
  return typeof input.workspaceId === 'string' && typeof input.workflowId === 'string' && typeof input.aspectRatio === 'string' && Boolean(input.brand?.name) && Boolean(input.product?.name) && Array.isArray(input.referenceImageUrls)
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
    SELECT w.id, w.name, w.plan_status AS planStatus, wm.role, COALESCE(cb.available, 0) AS availableCredits, COALESCE(cb.reserved, 0) AS reservedCredits
    FROM workspace_memberships wm
    JOIN workspaces w ON w.id = wm.workspace_id
    LEFT JOIN credit_balances cb ON cb.workspace_id = w.id
    WHERE wm.user_id = ?
    ORDER BY wm.created_at ASC
  `).bind(userId).all<Workspace>()
  return result.results
}

async function loadSessionByHash(env: Env, tokenHash: string): Promise<SessionContext | null> {
  const user = await env.DB.prepare(`
    SELECT u.id, u.email, u.name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
  `).bind(tokenHash).first<AuthUser>()
  if (!user) return null
  const workspaces = await workspacesForUser(env, user.id)
  if (!workspaces[0]) return null
  await env.DB.prepare('UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?').bind(tokenHash).run()
  return { user, currentWorkspace: workspaces[0] }
}

async function cleanExpiredSessions(env: Env) {
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP').run()
}

async function requireSession(request: Request, env: Env): Promise<SessionContext | Response> {
  const token = parseCookie(request, SESSION_COOKIE)
  if (!token) return json({ error: 'Authentication required.' }, { status: 401 })
  const session = await loadSessionByHash(env, await sha256(token))
  if (!session) return json({ error: 'Authentication required.' }, { status: 401, headers: { 'set-cookie': expiredSessionCookie(request) } })
  return session
}

async function getWorkspace(env: Env, userId: string, workspaceId: string) {
  return env.DB.prepare(`
    SELECT w.id, w.name, w.plan_status AS planStatus, wm.role, COALESCE(cb.available, 0) AS availableCredits, COALESCE(cb.reserved, 0) AS reservedCredits
    FROM workspace_memberships wm
    JOIN workspaces w ON w.id = wm.workspace_id
    LEFT JOIN credit_balances cb ON cb.workspace_id = w.id
    WHERE wm.user_id = ? AND wm.workspace_id = ?
  `).bind(userId, workspaceId).first<Workspace>()
}

async function register(request: Request, env: Env) {
  if (!hasJsonContent(request)) return json({ error: 'Expected application/json.' }, { status: 415 })
  const body = await readBody(request) as Record<string, unknown> | null
  const email = normalizeEmail(body?.email)
  const password = cleanString(body?.password, 256)
  const name = cleanString(body?.name) || email.split('@')[0]
  const workspaceName = cleanString(body?.workspaceName) || `${name} 的工作區`
  if (await isRegisterRateLimited(env, request)) {
    await recordAuthAttempt(env, request, 'rate_limited', email)
    return json({ error: '嘗試次數過多，請稍後再試。' }, { status: 429 })
  }
  if (!email.includes('@')) {
    await recordAuthAttempt(env, request, 'register_failed', email)
    return json({ error: '請輸入有效電郵地址。' }, { status: 400 })
  }
  if (password.length < 8) {
    await recordAuthAttempt(env, request, 'register_failed', email)
    return json({ error: '密碼至少需要 8 個字元。' }, { status: 400 })
  }

  const userId = crypto.randomUUID()
  const workspaceId = crypto.randomUUID()
  const passwordHash = await hashPassword(password)
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, email, name, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)').bind(userId, email, name, passwordHash.hash, passwordHash.salt),
      env.DB.prepare('INSERT INTO workspaces (id, owner_user_id, name, plan_status) VALUES (?, ?, ?, ?)').bind(workspaceId, userId, workspaceName, 'trial'),
      env.DB.prepare('INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (?, ?, ?)').bind(workspaceId, userId, 'owner'),
      env.DB.prepare('INSERT INTO credit_balances (workspace_id, available, reserved) VALUES (?, ?, 0)').bind(workspaceId, STARTER_CREDITS)
    ])
  } catch {
    await recordAuthAttempt(env, request, 'register_failed', email)
    return json({ error: '這個電郵已經註冊。' }, { status: 409 })
  }
  await recordAuthAttempt(env, request, 'register_success', email)
  return sessionResponse(env, request, userId, 201)
}

async function login(request: Request, env: Env) {
  if (!hasJsonContent(request)) return json({ error: 'Expected application/json.' }, { status: 415 })
  const body = await readBody(request) as Record<string, unknown> | null
  const email = normalizeEmail(body?.email)
  const password = cleanString(body?.password, 256)
  if (await isLoginRateLimited(env, request, email)) {
    await recordAuthAttempt(env, request, 'rate_limited', email)
    return json({ error: '登入嘗試次數過多，請稍後再試。' }, { status: 429 })
  }
  const user = await env.DB.prepare('SELECT id, email, name, password_hash AS passwordHash, password_salt AS passwordSalt FROM users WHERE email = ?').bind(email).first<AuthUser & { passwordHash: string; passwordSalt: string }>()
  const passwordMatches = user ? await verifyPassword(password, user.passwordHash, user.passwordSalt) : await verifyPassword(password, DUMMY_PASSWORD_HASH, DUMMY_PASSWORD_SALT)
  if (!user || !passwordMatches) {
    await recordAuthAttempt(env, request, 'login_failed', email)
    return json({ error: '電郵或密碼不正確。' }, { status: 401 })
  }
  await recordAuthAttempt(env, request, 'login_success', email)
  return sessionResponse(env, request, user.id)
}

async function logout(request: Request, env: Env) {
  const token = parseCookie(request, SESSION_COOKIE)
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
  return json({ ok: true }, { headers: { 'set-cookie': expiredSessionCookie(request) } })
}

async function reserveCredits(env: Env, workspaceId: string, generationId: string) {
  const result = await env.DB.prepare('UPDATE credit_balances SET available = available - ?, reserved = reserved + ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND available >= ?').bind(CREDIT_COST, CREDIT_COST, workspaceId, CREDIT_COST).run()
  if (!result.meta.changes) throw new Error('INSUFFICIENT_CREDITS')
  await env.DB.prepare('INSERT INTO credit_ledger (id, workspace_id, generation_id, event_type, amount, note) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), workspaceId, generationId, 'reservation', -CREDIT_COST, 'Generation credit reservation').run()
}

async function releaseCredits(env: Env, workspaceId: string, generationId: string, reason: string) {
  await env.DB.batch([
    env.DB.prepare('UPDATE credit_balances SET available = available + ?, reserved = MAX(reserved - ?, 0), updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ?').bind(CREDIT_COST, CREDIT_COST, workspaceId),
    env.DB.prepare('INSERT INTO credit_ledger (id, workspace_id, generation_id, event_type, amount, note) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), workspaceId, generationId, 'release', CREDIT_COST, reason)
  ])
}

async function settleCredits(env: Env, workspaceId: string, generationId: string) {
  await env.DB.batch([
    env.DB.prepare('UPDATE credit_balances SET reserved = MAX(reserved - ?, 0), updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ?').bind(CREDIT_COST, workspaceId),
    env.DB.prepare('INSERT INTO credit_ledger (id, workspace_id, generation_id, event_type, amount, note) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), workspaceId, generationId, 'settlement', 0, 'Generation completed')
  ])
}

async function createGeneration(request: Request, env: Env, session: SessionContext) {
  if (!hasJsonContent(request)) return json({ error: 'Expected application/json.' }, { status: 415 })
  const input = await request.json().catch(() => null)
  if (!validInput(input)) return json({ error: 'Invalid generation payload.' }, { status: 400 })
  const workspace = await getWorkspace(env, session.user.id, input.workspaceId)
  if (!workspace) return json({ error: 'Workspace not found.' }, { status: 404 })
  const safeInput = { ...input, workspaceId: workspace.id }
  const workflow = workflowById(input.workflowId)
  if (!workflow.ratios.includes(input.aspectRatio)) return json({ error: 'The selected ratio is not available for this workflow.' }, { status: 400 })
  const id = crypto.randomUUID()
  try {
    await reserveCredits(env, workspace.id, id)
    await env.DB.prepare('INSERT INTO generations (id, workspace_id, workflow_id, aspect_ratio, status, credit_cost, input_json) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, workspace.id, safeInput.workflowId, safeInput.aspectRatio, 'queued', CREDIT_COST, JSON.stringify(safeInput)).run()
    await env.GENERATION_QUEUE.send({ generationId: id, input: safeInput })
    return json({ id, status: 'queued', reservedCredits: CREDIT_COST }, { status: 202 })
  } catch (error) {
    if (error instanceof Error && error.message === 'INSUFFICIENT_CREDITS') return json({ error: 'Insufficient credits.' }, { status: 402 })
    return json({ error: 'Unable to queue generation.' }, { status: 503 })
  }
}

async function listGenerations(request: Request, env: Env, session: SessionContext) {
  const url = new URL(request.url)
  const workspaceId = url.searchParams.get('workspaceId') || session.currentWorkspace.id
  const workspace = await getWorkspace(env, session.user.id, workspaceId)
  if (!workspace) return json({ error: 'Workspace not found.' }, { status: 404 })
  const result = await env.DB.prepare(`
    SELECT id, workflow_id AS workflowId, status, output_key AS outputKey, error_message AS errorMessage, created_at AS createdAt
    FROM generations
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(workspace.id).all<{ id: string; workflowId: string; status: string; outputKey: string | null; errorMessage: string | null; createdAt: string }>()
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
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType || 'image/png', 'cache-control': 'private, max-age=300' } })
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && url.pathname !== '/api/wonder/webhook' && !isAllowedOrigin(request, env)) {
      return json({ error: 'Request origin is not allowed.' }, { status: 403 })
    }
    if (url.pathname.startsWith('/api/')) ctx.waitUntil(cleanExpiredSessions(env))
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) return new Response(null, { status: 204 })
    if (url.pathname === '/api/health') return json({ status: 'ok', service: 'motive-worker' })
    if (url.pathname === '/api/workflows' && request.method === 'GET') return json({ workflows: ['store-main', 'detail-banner', 'promo-poster', 'meta-ad', 'package-showcase'] })
    if (url.pathname === '/api/auth/register' && request.method === 'POST') return register(request, env)
    if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(request, env)
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logout(request, env)
    if (url.pathname === '/api/session' && request.method === 'GET') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return json({ authenticated: false }, { headers: session.headers })
      return json({ authenticated: true, user: session.user, currentWorkspace: session.currentWorkspace })
    }
    if (url.pathname === '/api/workspaces' && request.method === 'GET') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return json({ workspaces: await workspacesForUser(env, session.user.id), currentWorkspace: session.currentWorkspace })
    }
    const imageMatch = url.pathname.match(/^\/api\/generations\/([^/]+)\/image$/)
    if (imageMatch && request.method === 'GET') {
      const session = await requireSession(request, env)
      if (session instanceof Response) return session
      return generationImage(request, env, session, imageMatch[1])
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
    if (url.pathname === '/api/wonder/webhook' && request.method === 'POST') {
      try {
        const event = await new WonderBillingProvider().verifyWebhook(request)
        await env.DB.prepare('INSERT INTO payment_events (provider_event_id, provider, event_type, payload_json) VALUES (?, ?, ?, ?)').bind(event.eventId, 'wonder', event.type, JSON.stringify(event.data)).run()
        return json({ received: true })
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Webhook rejected.' }, { status: 401 })
      }
    }
    return json({ error: 'Not found.' }, { status: 404 })
  },

  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      const { generationId, input } = message.body as GenerationMessage
      try {
        await env.DB.prepare('UPDATE generations SET status = ? WHERE id = ? AND status = ?').bind('processing', generationId, 'queued').run()
        if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured.')
        const workflow = workflowById(input.workflowId)
        const copy = await new OpenAICopyProvider(env.OPENAI_API_KEY).createCopy({ brand: input.brand, product: input.product, workflowTitle: workflow.title, aspectRatio: input.aspectRatio })
        const generated = await new OpenAIImageProvider(env.OPENAI_API_KEY).generate({ prompt: copy.imagePrompt, aspectRatio: input.aspectRatio, referenceImageUrls: input.referenceImageUrls })
        const key = `workspaces/${input.workspaceId}/generations/${generationId}.png`
        await env.MEDIA_BUCKET.put(key, Uint8Array.from(atob(generated.imageBase64), (char) => char.charCodeAt(0)), { httpMetadata: { contentType: 'image/png' }, customMetadata: { workflow: input.workflowId } })
        await env.DB.prepare('UPDATE generations SET status = ?, output_key = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').bind('completed', key, generationId).run()
        await settleCredits(env, input.workspaceId, generationId)
        message.ack()
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Generation failed.'
        await env.DB.prepare('UPDATE generations SET status = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').bind('failed', reason, generationId).run()
        await releaseCredits(env, input.workspaceId, generationId, reason)
        message.ack()
      }
    }
  }
} satisfies ExportedHandler<Env, GenerationMessage>
