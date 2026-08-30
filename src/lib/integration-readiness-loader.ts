import { readBoundedJsonResponse } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import type { IntegrationReadinessSnapshot } from './types'

export const integrationReadinessUnavailableMessage = '整合就緒度暫時無法讀取。 Integration readiness is temporarily unavailable.'

const MAX_INTEGRATION_READINESS_BYTES = 16 * 1024
const INTEGRATION_READINESS_TIMEOUT_MS = 15_000
const responseKeys = new Set(['contractVersion', 'access', 'generation', 'agent', 'assisted', 'payment'])
const accessKeys = new Set(['authMode', 'registrationMode'])
const generationKeys = new Set(['requestedMode', 'effectiveMode', 'enabled', 'maxActivePerWorkspace'])
const agentKeys = new Set(['requestedMode', 'effectiveMode'])
const assistedKeys = new Set(['requested', 'executionApproved', 'gates'])
const assistedGateKeys = new Set(['providerAllowlisted', 'dataPolicyApproved', 'evaluationApproved', 'budgetApproved', 'credentialConfigured'])
const paymentKeys = new Set(['enabled', 'checkoutAvailable', 'subscriptionAvailable', 'approvalRequired'])
const generationModes = new Set(['disabled', 'deterministic', 'assisted'])
const agentModes = new Set(['deterministic', 'assisted'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actual = Object.keys(value)
  return actual.length === keys.size && actual.every((key) => keys.has(key))
}

export function normalizeIntegrationReadiness(value: unknown): IntegrationReadinessSnapshot {
  if (!isRecord(value)
    || !hasExactKeys(value, responseKeys)
    || value.contractVersion !== 'integration-readiness-v1'
    || !isRecord(value.access)
    || !hasExactKeys(value.access, accessKeys)
    || (value.access.authMode !== 'access' && value.access.authMode !== 'password')
    || (value.access.registrationMode !== 'open' && value.access.registrationMode !== 'invite' && value.access.registrationMode !== 'closed')
    || (value.access.authMode === 'access' && value.access.registrationMode !== 'closed')
    || !isRecord(value.generation)
    || !hasExactKeys(value.generation, generationKeys)
    || !generationModes.has(String(value.generation.requestedMode))
    || !generationModes.has(String(value.generation.effectiveMode))
    || typeof value.generation.enabled !== 'boolean'
    || !Number.isSafeInteger(value.generation.maxActivePerWorkspace)
    || Number(value.generation.maxActivePerWorkspace) < 1
    || Number(value.generation.maxActivePerWorkspace) > 12
    || !isRecord(value.agent)
    || !hasExactKeys(value.agent, agentKeys)
    || !agentModes.has(String(value.agent.requestedMode))
    || !agentModes.has(String(value.agent.effectiveMode))
    || !isRecord(value.assisted)
    || !hasExactKeys(value.assisted, assistedKeys)
    || typeof value.assisted.requested !== 'boolean'
    || typeof value.assisted.executionApproved !== 'boolean'
    || !isRecord(value.assisted.gates)
    || !hasExactKeys(value.assisted.gates, assistedGateKeys)
    || !Object.values(value.assisted.gates).every((gate) => typeof gate === 'boolean')
    || !isRecord(value.payment)
    || !hasExactKeys(value.payment, paymentKeys)
    || value.payment.enabled !== false
    || value.payment.checkoutAvailable !== false
    || value.payment.subscriptionAvailable !== false
    || value.payment.approvalRequired !== true) throw new Error(integrationReadinessUnavailableMessage)

  const requestedGeneration = value.generation.requestedMode as IntegrationReadinessSnapshot['generation']['requestedMode']
  const effectiveGeneration = value.generation.effectiveMode as IntegrationReadinessSnapshot['generation']['effectiveMode']
  const requestedAgent = value.agent.requestedMode as IntegrationReadinessSnapshot['agent']['requestedMode']
  const effectiveAgent = value.agent.effectiveMode as IntegrationReadinessSnapshot['agent']['effectiveMode']
  const gates: IntegrationReadinessSnapshot['assisted']['gates'] = {
    providerAllowlisted: value.assisted.gates.providerAllowlisted as boolean,
    dataPolicyApproved: value.assisted.gates.dataPolicyApproved as boolean,
    evaluationApproved: value.assisted.gates.evaluationApproved as boolean,
    budgetApproved: value.assisted.gates.budgetApproved as boolean,
    credentialConfigured: value.assisted.gates.credentialConfigured as boolean
  }
  const allAssistedGatesReady = Object.values(gates).every(Boolean)
  const executionApproved = requestedGeneration === 'assisted' && allAssistedGatesReady
  const expectedGeneration = requestedGeneration === 'deterministic'
    ? 'deterministic'
    : executionApproved ? 'assisted' : 'disabled'
  const expectedAgent = requestedAgent === 'assisted' && executionApproved ? 'assisted' : 'deterministic'
  if (effectiveGeneration !== expectedGeneration
    || value.generation.enabled !== (effectiveGeneration !== 'disabled')
    || effectiveAgent !== expectedAgent
    || value.assisted.requested !== (requestedGeneration === 'assisted' || requestedAgent === 'assisted')
    || value.assisted.executionApproved !== executionApproved) throw new Error(integrationReadinessUnavailableMessage)

  return {
    contractVersion: 'integration-readiness-v1',
    access: {
      authMode: value.access.authMode,
      registrationMode: value.access.registrationMode
    },
    generation: {
      requestedMode: requestedGeneration,
      effectiveMode: effectiveGeneration,
      enabled: value.generation.enabled,
      maxActivePerWorkspace: value.generation.maxActivePerWorkspace as number
    },
    agent: { requestedMode: requestedAgent, effectiveMode: effectiveAgent },
    assisted: {
      requested: value.assisted.requested,
      executionApproved: value.assisted.executionApproved,
      gates
    },
    payment: {
      enabled: false,
      checkoutAvailable: false,
      subscriptionAvailable: false,
      approvalRequired: true
    }
  }
}

export async function loadIntegrationReadiness() {
  try {
    return await fetchWithTimeout(
      '/api/integration-readiness',
      { credentials: 'same-origin' },
      INTEGRATION_READINESS_TIMEOUT_MS,
      async (response) => {
        if (!response.ok || response.status !== 200) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(integrationReadinessUnavailableMessage)
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (contentType !== 'application/json') {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(integrationReadinessUnavailableMessage)
        }
        const data = await readBoundedJsonResponse(response, MAX_INTEGRATION_READINESS_BYTES)
        return normalizeIntegrationReadiness(data)
      }
    )
  } catch {
    throw new Error(integrationReadinessUnavailableMessage)
  }
}

export async function loadIntegrationReadinessSnapshot(): Promise<{
  readiness: IntegrationReadinessSnapshot | null
  error: string | null
}> {
  try {
    return { readiness: await loadIntegrationReadiness(), error: null }
  } catch (error) {
    return {
      readiness: null,
      error: error instanceof Error ? error.message : integrationReadinessUnavailableMessage
    }
  }
}
