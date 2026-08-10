import type { GenerationResult } from './types'
import { workflowById } from './workflows'

export const generationListUnavailableMessage = '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'

const generationKeys = new Set([
  'id',
  'campaignPackId',
  'workflowId',
  'aspectRatio',
  'status',
  'contentType',
  'approvedRevision',
  'errorMessage',
  'createdAt',
  'reviewStatus',
  'reviewedAt',
  'imageUrl',
  'downloadUrl',
  'provenance'
])
const provenanceKeys = new Set(['approvedRevision', 'compositionVersion', 'generationMode'])
const workflowIds = new Set(['store-main', 'detail-banner', 'promo-poster', 'meta-ad', 'package-showcase'])
const aspectRatios = new Set(['1:1', '4:5', '9:16', '16:5'])
const generationStatuses = new Set(['queued', 'processing', 'completed', 'failed'])
const reviewStatuses = new Set(['draft', 'approved', 'rejected'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.size && actualKeys.every((key) => keys.has(key))
}

function isText(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= maxLength && (allowEmpty || value.length > 0)
}

function isGenerationEnvelope(value: unknown): value is Omit<GenerationResult, 'title'> {
  if (!isRecord(value) || !hasExactKeys(value, generationKeys)) return false
  const provenance = value.provenance
  if (!isRecord(provenance) || !hasExactKeys(provenance, provenanceKeys)) return false
  if (!isText(value.id, 64)
    || !(value.campaignPackId === null || isText(value.campaignPackId, 64))
    || !workflowIds.has(String(value.workflowId))
    || !aspectRatios.has(String(value.aspectRatio))
    || !generationStatuses.has(String(value.status))
    || !Number.isSafeInteger(value.approvedRevision)
    || Number(value.approvedRevision) <= 0
    || !(value.errorMessage === null || isText(value.errorMessage, 1_000, true))
    || !isText(value.createdAt, 64)
    || !reviewStatuses.has(String(value.reviewStatus))
    || !(value.reviewedAt === null || isText(value.reviewedAt, 64))
    || !Number.isSafeInteger(provenance.approvedRevision)
    || provenance.approvedRevision !== value.approvedRevision
    || !(provenance.compositionVersion === null || isText(provenance.compositionVersion, 100))
    || !(provenance.generationMode === null || provenance.generationMode === 'deterministic' || provenance.generationMode === 'assisted')) return false

  const completed = value.status === 'completed'
  const expectedImageUrl = `/api/generations/${encodeURIComponent(value.id)}/image`
  const expectedDownloadUrl = `/api/generations/${encodeURIComponent(value.id)}/download`
  if (completed) {
    if (value.imageUrl !== expectedImageUrl || (value.contentType !== 'image/svg+xml' && value.contentType !== 'image/png')) return false
  } else if (value.imageUrl !== null || value.contentType !== null) {
    return false
  }
  if (value.reviewStatus === 'draft' ? value.reviewedAt !== null : value.reviewedAt === null) return false
  const downloadable = completed && value.reviewStatus === 'approved'
  return downloadable ? value.downloadUrl === expectedDownloadUrl : value.downloadUrl === null
}

export function normalizeGenerationResults(value: unknown) {
  if (!Array.isArray(value) || value.length > 20 || !value.every(isGenerationEnvelope)) {
    throw new Error(generationListUnavailableMessage)
  }
  const ids = value.map((item) => item.id)
  if (new Set(ids).size !== ids.length) throw new Error(generationListUnavailableMessage)
  return value.map((item) => ({ ...item, title: `${item.aspectRatio} · ${workflowById(item.workflowId).title}` }))
}

export async function loadGenerations(workspaceId: string) {
  let response: Response
  try {
    response = await fetch(`/api/generations?workspaceId=${encodeURIComponent(workspaceId)}`, { credentials: 'same-origin' })
  } catch {
    throw new Error(generationListUnavailableMessage)
  }
  const data = await response.json().catch(() => null) as { generations?: unknown } | null
  if (!response.ok) throw new Error(generationListUnavailableMessage)
  return normalizeGenerationResults(data?.generations)
}

export async function loadGenerationSnapshot(workspaceId: string): Promise<{
  results: GenerationResult[] | null
  error: string | null
}> {
  try {
    return { results: await loadGenerations(workspaceId), error: null }
  } catch (error) {
    return {
      results: null,
      error: error instanceof Error ? error.message : generationListUnavailableMessage
    }
  }
}
