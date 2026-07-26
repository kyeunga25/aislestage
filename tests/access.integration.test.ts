import { env } from 'cloudflare:workers'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/worker'
import { dispatch } from './helpers'

async function accessFixture(options: { autoProvision?: boolean; email?: string; subject?: string } = {}) {
  const keyId = crypto.randomUUID()
  const audience = `aud-${crypto.randomUUID()}`
  const teamDomain = `https://team-${crypto.randomUUID()}.cloudflareaccess.com`
  const email = options.email || `access-${crypto.randomUUID()}@example.test`
  const subject = options.subject || `subject-${crypto.randomUUID()}`
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  vi.stubGlobal('fetch', vi.fn(async (request: RequestInfo | URL) => {
    const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
    if (url !== `${teamDomain}/cdn-cgi/access/certs`) return new Response('not found', { status: 404 })
    return Response.json({ keys: [{ ...jwk, kid: keyId, alg: 'RS256', use: 'sig' }] })
  }))
  const token = await new SignJWT({ email, name: 'Access Tester' })
    .setProtectedHeader({ alg: 'RS256', kid: keyId })
    .setIssuer(teamDomain)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
  const accessEnv = {
    ...env,
    AUTH_MODE: 'access',
    ACCESS_TEAM_DOMAIN: teamDomain,
    ACCESS_AUD: audience,
    ACCESS_AUTO_PROVISION: options.autoProvision === false ? 'disabled' : 'enabled'
  } as Env
  return { accessEnv, audience, email, subject, teamDomain, token }
}

describe('Cloudflare Access authentication', () => {
  it('fails closed when protected Access configuration is missing', async () => {
    const response = await dispatch('/api/session', {}, {
      ...env,
      AUTH_MODE: 'access',
      ACCESS_TEAM_DOMAIN: '',
      ACCESS_AUD: ''
    } as Env)

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ authenticated: false, code: 'configuration-error' })
  })

  it('requires the signed Access assertion instead of trusting a browser session cookie', async () => {
    const fixture = await accessFixture()
    const response = await dispatch('/api/session', { headers: { cookie: 'aislepack_session=untrusted' } }, fixture.accessEnv)

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ authenticated: false, code: 'authentication-required' })
  })

  it('provisions one private beta workspace from a verified, policy-approved identity', async () => {
    const fixture = await accessFixture()
    const response = await dispatch('/api/session', { headers: { 'cf-access-jwt-assertion': fixture.token } }, fixture.accessEnv)

    expect(response.status).toBe(200)
    const payload = await response.json() as { authenticated: boolean; user: { id: string; email: string; accountType: string }; currentWorkspace: { id: string; role: string; availableOutputs: number } }
    expect(payload).toMatchObject({
      authenticated: true,
      user: { email: fixture.email, accountType: 'beta' },
      currentWorkspace: { role: 'owner', availableOutputs: 3 }
    })

    const stored = await env.DB.prepare('SELECT auth_mode AS authMode, access_subject_hash AS subjectHash FROM users WHERE id = ?')
      .bind(payload.user.id)
      .first<{ authMode: string; subjectHash: string }>()
    expect(stored?.authMode).toBe('access')
    expect(stored?.subjectHash).toBeTruthy()
    expect(stored?.subjectHash).not.toBe(fixture.subject)

    const repeated = await dispatch('/api/session', { headers: { 'cf-access-jwt-assertion': fixture.token } }, fixture.accessEnv)
    expect(await repeated.json()).toMatchObject({ currentWorkspace: { id: payload.currentWorkspace.id } })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?').bind(fixture.email).first()).toEqual({ count: 1 })
  })

  it('keeps a valid Access identity outside the app when no workspace invitation can be provisioned', async () => {
    const fixture = await accessFixture({ autoProvision: false })
    const response = await dispatch('/api/session', { headers: { 'cf-access-jwt-assertion': fixture.token } }, fixture.accessEnv)

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ authenticated: false, code: 'membership-required' })
  })

  it('rejects a correctly signed assertion issued for another Access application', async () => {
    const fixture = await accessFixture()
    const wrongAudienceEnv = { ...fixture.accessEnv, ACCESS_AUD: 'another-application' }
    const response = await dispatch('/api/session', { headers: { 'cf-access-jwt-assertion': fixture.token } }, wrongAudienceEnv)

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ authenticated: false, code: 'authentication-required' })
  })

  it('disables password login and registration in Access mode', async () => {
    const fixture = await accessFixture()
    for (const path of ['/api/auth/login', '/api/auth/register']) {
      const response = await dispatch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://app.test' },
        body: JSON.stringify({ email: fixture.email, password: 'SecurePass123!' })
      }, fixture.accessEnv)
      expect(response.status, path).toBe(404)
    }
  })
})
