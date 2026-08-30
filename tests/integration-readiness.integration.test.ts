import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { Env } from '../src/worker'
import { dispatch, registerAccount } from './helpers'

function readinessEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...env,
    AUTH_MODE: 'password',
    REGISTRATION_MODE: 'open',
    GENERATION_MODE: 'disabled',
    AGENT_MODE: 'deterministic',
    ASSISTED_PROVIDER: 'disabled',
    ASSISTED_DATA_POLICY: 'disabled',
    ASSISTED_EVALUATION: 'disabled',
    ASSISTED_BUDGET_MODE: 'disabled',
    OPENAI_API_KEY: undefined,
    MAX_ACTIVE_GENERATIONS_PER_WORKSPACE: '3',
    ...overrides
  }
}

describe('integration readiness management API', () => {
  it('returns an exact provider-neutral disabled snapshot without private identity', async () => {
    const owner = await registerAccount('Readiness Owner')
    const response = await dispatch('/api/integration-readiness', {
      headers: { cookie: owner.cookie }
    }, readinessEnv())

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const raw = await response.text()
    expect(JSON.parse(raw)).toEqual({
      contractVersion: 'integration-readiness-v1',
      access: { authMode: 'password', registrationMode: 'open' },
      generation: {
        requestedMode: 'disabled',
        effectiveMode: 'disabled',
        enabled: false,
        maxActivePerWorkspace: 3
      },
      agent: { requestedMode: 'deterministic', effectiveMode: 'deterministic' },
      assisted: {
        requested: false,
        executionApproved: false,
        gates: {
          providerAllowlisted: false,
          dataPolicyApproved: false,
          evaluationApproved: false,
          budgetApproved: false,
          credentialConfigured: false
        }
      },
      payment: {
        enabled: false,
        checkoutAvailable: false,
        subscriptionAvailable: false,
        approvalRequired: true
      }
    })
    expect(raw).not.toContain(owner.user.id)
    expect(raw).not.toContain(owner.currentWorkspace.id)
    expect(raw).not.toContain(owner.user.email)
  })

  it('reports each assisted approval gate without returning provider or secret identity', async () => {
    const owner = await registerAccount('Readiness Assisted Owner')
    const response = await dispatch('/api/integration-readiness', {
      headers: { cookie: owner.cookie }
    }, readinessEnv({
      GENERATION_MODE: 'assisted',
      AGENT_MODE: 'assisted',
      ASSISTED_PROVIDER: 'openai',
      ASSISTED_DATA_POLICY: 'approved',
      ASSISTED_EVALUATION: 'approved',
      ASSISTED_BUDGET_MODE: 'approved',
      OPENAI_API_KEY: 'test-key',
      MAX_ACTIVE_GENERATIONS_PER_WORKSPACE: '6'
    }))

    expect(response.status).toBe(200)
    const raw = await response.text()
    expect(JSON.parse(raw)).toMatchObject({
      access: { authMode: 'password', registrationMode: 'open' },
      generation: { requestedMode: 'assisted', effectiveMode: 'assisted', enabled: true, maxActivePerWorkspace: 6 },
      agent: { requestedMode: 'assisted', effectiveMode: 'assisted' },
      assisted: {
        requested: true,
        executionApproved: true,
        gates: {
          providerAllowlisted: true,
          dataPolicyApproved: true,
          evaluationApproved: true,
          budgetApproved: true,
          credentialConfigured: true
        }
      }
    })
    expect(raw).not.toContain('test-key')
    expect(raw).not.toContain('openai')
    expect(raw).not.toContain('OPENAI_API_KEY')
  })

  it('shows requested assisted mode as ineffective until every independent gate passes', async () => {
    const owner = await registerAccount('Readiness Incomplete Owner')
    const response = await dispatch('/api/integration-readiness', {
      headers: { cookie: owner.cookie }
    }, readinessEnv({
      GENERATION_MODE: 'assisted',
      AGENT_MODE: 'assisted',
      ASSISTED_PROVIDER: 'openai',
      ASSISTED_DATA_POLICY: 'approved',
      ASSISTED_EVALUATION: 'disabled',
      ASSISTED_BUDGET_MODE: 'approved',
      OPENAI_API_KEY: 'test-key'
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      generation: { requestedMode: 'assisted', effectiveMode: 'disabled', enabled: false },
      agent: { requestedMode: 'assisted', effectiveMode: 'deterministic' },
      assisted: {
        requested: true,
        executionApproved: false,
        gates: { evaluationApproved: false }
      }
    })
  })

  it('is manager-only and rejects unauthenticated or unsupported requests', async () => {
    expect((await dispatch('/api/integration-readiness')).status).toBe(401)

    const account = await registerAccount('Readiness Role Boundary')
    await env.DB.prepare(`
      UPDATE workspace_memberships SET role = 'member'
      WHERE workspace_id = ? AND user_id = ?
    `).bind(account.currentWorkspace.id, account.user.id).run()
    expect((await dispatch('/api/integration-readiness', {
      headers: { cookie: account.cookie }
    }, readinessEnv())).status).toBe(403)

    const owner = await registerAccount('Readiness Method Boundary')
    const unsupported = await dispatch('/api/integration-readiness', {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    }, readinessEnv())
    expect(unsupported.status).toBe(405)
    expect(unsupported.headers.get('allow')).toBe('GET')
  })
})
