import { env } from 'cloudflare:workers'
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import worker from '../src/worker'
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

  it('reconciles an invited registration batch that commits before D1 reports failure', async () => {
    const email = `ambiguous-beta-${crypto.randomUUID()}@example.test`
    const inviteCode = `invite-${crypto.randomUUID()}`
    const inviteId = await createBetaInvite(email, inviteCode)
    let registrationBatch = true
    const ambiguousDb = {
      prepare: env.DB.prepare.bind(env.DB),
      async batch<T = unknown>(statements: D1PreparedStatement[]) {
        const result = await env.DB.batch<T>(statements)
        if (registrationBatch) {
          registrationBatch = false
          throw new TypeError('synthetic response failure after registration commit')
        }
        return result
      }
    } as unknown as typeof env.DB

    const response = await dispatch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.16', origin: 'https://app.test' },
      body: JSON.stringify({
        email,
        inviteCode,
        password: 'SecurePass123!',
        name: 'Ambiguous Beta',
        workspaceName: 'Ambiguous Workspace'
      })
    }, { ...env, DB: ambiguousDb, REGISTRATION_MODE: 'invite' })

    expect(response.status).toBe(201)
    expect(response.headers.get('set-cookie')).toContain('aislestage_session=')
    const payload = await response.json() as {
      user: { id: string; email: string; accountType: string }
      currentWorkspace: { id: string; name: string; role: string; availableOutputs: number; reservedOutputs: number }
    }
    expect(payload.user).toMatchObject({ email, accountType: 'beta' })
    expect(payload.currentWorkspace).toMatchObject({
      name: 'Ambiguous Workspace',
      role: 'owner',
      availableOutputs: 3,
      reservedOutputs: 0
    })
    expect(await env.DB.prepare('SELECT status, used_by_user_id AS usedByUserId FROM beta_invites WHERE id = ?')
      .bind(inviteId)
      .first()).toEqual({ status: 'used', usedByUserId: payload.user.id })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?').bind(email).first()).toEqual({ count: 1 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM workspaces WHERE id = ? AND owner_user_id = ?')
      .bind(payload.currentWorkspace.id, payload.user.id)
      .first()).toEqual({ count: 1 })
    expect(await env.DB.prepare(`
      SELECT event_type AS eventType, COUNT(*) AS count
      FROM auth_attempts
      WHERE email = ?
      GROUP BY event_type
    `).bind(await hashValue(email)).all()).toMatchObject({ results: [{ eventType: 'register_success', count: 1 }] })
    expect((await dispatch('/api/session', { headers: { cookie: cookieFrom(response) } })).status).toBe(200)
  })

  it('does not reconcile an existing email as the current registration attempt', async () => {
    const account = await registerAccount('Existing Registration Identity')
    const before = await env.DB.prepare('SELECT COUNT(*) AS count FROM workspaces').first<{ count: number }>()

    const response = await dispatch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.17', origin: 'https://app.test' },
      body: JSON.stringify({
        email: account.user.email,
        password: 'DifferentPass123!',
        name: 'Unrelated Attempt',
        workspaceName: 'Unrelated Workspace'
      })
    })

    expect(response.status).toBe(409)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?')
      .bind(account.user.email)
      .first()).toEqual({ count: 1 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM workspaces').first()).toEqual(before)
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

  it('keeps only the fixed public API endpoints anonymously readable', async () => {
    for (const path of ['/api/health', '/api/workflows']) {
      expect((await dispatch(path)).status, path).toBe(200)
      expect((await dispatch(path, { method: 'HEAD' })).status, `${path} HEAD`).toBe(200)

      for (const method of ['POST', 'OPTIONS']) {
        const response = await dispatch(path, { method, headers: { origin: 'https://app.test' } })
        expect(response.status, `${method} ${path}`).toBe(405)
        expect(response.headers.get('allow')).toBe('GET, HEAD')
      }
    }

    const unknown = await dispatch('/api/not-a-public-endpoint')
    expect(unknown.status).toBe(401)
    const privatePreflight = await dispatch('/api/generations', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.test' }
    })
    expect(privatePreflight.status).toBe(401)
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

  it('reconciles a logout delete that commits before D1 reports failure', async () => {
    const account = await registerAccount('Ambiguous Logout Delete')
    const ambiguousDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('DELETE FROM sessions WHERE token_hash')) return statement
        return {
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values)
            return {
              run: async () => {
                await bound.run()
                throw new TypeError('synthetic response failure after logout commit')
              }
            }
          }
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const logout = await dispatch('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: account.cookie, origin: 'https://app.test' }
    }, { ...env, DB: ambiguousDb })

    expect(logout.status).toBe(200)
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
      .bind(account.user.id)
      .first()).toEqual({ count: 0 })
    expect(await dispatch('/api/session', { headers: { cookie: account.cookie } }).then((response) => response.json()))
      .toEqual({ authenticated: false })
  })

  it('keeps the retryable session when logout deletion does not commit', async () => {
    const account = await registerAccount('Rejected Logout Delete')
    const rejectingDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('DELETE FROM sessions WHERE token_hash')) return statement
        return {
          bind: () => ({
            run: async () => { throw new TypeError('synthetic failure before logout commit') }
          })
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const logout = await dispatch('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: account.cookie, origin: 'https://app.test' }
    }, { ...env, DB: rejectingDb })

    expect(logout.status).toBe(503)
    expect(logout.headers.get('set-cookie')).toBeNull()
    expect(await logout.json()).toEqual({ error: '未能確認登出狀態。 Unable to confirm logout.' })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
      .bind(account.user.id)
      .first()).toEqual({ count: 1 })
    expect((await dispatch('/api/session', { headers: { cookie: account.cookie } })).status).toBe(200)
  })

  it('reconciles a session insert that commits before D1 reports failure', async () => {
    const account = await registerAccount('Ambiguous Session Insert')
    const logout = await dispatch('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: account.cookie, origin: 'https://app.test' }
    })
    expect(logout.status).toBe(200)

    const ambiguousDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('INSERT INTO sessions')) return statement
        return {
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values)
            return {
              run: async () => {
                await bound.run()
                throw new TypeError('synthetic response failure after session commit')
              }
            }
          }
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const login = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.18', origin: 'https://app.test' },
      body: JSON.stringify({ email: account.user.email, password: 'SecurePass123!' })
    }, { ...env, DB: ambiguousDb })

    expect(login.status).toBe(200)
    expect(login.headers.get('set-cookie')).toContain('aislestage_session=')
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
      .bind(account.user.id)
      .first()).toEqual({ count: 1 })
    const session = await dispatch('/api/session', { headers: { cookie: cookieFrom(login) } })
    expect(session.status).toBe(200)
    expect(await session.json()).toMatchObject({ authenticated: true, user: { id: account.user.id } })
  })

  it('returns a bilingual failure without a cookie when a session insert does not commit', async () => {
    const account = await registerAccount('Rejected Session Insert')
    await dispatch('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: account.cookie, origin: 'https://app.test' }
    })
    const rejectingDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('INSERT INTO sessions')) return statement
        return {
          bind: () => ({
            run: async () => { throw new TypeError('synthetic failure before session commit') }
          })
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const login = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.22', origin: 'https://app.test' },
      body: JSON.stringify({ email: account.user.email, password: 'SecurePass123!' })
    }, { ...env, DB: rejectingDb })

    expect(login.status).toBe(503)
    expect(login.headers.get('set-cookie')).toBeNull()
    expect(await login.json()).toEqual({ error: '未能建立登入工作階段。 Unable to create session.' })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
      .bind(account.user.id)
      .first()).toEqual({ count: 0 })
  })

  it('removes an undelivered session when authorization reload fails', async () => {
    const account = await registerAccount('Rejected Session Reload')
    await dispatch('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: account.cookie, origin: 'https://app.test' }
    })
    const reloadFailureDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('FROM sessions s')) return statement
        return {
          bind: () => ({
            first: async () => { throw new TypeError('synthetic session authorization reload failure') }
          })
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const login = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.23', origin: 'https://app.test' },
      body: JSON.stringify({ email: account.user.email, password: 'SecurePass123!' })
    }, { ...env, DB: reloadFailureDb })

    expect(login.status).toBe(503)
    expect(login.headers.get('set-cookie')).toBeNull()
    expect(await login.json()).toEqual({ error: '未能建立登入工作階段。 Unable to create session.' })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
      .bind(account.user.id)
      .first()).toEqual({ count: 0 })
  })

  it('reconciles an authentication event that commits before D1 reports failure', async () => {
    const account = await registerAccount('Ambiguous Auth Event')
    await dispatch('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: account.cookie, origin: 'https://app.test' }
    })
    const ambiguousDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('INSERT INTO auth_attempts')) return statement
        return {
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values)
            return {
              run: async () => {
                await bound.run()
                throw new TypeError('synthetic response failure after auth event commit')
              }
            }
          }
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const login = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.19', origin: 'https://app.test' },
      body: JSON.stringify({ email: account.user.email, password: 'SecurePass123!' })
    }, { ...env, DB: ambiguousDb })

    expect(login.status).toBe(200)
    expect(login.headers.get('set-cookie')).toContain('aislestage_session=')
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM auth_attempts
      WHERE email = ? AND event_type = 'login_success'
    `).bind(await hashValue(account.user.email)).first()).toEqual({ count: 1 })
    expect((await dispatch('/api/session', { headers: { cookie: cookieFrom(login) } })).status).toBe(200)
  })

  it('retries one definitely uncommitted authentication event with the same identity', async () => {
    const account = await registerAccount('Transient Auth Event')
    await dispatch('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: account.cookie, origin: 'https://app.test' }
    })
    let insertAttempts = 0
    const transientDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('INSERT INTO auth_attempts')) return statement
        return {
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values)
            return {
              run: async () => {
                insertAttempts += 1
                if (insertAttempts === 1) throw new TypeError('synthetic transient failure before auth event commit')
                return bound.run()
              }
            }
          }
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const login = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.24', origin: 'https://app.test' },
      body: JSON.stringify({ email: account.user.email, password: 'SecurePass123!' })
    }, { ...env, DB: transientDb })

    expect(login.status).toBe(200)
    expect(login.headers.get('set-cookie')).toContain('aislestage_session=')
    expect(insertAttempts).toBe(2)
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM auth_attempts
      WHERE email = ? AND event_type = 'login_success'
    `).bind(await hashValue(account.user.email)).first()).toEqual({ count: 1 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
      .bind(account.user.id)
      .first()).toEqual({ count: 1 })
  })

  it('fails closed without a session when an authentication event does not commit', async () => {
    const account = await registerAccount('Rejected Auth Event')
    await dispatch('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: account.cookie, origin: 'https://app.test' }
    })
    const rejectingDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('INSERT INTO auth_attempts')) return statement
        return {
          bind: () => ({
            run: async () => { throw new TypeError('synthetic failure before auth event commit') }
          })
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const login = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.20', origin: 'https://app.test' },
      body: JSON.stringify({ email: account.user.email, password: 'SecurePass123!' })
    }, { ...env, DB: rejectingDb })

    expect(login.status).toBe(503)
    expect(login.headers.get('cache-control')).toBe('no-store')
    expect(await login.json()).toEqual({ error: '登入安全狀態暫時無法確認。 Authentication security state is temporarily unavailable.' })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
      .bind(account.user.id)
      .first()).toEqual({ count: 0 })
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM auth_attempts
      WHERE email = ? AND event_type = 'login_success'
    `).bind(await hashValue(account.user.email)).first()).toEqual({ count: 0 })
  })

  it('fails closed before credential lookup when rate-limit state is unreadable', async () => {
    const rateLimitFailureDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('SELECT COUNT(*) AS count') || !query.includes('FROM auth_attempts')) return statement
        return {
          bind: () => ({
            first: async () => { throw new TypeError('synthetic auth rate-limit read failure') }
          })
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const login = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.21', origin: 'https://app.test' },
      body: JSON.stringify({ email: 'unreadable@example.test', password: 'SecurePass123!' })
    }, { ...env, DB: rateLimitFailureDb })

    expect(login.status).toBe(503)
    expect(login.headers.get('cache-control')).toBe('no-store')
    expect(await login.json()).toEqual({ error: '登入安全狀態暫時無法確認。 Authentication security state is temporarily unavailable.' })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?')
      .bind('unreadable@example.test')
      .first()).toEqual({ count: 0 })
  })

  it('does not make active-session authorization depend on last-seen telemetry', async () => {
    const account = await registerAccount('Last Seen Telemetry')
    const telemetryFailureDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('UPDATE sessions SET last_seen_at')) return statement
        return {
          bind: () => ({
            run: async () => { throw new TypeError('synthetic last-seen telemetry failure') }
          })
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const response = await dispatch('/api/session', {
      headers: { cookie: account.cookie }
    }, { ...env, DB: telemetryFailureDb })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      authenticated: true,
      user: { id: account.user.id, accountStatus: 'active' },
      currentWorkspace: { id: account.currentWorkspace.id, accessStatus: 'active' }
    })
  })

  it('reports session authorization unavailable when the password session row cannot be read', async () => {
    const account = await registerAccount('Unreadable Session Row')
    const sessionReadFailureDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('FROM sessions s')) return statement
        return {
          bind: () => ({
            first: async () => { throw new TypeError('synthetic session row read failure') }
          })
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const response = await dispatch('/api/session', {
      headers: { cookie: account.cookie }
    }, { ...env, DB: sessionReadFailureDb })

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.json()).toEqual({
      authenticated: false,
      code: 'unavailable',
      error: '登入工作階段暫時無法確認。 Session authorization is temporarily unavailable.'
    })
  })

  it('reports session authorization unavailable when password workspace membership cannot be read', async () => {
    const account = await registerAccount('Unreadable Session Workspace')
    const workspaceReadFailureDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('FROM workspace_memberships wm')) return statement
        return {
          bind: () => ({
            all: async () => { throw new TypeError('synthetic session workspace read failure') }
          })
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const response = await dispatch('/api/workspaces', {
      headers: { cookie: account.cookie }
    }, { ...env, DB: workspaceReadFailureDb })

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.json()).toEqual({
      code: 'unavailable',
      error: '登入工作階段暫時無法確認。 Session authorization is temporarily unavailable.'
    })
  })

  it('rejects expired sessions and expires the browser cookie', async () => {
    const account = await registerAccount('Expired User')
    await env.DB.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 minute') WHERE user_id = ?").bind(account.user.id).run()

    const response = await dispatch('/api/session', { headers: { cookie: account.cookie } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ authenticated: false })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('minimizes expired authentication and invite records on the scheduled cleanup', async () => {
    const account = await registerAccount('Scheduled Auth Cleanup')
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('expired-session', ?, datetime('now', '-1 minute'))").bind(account.user.id),
      env.DB.prepare("INSERT INTO auth_attempts (id, email, ip_address, event_type, created_at) VALUES ('old-attempt', 'old-email-key', 'old-ip-key', 'login_failed', datetime('now', '-8 days'))"),
      env.DB.prepare("INSERT INTO auth_attempts (id, email, ip_address, event_type, created_at) VALUES ('recent-attempt', 'recent-email-key', 'recent-ip-key', 'login_failed', datetime('now', '-1 day'))"),
      env.DB.prepare("INSERT INTO beta_invites (id, token_hash, recipient_hash, status, expires_at) VALUES ('expired-pending', 'token-expired-pending', 'recipient-expired-pending', 'pending', datetime('now', '-1 minute'))"),
      env.DB.prepare("INSERT INTO beta_invites (id, token_hash, recipient_hash, status, expires_at) VALUES ('expired-revoked', 'token-expired-revoked', 'recipient-expired-revoked', 'revoked', datetime('now', '-1 minute'))"),
      env.DB.prepare("INSERT INTO beta_invites (id, token_hash, recipient_hash, status, expires_at, used_by_user_id, used_at) VALUES ('old-used', 'token-old-used', 'recipient-old-used', 'used', datetime('now', '+7 days'), ?, datetime('now', '-31 days'))").bind(account.user.id),
      env.DB.prepare("INSERT INTO beta_invites (id, token_hash, recipient_hash, status, expires_at, used_by_user_id, used_at) VALUES ('recent-used', 'token-recent-used', 'recipient-recent-used', 'used', datetime('now', '+7 days'), ?, datetime('now', '-29 days'))").bind(account.user.id),
      env.DB.prepare("INSERT INTO beta_invites (id, token_hash, recipient_hash, status, expires_at) VALUES ('future-pending', 'token-future-pending', 'recipient-future-pending', 'pending', datetime('now', '+1 day'))")
    ])

    const context = createExecutionContext()
    await worker.scheduled(createScheduledController(), env, context)
    await waitOnExecutionContext(context)

    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM sessions WHERE token_hash = 'expired-session'").first()).toEqual({ count: 0 })
    expect(await env.DB.prepare("SELECT id FROM auth_attempts WHERE id IN ('old-attempt', 'recent-attempt') ORDER BY id").all()).toMatchObject({ results: [{ id: 'recent-attempt' }] })
    expect(await env.DB.prepare("SELECT id FROM beta_invites WHERE id IN ('expired-pending', 'expired-revoked', 'old-used', 'recent-used', 'future-pending') ORDER BY id").all()).toMatchObject({
      results: [{ id: 'future-pending' }, { id: 'recent-used' }]
    })
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
