import { env } from 'cloudflare:workers'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/worker'
import { dispatch } from './helpers'

async function accessFixture(options: {
  autoProvision?: boolean
  email?: string
  subject?: string
  issuer?: string
  expirationTime?: string | number
  issuedAt?: number
} = {}) {
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
  const signer = new SignJWT({ email, name: 'Access Tester' })
    .setProtectedHeader({ alg: 'RS256', kid: keyId })
    .setIssuer(options.issuer || teamDomain)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt(options.issuedAt)
    .setExpirationTime(options.expirationTime ?? '5m')
  const token = await signer.sign(privateKey)
  const accessEnv = {
    ...env,
    AUTH_MODE: 'access',
    ACCESS_TEAM_DOMAIN: teamDomain,
    ACCESS_AUD: audience,
    ACCESS_AUTO_PROVISION: options.autoProvision === false ? 'disabled' : 'enabled'
  } as Env
  return { accessEnv, audience, email, subject, teamDomain, token }
}

async function seedAccessOwner(email: string, availableOutputs = 6) {
  const userId = crypto.randomUUID()
  const workspaceId = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users (id, email, name, password_hash, password_salt, account_type, account_status, auth_mode)
      VALUES (?, ?, 'Access Owner', 'disabled', 'disabled', 'beta', 'active', 'access')
    `).bind(userId, email),
    env.DB.prepare(`
      INSERT INTO workspaces (id, owner_user_id, name, plan_status, access_status)
      VALUES (?, ?, 'AisleStage Workspace', 'active', 'active')
    `).bind(workspaceId, userId),
    env.DB.prepare('INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (?, ?, ?)').bind(workspaceId, userId, 'owner'),
    env.DB.prepare('INSERT INTO output_allowances (workspace_id, available, reserved) VALUES (?, ?, 0)').bind(workspaceId, availableOutputs)
  ])
  return { userId, workspaceId }
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

  it('rejects assertions with the wrong issuer or an expired lifetime', async () => {
    const wrongIssuer = await accessFixture({ issuer: 'https://other-team.cloudflareaccess.com' })
    const wrongIssuerResponse = await dispatch('/api/session', {
      headers: { 'cf-access-jwt-assertion': wrongIssuer.token }
    }, wrongIssuer.accessEnv)
    expect(wrongIssuerResponse.status).toBe(401)

    const now = Math.floor(Date.now() / 1000)
    const expired = await accessFixture({ issuedAt: now - 600, expirationTime: now - 60 })
    const expiredResponse = await dispatch('/api/session', {
      headers: { 'cf-access-jwt-assertion': expired.token }
    }, expired.accessEnv)
    expect(expiredResponse.status).toBe(401)
    expect(await expiredResponse.json()).toMatchObject({ authenticated: false, code: 'authentication-required' })
  })

  it('binds a protected pre-onboarded identity to one active owner workspace', async () => {
    const fixture = await accessFixture({ autoProvision: false })
    const seeded = await seedAccessOwner(fixture.email)
    const response = await dispatch('/api/session', {
      headers: { 'cf-access-jwt-assertion': fixture.token }
    }, fixture.accessEnv)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      authenticated: true,
      user: { accountStatus: 'active', accountType: 'beta' },
      currentWorkspace: { role: 'owner', accessStatus: 'active', availableOutputs: 6, reservedOutputs: 0 }
    })
    const stored = await env.DB.prepare('SELECT access_subject_hash AS subjectHash FROM users WHERE id = ?')
      .bind(seeded.userId)
      .first<{ subjectHash: string | null }>()
    expect(stored?.subjectHash).toBeTruthy()
    expect(stored?.subjectHash).not.toBe(fixture.subject)
  })

  it('denies a bound identity when its account or workspace is disabled', async () => {
    const accountFixture = await accessFixture({ autoProvision: false })
    await seedAccessOwner(accountFixture.email)
    expect((await dispatch('/api/session', {
      headers: { 'cf-access-jwt-assertion': accountFixture.token }
    }, accountFixture.accessEnv)).status).toBe(200)
    await env.DB.prepare("UPDATE users SET account_status = 'suspended' WHERE email = ?").bind(accountFixture.email).run()
    const disabledAccount = await dispatch('/api/session', {
      headers: { 'cf-access-jwt-assertion': accountFixture.token }
    }, accountFixture.accessEnv)
    expect(disabledAccount.status).toBe(403)

    const workspaceFixture = await accessFixture({ autoProvision: false })
    const workspace = await seedAccessOwner(workspaceFixture.email)
    expect((await dispatch('/api/session', {
      headers: { 'cf-access-jwt-assertion': workspaceFixture.token }
    }, workspaceFixture.accessEnv)).status).toBe(200)
    await env.DB.prepare("UPDATE workspaces SET access_status = 'suspended' WHERE id = ?").bind(workspace.workspaceId).run()
    const disabledWorkspace = await dispatch('/api/session', {
      headers: { 'cf-access-jwt-assertion': workspaceFixture.token }
    }, workspaceFixture.accessEnv)
    expect(disabledWorkspace.status).toBe(403)
  })

  it('keeps every protected operation fixed to the selected owner workspace', async () => {
    const fixture = await accessFixture({ autoProvision: false })
    const owner = await seedAccessOwner(fixture.email)
    expect((await dispatch('/api/session', {
      headers: { 'cf-access-jwt-assertion': fixture.token }
    }, fixture.accessEnv)).status).toBe(200)

    const otherUserId = crypto.randomUUID()
    const otherWorkspaceId = crypto.randomUUID()
    const generationId = crypto.randomUUID()
    const outputKey = `workspaces/${otherWorkspaceId}/generations/${generationId}.svg`
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, name, password_hash, password_salt)
        VALUES (?, ?, 'Other Owner', 'disabled', 'disabled')
      `).bind(otherUserId, `other-${crypto.randomUUID()}@example.test`),
      env.DB.prepare(`
        INSERT INTO workspaces (id, owner_user_id, name, plan_status, access_status)
        VALUES (?, ?, 'Other Workspace', 'active', 'active')
      `).bind(otherWorkspaceId, otherUserId),
      env.DB.prepare('INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (?, ?, ?)').bind(otherWorkspaceId, owner.userId, 'member'),
      env.DB.prepare('INSERT INTO output_allowances (workspace_id, available, reserved) VALUES (?, 1, 0)').bind(otherWorkspaceId),
      env.DB.prepare(`
        INSERT INTO generations (id, workspace_id, workflow_id, aspect_ratio, status, output_cost, credit_cost, input_json, output_key, output_content_type)
        VALUES (?, ?, 'store-main', '1:1', 'completed', 1, 1, '{}', ?, 'image/svg+xml')
      `).bind(generationId, otherWorkspaceId, outputKey)
    ])
    await env.MEDIA_BUCKET.put(outputKey, '<svg xmlns="http://www.w3.org/2000/svg"/>', { httpMetadata: { contentType: 'image/svg+xml' } })

    const headers = { 'cf-access-jwt-assertion': fixture.token }
    const list = await dispatch(`/api/generations?workspaceId=${otherWorkspaceId}`, { headers }, fixture.accessEnv)
    expect(list.status).toBe(404)
    const image = await dispatch(`/api/generations/${generationId}/image`, { headers }, fixture.accessEnv)
    expect(image.status).toBe(404)
  })

  it('returns the Access logout endpoint without creating a password session', async () => {
    const fixture = await accessFixture({ autoProvision: false })
    const response = await dispatch('/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://app.test', 'cf-access-jwt-assertion': fixture.token }
    }, fixture.accessEnv)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, logoutUrl: '/cdn-cgi/access/logout' })
    expect(response.headers.get('set-cookie')).toBeNull()
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
