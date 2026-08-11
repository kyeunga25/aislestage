import { readBoundedJsonResponseOutcome } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import { normalizeGenerationResults } from './generation-loader'
import type { GenerationResult } from './types'

export const generationReviewSourceInvalidMessage = '輸出缺少可核對的批准版本，請重新載入。 The output is missing a verifiable approved revision; reload it.'
export const generationReviewResponseInvalidMessage = '未能確認輸出審核結果。 Unable to verify the output review.'
export const generationReviewUnavailableMessage = '輸出審核暫時無法使用。 Output review is temporarily unavailable.'

const responseKeys = new Set(['generation', 'replayed'])
const MAX_GENERATION_REVIEW_RESPONSE_BYTES = 16 * 1024
const GENERATION_REVIEW_TIMEOUT_MS = 15_000
const GENERATION_REVIEW_ATTEMPTS = 2

class GenerationReviewAttemptError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'GenerationReviewAttemptError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.size && actualKeys.every((key) => keys.has(key))
}

function normalizeCurrentGeneration(result: GenerationResult) {
  const { title, ...payload } = result
  void title
  try {
    const normalized = normalizeGenerationResults([payload])[0]
    if (!normalized
      || normalized.status !== 'completed'
      || normalized.reviewStatus !== 'draft'
      || normalized.reviewedAt !== null
      || normalized.downloadUrl !== null
      || !Number.isSafeInteger(normalized.approvedRevision)
      || Number(normalized.approvedRevision) <= 0) return null
    return normalized
  } catch {
    return null
  }
}

function reviewFailureMessage(status: number) {
  if (status === 400 || status === 413 || status === 415) {
    return '輸出審核請求無效，請重新載入。 The output review request is invalid; reload it.'
  }
  if (status === 403) return '只有 workspace owner 或 admin 可以審核輸出。 Only a workspace owner or admin can review outputs.'
  if (status === 404) return '找不到這個私人輸出，請重新載入。 This private output was not found; reload it.'
  if (status === 409) return '輸出版本或審核狀態已改變，請重新載入。 The output revision or review state changed; reload it.'
  return generationReviewUnavailableMessage
}

function isSameGeneration(current: GenerationResult, reviewed: GenerationResult) {
  return reviewed.id === current.id
    && reviewed.campaignPackId === current.campaignPackId
    && reviewed.workflowId === current.workflowId
    && reviewed.aspectRatio === current.aspectRatio
    && reviewed.status === current.status
    && reviewed.contentType === current.contentType
    && reviewed.approvedRevision === current.approvedRevision
    && reviewed.errorMessage === current.errorMessage
    && reviewed.createdAt === current.createdAt
    && reviewed.imageUrl === current.imageUrl
    && reviewed.provenance?.approvedRevision === current.provenance?.approvedRevision
    && reviewed.provenance?.compositionVersion === current.provenance?.compositionVersion
    && reviewed.provenance?.generationMode === current.provenance?.generationMode
}

async function submitGenerationReviewAttempt(
  current: GenerationResult,
  decision: 'approve' | 'reject',
  body: string
) {
  return fetchWithTimeout(
    `/api/generations/${encodeURIComponent(current.id)}/review`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body
    },
    GENERATION_REVIEW_TIMEOUT_MS,
    async (response, signal) => {
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new GenerationReviewAttemptError(
          reviewFailureMessage(response.status),
          response.status === 408 || response.status >= 500
        )
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined)
        throw new GenerationReviewAttemptError(generationReviewResponseInvalidMessage, false)
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        await response.body?.cancel().catch(() => undefined)
        throw new GenerationReviewAttemptError(generationReviewResponseInvalidMessage, false)
      }
      const outcome = await readBoundedJsonResponseOutcome(response, MAX_GENERATION_REVIEW_RESPONSE_BYTES)
      if (signal.aborted || outcome.kind === 'stream-error') {
        throw new GenerationReviewAttemptError(generationReviewUnavailableMessage, true)
      }
      const data = outcome.kind === 'value' ? outcome.value : null
      if (!isRecord(data)
        || !hasExactKeys(data, responseKeys)
        || typeof data.replayed !== 'boolean') {
        throw new GenerationReviewAttemptError(generationReviewResponseInvalidMessage, false)
      }

      let reviewed: GenerationResult
      try {
        const normalized = normalizeGenerationResults([data.generation])
        if (normalized.length !== 1) throw new TypeError('Invalid generation review response')
        reviewed = normalized[0]!
      } catch {
        throw new GenerationReviewAttemptError(generationReviewResponseInvalidMessage, false)
      }
      const targetStatus = decision === 'approve' ? 'approved' : 'rejected'
      if (!isSameGeneration(current, reviewed) || reviewed.reviewStatus !== targetStatus) {
        throw new GenerationReviewAttemptError(generationReviewResponseInvalidMessage, false)
      }
      return reviewed
    }
  )
}

export async function submitGenerationReview(result: GenerationResult, decision: 'approve' | 'reject') {
  const current = normalizeCurrentGeneration(result)
  if (!current || (decision !== 'approve' && decision !== 'reject')) {
    throw new Error(generationReviewSourceInvalidMessage)
  }
  const body = JSON.stringify({ decision, expectedApprovedRevision: current.approvedRevision })

  for (let attempt = 0; attempt < GENERATION_REVIEW_ATTEMPTS; attempt += 1) {
    try {
      return await submitGenerationReviewAttempt(current, decision, body)
    } catch (error) {
      const retryable = !(error instanceof GenerationReviewAttemptError) || error.retryable
      if (retryable && attempt + 1 < GENERATION_REVIEW_ATTEMPTS) continue
      if (error instanceof GenerationReviewAttemptError) throw new Error(error.message)
      throw new Error(generationReviewUnavailableMessage)
    }
  }
  throw new Error(generationReviewUnavailableMessage)
}
