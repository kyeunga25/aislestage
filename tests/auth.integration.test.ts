import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { cookieFrom, dispatch, registerAccount } from './helpers'

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function hashValue(value: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}

async function createBetaInvite(email: string, inviteCode: string, accountType: 'beta' | 'test' = 'beta') {
  const id = crypto.randomUUID()
  await env.DB.prepare(`
    INSERT INTO beta_invites (id, token_hash, recipient_hash, account_type, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', '+7 days'))
  `).bind(id, await hashValue(inviteCode), await hashValue(`${email.toLowerCase()}\n${inviteCode}`), accountType).run()
  return id
}

describe('restricted registration authentication', () => {
  it('keeps public registration closed when the server-side gate is closed', async () => {
    const response = await dispatch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://app.test' },
      body: JSON.stringify({ email: 'closed@example.test', password: 'SecurePass123!' })
    }, { ...env, REGISTRATION_MODE: 'closed' })

    expect(response.status).toBe(403)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>()).toEqual({ count: 0 })
  })

  it('registers one owner workspace with a starter output allowance and a hardened cookie', async () => {
    const email = `owner-${crypto.randomUUID()}@example.test`
    const response = await dispatch('/api/auth/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '198.51.100.10',
        origin: 'https://app.test'
      },
      body: JSON.stringify({ email, password: 'SecurePass123!', name: 'Owner', workspaceName: 'Owner Workspace' })
    })

    expect(response.status).toBe(201)
    const setCookie = response.headers.get('set-cookie') || ''
    expect(setCookie).toContain('aislestage_session=')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Max-Age=5184000')
    expect(setCookie).toContain('Secure')

    const payload = await response.json() as { user: { id: string; accountStatus: string; accountType: string }; currentWorkspace: { id: string; role: string; accessStatus: string; availableOutputs: number; reservedOutputs: number } }
    expect(payload.user).toMatchObject({ accountStatus: 'active', accountType: 'standard' })
    expect(payload.currentWorkspace).toMatchObject({ role: 'owner', accessStatus: 'active', availableOutputs: 3, reservedOutputs: 0 })

    const membership = await env.DB.prepare('SELECT role FROM workspace_memberships WHERE user_id = ? AND workspace_id = ?')
      .bind(payload.user.id, payload.currentWorkspace.id)
      .first<{ role: string }>()
    expect(membership?.role).toBe('owner')

    const session = await dispatch('/api/session', { headers: { cookie: cookieFrom(response) } })
    expect(session.status).toBe(200)
    expect(await session.json()).toMatchObject({ authenticated: true, user: { id: payload.user.id } })
  })

  it('creates a beta account only from an unexpired email-bound invite', async () => {
    const email = `beta-${crypto.randomUUID()}@example.test`
    const inviteCode = `invite-${crypto.randomUUID()}`
    const inviteId = await createBetaInvite(email, inviteCode)

    const response = await dispatch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.12', origin: 'https://app.test' },
      body: JSON.stringify({ email, inviteCode, password: 'SecurePass123!', name: 'Beta Tester', workspaceName: 'Beta Workspace' })
    }, { ...env, REGISTRATION_MODE: 'invite' })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ user: { accountStatus: 'active', accountType: 'beta' }, currentWorkspace: { role: 'owner' } })
    expect(await env.DB.prepare('SELECT status FROM beta_invites WHERE id = ?').bind(inviteId).first()).toEqual({ status: 'used' })

    const reused = await dispatch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.15', origin: 'https://app.test' },
      body: JSON.stringify({ email, inviteCode, password: 'SecurePass123!' })
    }, { ...env, REGISTRATION_MODE: 'invite' })
    expect(reused.status).toBe(403)
  })

  it('rejects an invite that is not bound to the submitted email', async () => {
    const inviteCode = `invite-${crypto.randomUUID()}`
    await createBetaInvite(`intended-${crypto.randomUUID()}@example.test`, inviteCode)

    const response = await dispatch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.13', origin: 'https://app.test' },
      body: JSON.stringify({ email: `other-${crypto.randomUUID()}@example.test`, inviteCode, password: 'SecurePass123!' })
    }, { ...env, REGISTRATION_MODE: 'invite' })

    expect(response.status).toBe(403)
  })

  it('reports invite registration without opening public registration', async () => {
    const response = await dispatch('/api/health', {}, { ...env, REGISTRATION_MODE: 'invite' })
    expect(await response.json()).toMatchObject({ registrationMode: 'invite', registrationOpen: true })
  })

  it('logs in, logs out and invalidates the stored session', async () => {
    const account = await registerAccount('Login User')
    const logout = await dispatch('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: account.cookie, origin: 'https://app.test' }
    })

    expect(logout.status).toBe(200)
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').bind(account.user.id).first<{ count: number }>()).toEqual({ count: 0 })

    const loggedOutSession = await dispatch('/api/session', { headers: { cookie: account.cookie } })
    expect(await loggedOutSession.json()).toEqual({ authenticated: false })

    const login = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.11', origin: 'https://app.test' },
      body: JSON.stringify({ email: account.user.email, password: 'SecurePass123!' })
    })
    expect(login.status).toBe(200)
    expect(login.headers.get('set-cookie')).toContain('Secure')
  })

  it('rejects expired sessions and expires the browser cookie', async () => {
    const account = await registerAccount('Expired User')
    await env.DB.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 minute') WHERE user_id = ?").bind(account.user.id).run()

    const response = await dispatch('/api/session', { headers: { cookie: account.cookie } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ authenticated: false })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('blocks suspended accounts from existing sessions and new logins', async () => {
    const account = await registerAccount('Suspended User')
    await env.DB.prepare("UPDATE users SET account_status = 'suspended' WHERE id = ?").bind(account.user.id).run()

    const session = await dispatch('/api/session', { headers: { cookie: account.cookie } })
    expect(await session.json()).toEqual({ authenticated: false })
    expect(session.headers.get('set-cookie')).toContain('Max-Age=0')

    const login = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.14', origin: 'https://app.test' },
      body: JSON.stringify({ email: account.user.email, password: 'SecurePass123!' })
    })
    expect(login.status).toBe(403)
  })

  it('returns 401 for every protected resource without a session', async () => {
    for (const path of ['/api/workspaces', '/api/generations', '/api/generations/missing/image', '/api/assets/missing', '/api/campaign-agent']) {
      const response = await dispatch(path)
      expect(response.status, path).toBe(401)
      expect(await response.json()).toEqual({ error: 'Authentication required.' })
    }
    const campaignPack = await dispatch('/api/campaign-packs', { method: 'POST' })
    expect(campaignPack.status).toBe(401)
  })

  it('blocks cross-site state-changing requests', async () => {
    const response = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.test' },
      body: JSON.stringify({ email: 'user@example.test', password: 'SecurePass123!' })
    })
    expect(response.status).toBe(403)
  })

  it('rejects malformed registration email addresses', async () => {
    const response = await dispatch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.40', origin: 'https://app.test' },
      body: JSON.stringify({ email: 'not-an-email@', password: 'SecurePass123!' })
    })
    expect(response.status).toBe(400)
  })

  it('rejects oversized authentication payloads before password processing', async () => {
    const response = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.41', origin: 'https://app.test' },
      body: JSON.stringify({ email: 'user@example.test', password: 'x'.repeat(8_300) })
    })
    expect(response.status).toBe(413)
  })

  it('rate limits repeated login failures for the same email and IP', async () => {
    const email = `limited-${crypto.randomUUID()}@example.test`
    const ip = '198.51.100.42'
    const [emailKey, ipKey] = await Promise.all([hashValue(email), hashValue(ip)])
    const attempts = Array.from({ length: 8 }, () => env.DB.prepare(
      "INSERT INTO auth_attempts (id, email, ip_address, event_type) VALUES (?, ?, ?, 'login_failed')"
    ).bind(crypto.randomUUID(), emailKey, ipKey))
    await env.DB.batch(attempts)

    const response = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, origin: 'https://app.test' },
      body: JSON.stringify({ email, password: 'WrongPassword123!' })
    })
    expect(response.status).toBe(429)
  })
})
