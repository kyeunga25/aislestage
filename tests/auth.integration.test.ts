import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { cookieFrom, dispatch, registerAccount } from './helpers'

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

  it('registers one owner workspace with starter credits and a hardened cookie', async () => {
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
    expect(setCookie).toContain('aislepack_session=')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Max-Age=5184000')
    expect(setCookie).toContain('Secure')

    const payload = await response.json() as { user: { id: string }; currentWorkspace: { id: string; role: string; availableCredits: number; reservedCredits: number } }
    expect(payload.currentWorkspace).toMatchObject({ role: 'owner', availableCredits: 3, reservedCredits: 0 })

    const membership = await env.DB.prepare('SELECT role FROM workspace_memberships WHERE user_id = ? AND workspace_id = ?')
      .bind(payload.user.id, payload.currentWorkspace.id)
      .first<{ role: string }>()
    expect(membership?.role).toBe('owner')

    const session = await dispatch('/api/session', { headers: { cookie: cookieFrom(response) } })
    expect(session.status).toBe(200)
    expect(await session.json()).toMatchObject({ authenticated: true, user: { id: payload.user.id } })
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

  it('returns 401 for every protected resource without a session', async () => {
    for (const path of ['/api/workspaces', '/api/generations', '/api/generations/missing/image', '/api/assets/missing', '/api/campaign-agent']) {
      const response = await dispatch(path)
      expect(response.status, path).toBe(401)
      expect(await response.json()).toEqual({ error: 'Authentication required.' })
    }
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
    const attempts = Array.from({ length: 8 }, () => env.DB.prepare(
      "INSERT INTO auth_attempts (id, email, ip_address, event_type) VALUES (?, ?, ?, 'login_failed')"
    ).bind(crypto.randomUUID(), email, ip))
    await env.DB.batch(attempts)

    const response = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, origin: 'https://app.test' },
      body: JSON.stringify({ email, password: 'WrongPassword123!' })
    })
    expect(response.status).toBe(429)
  })
})
