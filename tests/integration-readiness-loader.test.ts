import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  integrationReadinessUnavailableMessage,
  loadIntegrationReadiness,
  loadIntegrationReadinessSnapshot,
  normalizeIntegrationReadiness
} from '../src/lib/integration-readiness-loader'

const canonicalReadiness = {
  contractVersion: 'integration-readiness-v1',
  access: { authMode: 'access', registrationMode: 'closed' },
  generation: { requestedMode: 'deterministic', effectiveMode: 'deterministic', enabled: true, maxActivePerWorkspace: 3 },
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
  payment: { enabled: false, checkoutAvailable: false, subscriptionAvailable: false, approvalRequired: true }
} as const

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('integration readiness browser loader', () => {
  it('accepts an exact internally consistent snapshot', () => {
    expect(normalizeIntegrationReadiness(canonicalReadiness)).toEqual(canonicalReadiness)
  })

  it('rejects expanded, contradictory, or enabled-payment payloads', () => {
    const cases = [
      { ...canonicalReadiness, deploymentId: 'private-deployment' },
      { ...canonicalReadiness, generation: { ...canonicalReadiness.generation, enabled: false } },
      { ...canonicalReadiness, assisted: { ...canonicalReadiness.assisted, executionApproved: true } },
      { ...canonicalReadiness, payment: { ...canonicalReadiness.payment, enabled: true } }
    ]
    cases.forEach((value) => expect(() => normalizeIntegrationReadiness(value)).toThrow(integrationReadinessUnavailableMessage))
  })

  it('requires exact 200 JSON and keeps server detail out of the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: 'synthetic private provider configuration'
    }, { status: 503 })))
    await expect(loadIntegrationReadiness()).rejects.toThrow(integrationReadinessUnavailableMessage)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(canonicalReadiness), {
      status: 201,
      headers: { 'content-type': 'application/json' }
    })))
    await expect(loadIntegrationReadiness()).rejects.toThrow(integrationReadinessUnavailableMessage)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(canonicalReadiness), {
      headers: { 'content-type': 'text/plain' }
    })))
    await expect(loadIntegrationReadiness()).rejects.toThrow(integrationReadinessUnavailableMessage)
  })

  it('rejects an oversized streamed success body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `${' '.repeat(16 * 1024)}${JSON.stringify(canonicalReadiness)}`,
      { headers: { 'content-type': 'application/json' } }
    )))
    await expect(loadIntegrationReadiness()).rejects.toThrow(integrationReadinessUnavailableMessage)
  })

  it('returns no authoritative replacement when refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('synthetic network detail') }))
    await expect(loadIntegrationReadinessSnapshot()).resolves.toEqual({
      readiness: null,
      error: integrationReadinessUnavailableMessage
    })
  })
})
