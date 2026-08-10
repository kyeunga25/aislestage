import { sanitizeCampaignBrief, validateCampaignBrief } from './campaign-agent'
import { loadCampaignAgentState, normalizeCampaignAgentState } from './campaign-agent-loader'
import { readBoundedJsonResponseOutcome } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import type { CampaignAgentState, CampaignBrief } from './types'

export type CampaignAgentActionRequest =
  | { action: 'plan'; brief: CampaignBrief; currentRevision: number }
  | { action: 'approve'; revision: number }

export const campaignAgentRequestInvalidMessage = 'Campaign Agent 請求格式無效。 Campaign Agent request is invalid.'
export const campaignAgentActionUnavailableMessage = 'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'

const MAX_AGENT_CLIENT_BODY_BYTES = 40 * 1024
const MAX_AGENT_ACTION_RESPONSE_BYTES = 256 * 1024
const CAMPAIGN_PLAN_TIMEOUT_MS = 40_000
const CAMPAIGN_APPROVAL_TIMEOUT_MS = 15_000
const CAMPAIGN_APPROVAL_ATTEMPTS = 2
const planResponseKeys = new Set(['state'])
const approvalResponseKeys = new Set(['state', 'replayed'])

class CampaignAgentAttemptError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'CampaignAgentAttemptError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.size && actualKeys.every((key) => keys.has(key))
}

function serializeAgentRequest(request: CampaignAgentActionRequest) {
  if (!request || typeof request !== 'object' || (request.action !== 'plan' && request.action !== 'approve')) {
    throw new Error(campaignAgentRequestInvalidMessage)
  }

  let body: { brief: CampaignBrief } | { revision: number }
  let expectedBrief: CampaignBrief | null = null
  let currentRevision: number | null = null
  if (request.action === 'plan') {
    if (!Number.isSafeInteger(request.currentRevision)
      || request.currentRevision < 0
      || validateCampaignBrief(request.brief).length) throw new Error(campaignAgentRequestInvalidMessage)
    expectedBrief = sanitizeCampaignBrief(request.brief)
    currentRevision = request.currentRevision
    body = { brief: expectedBrief }
  } else {
    if (!Number.isSafeInteger(request.revision) || request.revision <= 0) {
      throw new Error(campaignAgentRequestInvalidMessage)
    }
    body = { revision: request.revision }
  }

  const serialized = JSON.stringify(body)
  if (new TextEncoder().encode(serialized).byteLength > MAX_AGENT_CLIENT_BODY_BYTES) {
    throw new Error(campaignAgentRequestInvalidMessage)
  }
  return { body: serialized, expectedBrief, currentRevision }
}

function actionFailureMessage(status: number) {
  if (status === 400 || status === 413 || status === 415 || status === 422) return campaignAgentRequestInvalidMessage
  if (status === 404) return '商品圖片狀態已變更，請重新核對。 Product image state changed; please review it again.'
  if (status === 409) return '計劃已更新，請核對最新版本後再批准。 The plan changed; review the latest revision before approving.'
  return campaignAgentActionUnavailableMessage
}

function canonicalPlanState(value: unknown, expectedBrief: CampaignBrief, currentRevision: number) {
  const state = normalizeCampaignAgentState(value)
  if (!state
    || (state.stage !== 'needs-input' && state.stage !== 'awaiting-approval')
    || state.revision <= currentRevision
    || state.approvedAt !== null
    || !state.brief
    || JSON.stringify(state.brief) !== JSON.stringify(expectedBrief)) return null
  return state
}

function canonicalPlanResponse(data: unknown, expectedBrief: CampaignBrief, currentRevision: number) {
  if (!isRecord(data) || !hasExactKeys(data, planResponseKeys)) return null
  return canonicalPlanState(data.state, expectedBrief, currentRevision)
}

function canonicalApprovalResponse(data: unknown, revision: number) {
  if (!isRecord(data)
    || !hasExactKeys(data, approvalResponseKeys)
    || typeof data.replayed !== 'boolean') return null
  const state = normalizeCampaignAgentState(data.state)
  if (!state
    || state.stage !== 'approved'
    || state.revision !== revision
    || !state.approvedAt
    || !state.brief) return null
  return state
}

async function submitCampaignAgentAttempt(
  request: CampaignAgentActionRequest,
  body: string,
  expectedBrief: CampaignBrief | null,
  currentRevision: number | null
) {
  return fetchWithTimeout(
    `/api/campaign-agent/${request.action}`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body
    },
    request.action === 'plan' ? CAMPAIGN_PLAN_TIMEOUT_MS : CAMPAIGN_APPROVAL_TIMEOUT_MS,
    async (response, signal) => {
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new CampaignAgentAttemptError(
          actionFailureMessage(response.status),
          response.status === 408 || response.status >= 500
        )
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined)
        throw new CampaignAgentAttemptError(campaignAgentActionUnavailableMessage, false)
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        await response.body?.cancel().catch(() => undefined)
        throw new CampaignAgentAttemptError(campaignAgentActionUnavailableMessage, false)
      }
      const outcome = await readBoundedJsonResponseOutcome(response, MAX_AGENT_ACTION_RESPONSE_BYTES)
      if (signal.aborted || outcome.kind === 'stream-error') {
        throw new CampaignAgentAttemptError(campaignAgentActionUnavailableMessage, true)
      }
      const data = outcome.kind === 'value' ? outcome.value : null
      const state = request.action === 'plan'
        ? expectedBrief && currentRevision !== null && canonicalPlanResponse(data, expectedBrief, currentRevision)
        : request.action === 'approve' && canonicalApprovalResponse(data, request.revision)
      if (!state) throw new CampaignAgentAttemptError(campaignAgentActionUnavailableMessage, false)
      return state
    }
  )
}

export async function submitCampaignAgentAction(request: CampaignAgentActionRequest): Promise<CampaignAgentState> {
  const { body, expectedBrief, currentRevision } = serializeAgentRequest(request)

  if (request.action === 'plan') {
    try {
      return await submitCampaignAgentAttempt(request, body, expectedBrief, currentRevision)
    } catch (error) {
      const retryable = !(error instanceof CampaignAgentAttemptError) || error.retryable
      if (!retryable) {
        throw new Error(error instanceof CampaignAgentAttemptError ? error.message : campaignAgentActionUnavailableMessage)
      }
      try {
        const state = await loadCampaignAgentState()
        const reconciled = expectedBrief && currentRevision !== null
          ? canonicalPlanState(state, expectedBrief, currentRevision)
          : null
        if (reconciled) return reconciled
      } catch {
        // A failed bounded reconciliation must not trigger a second non-idempotent plan mutation.
      }
      throw new Error(campaignAgentActionUnavailableMessage)
    }
  }

  for (let attempt = 0; attempt < CAMPAIGN_APPROVAL_ATTEMPTS; attempt += 1) {
    try {
      return await submitCampaignAgentAttempt(request, body, expectedBrief, currentRevision)
    } catch (error) {
      const retryable = !(error instanceof CampaignAgentAttemptError) || error.retryable
      if (retryable && attempt + 1 < CAMPAIGN_APPROVAL_ATTEMPTS) continue
      throw new Error(error instanceof CampaignAgentAttemptError ? error.message : campaignAgentActionUnavailableMessage)
    }
  }
  throw new Error(campaignAgentActionUnavailableMessage)
}
