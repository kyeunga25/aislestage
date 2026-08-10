import { sanitizeCampaignBrief, validateCampaignBrief } from './campaign-agent'
import { normalizeCampaignAgentState } from './campaign-agent-loader'
import { readBoundedJsonResponse } from './bounded-json-response'
import type { CampaignAgentState, CampaignBrief } from './types'

export type CampaignAgentActionRequest =
  | { action: 'plan'; brief: CampaignBrief }
  | { action: 'approve'; revision: number }

export const campaignAgentRequestInvalidMessage = 'Campaign Agent 請求格式無效。 Campaign Agent request is invalid.'
export const campaignAgentActionUnavailableMessage = 'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'

const MAX_AGENT_CLIENT_BODY_BYTES = 40 * 1024
const MAX_AGENT_ACTION_RESPONSE_BYTES = 256 * 1024
const planResponseKeys = new Set(['state'])
const approvalResponseKeys = new Set(['state', 'replayed'])

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
  if (request.action === 'plan') {
    if (validateCampaignBrief(request.brief).length) throw new Error(campaignAgentRequestInvalidMessage)
    expectedBrief = sanitizeCampaignBrief(request.brief)
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
  return { body: serialized, expectedBrief }
}

function actionFailureMessage(status: number) {
  if (status === 400 || status === 413 || status === 415 || status === 422) return campaignAgentRequestInvalidMessage
  if (status === 404) return '商品圖片狀態已變更，請重新核對。 Product image state changed; please review it again.'
  if (status === 409) return '計劃已更新，請核對最新版本後再批准。 The plan changed; review the latest revision before approving.'
  return campaignAgentActionUnavailableMessage
}

function canonicalPlanResponse(data: unknown, expectedBrief: CampaignBrief) {
  if (!isRecord(data) || !hasExactKeys(data, planResponseKeys)) return null
  const state = normalizeCampaignAgentState(data.state)
  if (!state
    || (state.stage !== 'needs-input' && state.stage !== 'awaiting-approval')
    || state.revision <= 0
    || state.approvedAt !== null
    || !state.brief
    || JSON.stringify(state.brief) !== JSON.stringify(expectedBrief)) return null
  return state
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

export async function submitCampaignAgentAction(request: CampaignAgentActionRequest): Promise<CampaignAgentState> {
  const { body, expectedBrief } = serializeAgentRequest(request)
  let response: Response
  try {
    response = await fetch(`/api/campaign-agent/${request.action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body
    })
  } catch {
    throw new Error(campaignAgentActionUnavailableMessage)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(actionFailureMessage(response.status))
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(campaignAgentActionUnavailableMessage)
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(campaignAgentActionUnavailableMessage)
  }
  const data = await readBoundedJsonResponse(response, MAX_AGENT_ACTION_RESPONSE_BYTES)
  const state = request.action === 'plan'
    ? expectedBrief && canonicalPlanResponse(data, expectedBrief)
    : canonicalApprovalResponse(data, request.revision)
  if (!state) throw new Error(campaignAgentActionUnavailableMessage)
  return state
}
