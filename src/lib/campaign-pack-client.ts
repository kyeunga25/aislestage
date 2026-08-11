import { sanitizeCampaignBrief, validateCampaignBrief } from './campaign-agent'
import { readBoundedJsonResponseOutcome } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import { normalizeGenerationResults } from './generation-loader'
import type { AspectRatio, BrandPack, GenerationResult, Product, WorkflowId } from './types'
import { workflows } from './workflows'

export type CampaignPackClientRequest = {
  idempotencyKey: string
  workspaceId: string
  approvedRevision: number
  intent: string
  brand: BrandPack
  product: Product
  referenceAssetIds: string[]
  outputs: Array<{ workflowId: WorkflowId; aspectRatio: AspectRatio }>
}

export type CampaignPackClientResult = {
  campaignPackId: string
  generations: GenerationResult[]
  replayed: boolean
}

export const campaignPackRequestInvalidMessage = 'Campaign Pack 請求格式無效，請重新核對已批准計劃。 Campaign Pack request is invalid; review the approved plan.'
export const campaignPackResponseInvalidMessage = '未能確認 Campaign Pack 建立結果。 Unable to verify the Campaign Pack creation.'
export const campaignPackUnavailableMessage = 'Campaign Pack 建立暫時無法使用。 Campaign Pack creation is temporarily unavailable.'

const MAX_CAMPAIGN_PACK_BODY_BYTES = 32_768
const MAX_CAMPAIGN_PACK_RESPONSE_BYTES = 64 * 1024
const CAMPAIGN_PACK_TIMEOUT_MS = 30_000
const CAMPAIGN_PACK_ATTEMPTS = 2
const requestKeys = new Set(['idempotencyKey', 'workspaceId', 'approvedRevision', 'intent', 'brand', 'product', 'referenceAssetIds', 'outputs'])
const outputKeys = new Set(['workflowId', 'aspectRatio'])
const createdResponseKeys = new Set(['campaignPackId', 'generations', 'reservedOutputs'])
const replayResponseKeys = new Set(['campaignPackId', 'generations', 'replayed'])
const idempotencyKeyPattern = /^[a-z0-9_-]{16,100}$/i
const resourceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

class CampaignPackAttemptError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'CampaignPackAttemptError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.size && actualKeys.every((key) => keys.has(key))
}

function canonicalRequest(value: CampaignPackClientRequest) {
  if (!isRecord(value) || !hasExactKeys(value, requestKeys)
    || typeof value.idempotencyKey !== 'string' || !idempotencyKeyPattern.test(value.idempotencyKey)
    || typeof value.workspaceId !== 'string' || value.workspaceId.length > 64 || !resourceIdPattern.test(value.workspaceId)
    || !Number.isSafeInteger(value.approvedRevision) || value.approvedRevision <= 0
    || !Array.isArray(value.referenceAssetIds) || value.referenceAssetIds.length !== 1
    || !resourceIdPattern.test(value.referenceAssetIds[0] || '')
    || !Array.isArray(value.outputs) || value.outputs.length !== 3) return null

  const outputs: Array<{ workflowId: WorkflowId; aspectRatio: AspectRatio }> = []
  for (const output of value.outputs) {
    if (!isRecord(output) || !hasExactKeys(output, outputKeys)) return null
    const workflow = workflows.find((candidate) => candidate.id === output.workflowId)
    if (!workflow || !workflow.ratios.includes(output.aspectRatio as AspectRatio)) return null
    outputs.push({ workflowId: workflow.id, aspectRatio: output.aspectRatio as AspectRatio })
  }
  const identities = outputs.map((output) => `${output.workflowId}:${output.aspectRatio}`)
  if (new Set(identities).size !== outputs.length) return null

  const suppliedBrief = {
    assetId: value.referenceAssetIds[0],
    intent: value.intent,
    brand: value.brand,
    product: value.product
  }
  if (validateCampaignBrief(suppliedBrief).length) return null
  const brief = sanitizeCampaignBrief(suppliedBrief)
  const orderedSuppliedBrief = {
    assetId: suppliedBrief.assetId,
    intent: suppliedBrief.intent,
    brand: {
      name: value.brand?.name,
      tone: value.brand?.tone,
      colors: value.brand?.colors,
      forbiddenWords: value.brand?.forbiddenWords,
      locale: value.brand?.locale,
      cta: value.brand?.cta,
      ctaEn: value.brand?.ctaEn
    },
    product: {
      name: value.product?.name,
      nameEn: value.product?.nameEn,
      category: value.product?.category,
      benefits: value.product?.benefits,
      benefitsEn: value.product?.benefitsEn,
      specifications: value.product?.specifications,
      price: value.product?.price,
      promotion: value.product?.promotion,
      promotionEn: value.product?.promotionEn,
      channels: value.product?.channels
    }
  }
  if (JSON.stringify(brief) !== JSON.stringify(orderedSuppliedBrief)) return null

  const request: CampaignPackClientRequest = {
    idempotencyKey: value.idempotencyKey,
    workspaceId: value.workspaceId,
    approvedRevision: value.approvedRevision,
    intent: brief.intent,
    brand: brief.brand,
    product: brief.product,
    referenceAssetIds: [brief.assetId!],
    outputs
  }
  const body = JSON.stringify(request)
  if (new TextEncoder().encode(body).byteLength > MAX_CAMPAIGN_PACK_BODY_BYTES) return null
  return { request, body }
}

function packFailureMessage(status: number) {
  if (status === 400 || status === 413 || status === 415 || status === 422) return campaignPackRequestInvalidMessage
  if (status === 401 || status === 403) return '工作區授權已改變，請重新登入。 Workspace authorization changed; please sign in again.'
  if (status === 404) return '工作區或商品圖片狀態已改變，請重新載入。 Workspace or product image state changed; reload it.'
  if (status === 409) return '已批准計劃或可用輸出數已改變，請重新核對。 The approved plan or available output count changed; review it again.'
  if (status === 429) return '目前已有太多輸出處理中，請稍後再試。 Too many outputs are currently processing; try again later.'
  return campaignPackUnavailableMessage
}

function normalizePackResponse(data: unknown, status: 200 | 202, request: CampaignPackClientRequest): CampaignPackClientResult | null {
  if (!isRecord(data)) return null
  const replayed = status === 200
  if (replayed) {
    if (!hasExactKeys(data, replayResponseKeys) || data.replayed !== true) return null
  } else if (!hasExactKeys(data, createdResponseKeys)
    || data.reservedOutputs !== request.outputs.length
    || !Number.isSafeInteger(data.reservedOutputs)) return null
  if (typeof data.campaignPackId !== 'string' || !uuidV4.test(data.campaignPackId)) return null

  let generations: GenerationResult[]
  try {
    generations = normalizeGenerationResults(data.generations)
  } catch {
    return null
  }
  if (generations.length !== request.outputs.length
    || generations.some((generation) => !uuidV4.test(generation.id)
      || generation.campaignPackId !== data.campaignPackId
      || generation.approvedRevision !== request.approvedRevision)) return null
  const expectedOutputs = request.outputs.map((output) => `${output.workflowId}:${output.aspectRatio}`).sort()
  const actualOutputs = generations.map((generation) => `${generation.workflowId}:${generation.aspectRatio}`).sort()
  if (JSON.stringify(actualOutputs) !== JSON.stringify(expectedOutputs)) return null
  return { campaignPackId: data.campaignPackId, generations, replayed }
}

async function createCampaignPackAttempt(canonical: NonNullable<ReturnType<typeof canonicalRequest>>) {
  return fetchWithTimeout(
    '/api/campaign-packs',
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: canonical.body
    },
    CAMPAIGN_PACK_TIMEOUT_MS,
    async (response, signal) => {
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new CampaignPackAttemptError(
          packFailureMessage(response.status),
          response.status === 408 || response.status >= 500
        )
      }
      if (response.status !== 200 && response.status !== 202) {
        await response.body?.cancel().catch(() => undefined)
        throw new CampaignPackAttemptError(campaignPackResponseInvalidMessage, false)
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        await response.body?.cancel().catch(() => undefined)
        throw new CampaignPackAttemptError(campaignPackResponseInvalidMessage, false)
      }
      const outcome = await readBoundedJsonResponseOutcome(response, MAX_CAMPAIGN_PACK_RESPONSE_BYTES)
      if (signal.aborted || outcome.kind === 'stream-error') {
        throw new CampaignPackAttemptError(campaignPackUnavailableMessage, true)
      }
      const data = outcome.kind === 'value' ? outcome.value : null
      const pack = normalizePackResponse(data, response.status, canonical.request)
      if (!pack) throw new CampaignPackAttemptError(campaignPackResponseInvalidMessage, false)
      return pack
    }
  )
}

export async function createCampaignPack(value: CampaignPackClientRequest): Promise<CampaignPackClientResult> {
  const canonical = canonicalRequest(value)
  if (!canonical) throw new Error(campaignPackRequestInvalidMessage)

  for (let attempt = 0; attempt < CAMPAIGN_PACK_ATTEMPTS; attempt += 1) {
    try {
      return await createCampaignPackAttempt(canonical)
    } catch (error) {
      const retryable = !(error instanceof CampaignPackAttemptError) || error.retryable
      if (retryable && attempt + 1 < CAMPAIGN_PACK_ATTEMPTS) continue
      if (error instanceof CampaignPackAttemptError) throw new Error(error.message)
      throw new Error(campaignPackUnavailableMessage)
    }
  }
  throw new Error(campaignPackUnavailableMessage)
}
