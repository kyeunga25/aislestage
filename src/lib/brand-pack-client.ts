import { sanitizeCampaignBrief, validateCampaignBrief } from './campaign-agent'
import { readBoundedJsonResponse, readBoundedJsonResponseOutcome } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import type { BrandPack, SavedBrandPack } from './types'

export const brandPackListUnavailableMessage = '私人品牌資料暫時無法讀取。 Private brand library is temporarily unavailable.'
export const brandPackSaveUnavailableMessage = '品牌資料儲存暫時無法使用。 Saving the brand snapshot is temporarily unavailable.'
export const brandPackRevisionInvalidMessage = '品牌資料批准版本無效。 Brand approval revision is invalid.'

const MAX_BRAND_PACK_LIST_BYTES = 64 * 1024
const MAX_BRAND_PACK_SAVE_BYTES = 16 * 1024
const BRAND_PACK_TIMEOUT_MS = 15_000
const BRAND_PACK_SAVE_ATTEMPTS = 2
const responseKeys = new Set(['brandPacks'])
const saveResponseKeys = new Set(['brandPack', 'replayed'])
const brandPackKeys = new Set([
  'id',
  'name',
  'tone',
  'colors',
  'forbiddenWords',
  'locale',
  'cta',
  'ctaEn',
  'approvedRevision',
  'createdAt'
])
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

class BrandPackSaveAttemptError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'BrandPackSaveAttemptError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actual = Object.keys(value)
  return actual.length === keys.size && actual.every((key) => keys.has(key))
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !utcTimestampPattern.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value.replace(/Z$/, '.000Z')
}

function normalizeBrandPack(value: unknown): SavedBrandPack | null {
  if (!isRecord(value)
    || !hasExactKeys(value, brandPackKeys)
    || !uuidV4.test(String(value.id))
    || !Number.isSafeInteger(value.approvedRevision)
    || Number(value.approvedRevision) <= 0
    || !isCanonicalUtcTimestamp(value.createdAt)
    || !Array.isArray(value.colors)) return null

  const brand: BrandPack = {
    name: value.name as string,
    tone: value.tone as string,
    colors: value.colors as string[],
    forbiddenWords: value.forbiddenWords as string,
    locale: value.locale as BrandPack['locale'],
    cta: value.cta as string,
    ctaEn: value.ctaEn as string
  }
  if (validateCampaignBrief({ brand }).length
    || !brand.name
    || !brand.ctaEn
    || JSON.stringify(sanitizeCampaignBrief({ brand }).brand) !== JSON.stringify(brand)) return null

  return {
    id: String(value.id),
    ...brand,
    approvedRevision: Number(value.approvedRevision),
    createdAt: value.createdAt
  }
}

export function normalizeBrandPackList(value: unknown): SavedBrandPack[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error(brandPackListUnavailableMessage)
  const brandPacks = value.map(normalizeBrandPack)
  if (brandPacks.some((brandPack) => brandPack === null)) throw new Error(brandPackListUnavailableMessage)
  const normalized = brandPacks as SavedBrandPack[]
  if (new Set(normalized.map((brandPack) => brandPack.id)).size !== normalized.length) {
    throw new Error(brandPackListUnavailableMessage)
  }
  return normalized
}

export async function loadBrandPackList() {
  try {
    return await fetchWithTimeout(
      '/api/brand-packs',
      { credentials: 'same-origin' },
      BRAND_PACK_TIMEOUT_MS,
      async (response) => {
        if (response.status !== 200 || !response.ok) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(brandPackListUnavailableMessage)
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (contentType !== 'application/json') {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(brandPackListUnavailableMessage)
        }
        const data = await readBoundedJsonResponse(response, MAX_BRAND_PACK_LIST_BYTES)
        if (!isRecord(data) || !hasExactKeys(data, responseKeys)) throw new Error(brandPackListUnavailableMessage)
        return normalizeBrandPackList(data.brandPacks)
      }
    )
  } catch {
    throw new Error(brandPackListUnavailableMessage)
  }
}

export async function loadBrandPackListSnapshot(): Promise<{
  brandPacks: SavedBrandPack[] | null
  error: string | null
}> {
  try {
    return { brandPacks: await loadBrandPackList(), error: null }
  } catch (error) {
    return {
      brandPacks: null,
      error: error instanceof Error ? error.message : brandPackListUnavailableMessage
    }
  }
}

function brandPackSaveFailureMessage(status: number) {
  if (status === 400 || status === 413 || status === 415) return brandPackRevisionInvalidMessage
  if (status === 409) return '品牌資料批准版本已改變，請重新核對。 Brand approval changed; review the latest plan.'
  if (status === 401 || status === 403) return '工作區授權已改變，請重新登入。 Workspace authorization changed; please sign in again.'
  return brandPackSaveUnavailableMessage
}

async function saveApprovedBrandPackAttempt(approvedRevision: number, body: string) {
  return fetchWithTimeout(
    '/api/brand-packs',
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body
    },
    BRAND_PACK_TIMEOUT_MS,
    async (response, signal) => {
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new BrandPackSaveAttemptError(
          brandPackSaveFailureMessage(response.status),
          response.status === 408 || response.status >= 500
        )
      }
      if (response.status !== 200 && response.status !== 201) {
        await response.body?.cancel().catch(() => undefined)
        throw new BrandPackSaveAttemptError(brandPackSaveUnavailableMessage, false)
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        await response.body?.cancel().catch(() => undefined)
        throw new BrandPackSaveAttemptError(brandPackSaveUnavailableMessage, false)
      }
      const outcome = await readBoundedJsonResponseOutcome(response, MAX_BRAND_PACK_SAVE_BYTES)
      if (signal.aborted || outcome.kind === 'stream-error') {
        throw new BrandPackSaveAttemptError(brandPackSaveUnavailableMessage, true)
      }
      const data = outcome.kind === 'value' ? outcome.value : null
      if (!isRecord(data)
        || !hasExactKeys(data, saveResponseKeys)
        || typeof data.replayed !== 'boolean'
        || (response.status === 201) !== !data.replayed) {
        throw new BrandPackSaveAttemptError(brandPackSaveUnavailableMessage, false)
      }
      const brandPack = normalizeBrandPack(data.brandPack)
      if (!brandPack || brandPack.approvedRevision > approvedRevision) {
        throw new BrandPackSaveAttemptError(brandPackSaveUnavailableMessage, false)
      }
      return brandPack
    }
  )
}

export async function saveApprovedBrandPack(approvedRevision: number) {
  if (!Number.isSafeInteger(approvedRevision) || approvedRevision <= 0) {
    throw new Error(brandPackRevisionInvalidMessage)
  }
  const body = JSON.stringify({ approvedRevision })
  for (let attempt = 0; attempt < BRAND_PACK_SAVE_ATTEMPTS; attempt += 1) {
    try {
      return await saveApprovedBrandPackAttempt(approvedRevision, body)
    } catch (error) {
      const retryable = !(error instanceof BrandPackSaveAttemptError) || error.retryable
      if (retryable && attempt + 1 < BRAND_PACK_SAVE_ATTEMPTS) continue
      throw new Error(error instanceof BrandPackSaveAttemptError ? error.message : brandPackSaveUnavailableMessage)
    }
  }
  throw new Error(brandPackSaveUnavailableMessage)
}
