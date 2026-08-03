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

function withWorkspaceShell(baseEnv: Env) {
  const fetchAsset = vi.fn(async () => new Response('<!doctype html><title>AisleStage workspace</title>', {
    headers: { 'content-type': 'text/html; charset=utf-8' }
  }))
  const assetEnv = {
    ...baseEnv,
    ASSETS: { ...baseEnv.ASSETS, fetch: fetchAsset }
  } as Env
  return { assetEnv, fetchAsset }
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
    const response = await dispatch('/api/session', { headers: { cookie: 'aislestage_session=untrusted' } }, fixture.accessEnv)

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ authenticated: false, code: 'authentication-required' })
  })

  it('keeps the workspace shell behind Access JWT and D1 membership checks', async () => {
    const fixture = await accessFixture()
    const provisioned = await dispatch('/api/session', {
      headers: { 'cf-access-jwt-assertion': fixture.token }
    }, fixture.accessEnv)
    expect(provisioned.status).toBe(200)

    const restrictedEnv = { ...fixture.accessEnv, ACCESS_AUTO_PROVISION: 'disabled' } as Env
    const { assetEnv, fetchAsset } = withWorkspaceShell(restrictedEnv)

    const denied = await dispatch('/app', {}, assetEnv)
    expect(denied.status).toBe(401)
    expect(fetchAsset).not.toHaveBeenCalled()

    const allowed = await dispatch('/app/campaign-packs', {
      headers: { 'cf-access-jwt-assertion': fixture.token }
    }, assetEnv)
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('cache-control')).toBe('private, no-store')
    expect(allowed.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await allowed.text()).toContain('AisleStage workspace')
    expect(fetchAsset).toHaveBeenCalledOnce()
  })

  it('keeps the local password-mode shell available before sign-in', async () => {
    const { assetEnv, fetchAsset } = withWorkspaceShell({ ...env, AUTH_MODE: 'password' } as Env)
    const response = await dispatch('/app', {}, assetEnv)

    expect(response.status).toBe(200)
    expect(fetchAsset).toHaveBeenCalledOnce()
  })

  it('rejects state-changing requests to the workspace shell route', async () => {
    const fixture = await accessFixture()
    const { assetEnv, fetchAsset } = withWorkspaceShell(fixture.accessEnv)
    const response = await dispatch('/app', { method: 'POST' }, assetEnv)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
    expect(fetchAsset).not.toHaveBeenCalled()
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

    const { assetEnv, fetchAsset } = withWorkspaceShell(fixture.accessEnv)
    const appResponse = await dispatch('/app', { headers: { 'cf-access-jwt-assertion': fixture.token } }, assetEnv)
    expect(appResponse.status).toBe(403)
    expect(fetchAsset).not.toHaveBeenCalled()
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
