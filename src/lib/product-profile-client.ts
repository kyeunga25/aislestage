import { sanitizeCampaignBrief, validateCampaignBrief } from './campaign-agent'
import { readBoundedJsonResponse, readBoundedJsonResponseOutcome } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import type { Product, SavedProductProfile } from './types'

export const productProfileListUnavailableMessage = '私人商品資料暫時無法讀取。 Private product library is temporarily unavailable.'
export const productProfileSaveUnavailableMessage = '商品資料儲存暫時無法使用。 Saving the product profile is temporarily unavailable.'
export const productProfileRevisionInvalidMessage = '商品資料批准版本無效。 Product approval revision is invalid.'

const MAX_PRODUCT_PROFILE_LIST_BYTES = 64 * 1024
const MAX_PRODUCT_PROFILE_SAVE_BYTES = 16 * 1024
const PRODUCT_PROFILE_TIMEOUT_MS = 15_000
const PRODUCT_PROFILE_SAVE_ATTEMPTS = 2
const responseKeys = new Set(['productProfiles'])
const saveResponseKeys = new Set(['productProfile', 'replayed'])
const productProfileKeys = new Set([
  'id',
  'name',
  'nameEn',
  'category',
  'benefits',
  'benefitsEn',
  'specifications',
  'price',
  'promotion',
  'promotionEn',
  'channels',
  'approvedRevision',
  'createdAt'
])
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

class ProductProfileSaveAttemptError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'ProductProfileSaveAttemptError'
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

function normalizeProductProfile(value: unknown): SavedProductProfile | null {
  if (!isRecord(value)
    || !hasExactKeys(value, productProfileKeys)
    || !uuidV4.test(String(value.id))
    || !Number.isSafeInteger(value.approvedRevision)
    || Number(value.approvedRevision) <= 0
    || !isCanonicalUtcTimestamp(value.createdAt)
    || !Array.isArray(value.benefits)
    || !Array.isArray(value.benefitsEn)
    || !Array.isArray(value.channels)) return null

  const product: Product = {
    name: value.name as string,
    nameEn: value.nameEn as string,
    category: value.category as string,
    benefits: value.benefits as string[],
    benefitsEn: value.benefitsEn as string[],
    specifications: value.specifications as string,
    price: value.price as string,
    promotion: value.promotion as string,
    promotionEn: value.promotionEn as string,
    channels: value.channels as string[]
  }
  if (validateCampaignBrief({ product }).length
    || !product.name
    || !product.nameEn
    || !product.category
    || !product.price
    || !product.promotion
    || !product.promotionEn
    || product.benefits.length < 2
    || product.benefitsEn.length < 2
    || JSON.stringify(sanitizeCampaignBrief({ product }).product) !== JSON.stringify(product)) return null

  return {
    id: String(value.id),
    ...product,
    approvedRevision: Number(value.approvedRevision),
    createdAt: value.createdAt
  }
}

export function normalizeProductProfileList(value: unknown): SavedProductProfile[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error(productProfileListUnavailableMessage)
  const productProfiles = value.map(normalizeProductProfile)
  if (productProfiles.some((profile) => profile === null)) throw new Error(productProfileListUnavailableMessage)
  const normalized = productProfiles as SavedProductProfile[]
  if (new Set(normalized.map((profile) => profile.id)).size !== normalized.length) {
    throw new Error(productProfileListUnavailableMessage)
  }
  return normalized
}

export async function loadProductProfileList() {
  try {
    return await fetchWithTimeout(
      '/api/product-profiles',
      { credentials: 'same-origin' },
      PRODUCT_PROFILE_TIMEOUT_MS,
      async (response) => {
        if (response.status !== 200 || !response.ok) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(productProfileListUnavailableMessage)
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (contentType !== 'application/json') {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(productProfileListUnavailableMessage)
        }
        const data = await readBoundedJsonResponse(response, MAX_PRODUCT_PROFILE_LIST_BYTES)
        if (!isRecord(data) || !hasExactKeys(data, responseKeys)) throw new Error(productProfileListUnavailableMessage)
        return normalizeProductProfileList(data.productProfiles)
      }
    )
  } catch {
    throw new Error(productProfileListUnavailableMessage)
  }
}

export async function loadProductProfileListSnapshot(): Promise<{
  productProfiles: SavedProductProfile[] | null
  error: string | null
}> {
  try {
    return { productProfiles: await loadProductProfileList(), error: null }
  } catch (error) {
    return {
      productProfiles: null,
      error: error instanceof Error ? error.message : productProfileListUnavailableMessage
    }
  }
}

function productProfileSaveFailureMessage(status: number) {
  if (status === 400 || status === 413 || status === 415) return productProfileRevisionInvalidMessage
  if (status === 409) return '商品資料批准版本已改變，請重新核對。 Product approval changed; review the latest plan.'
  if (status === 401 || status === 403) return '工作區授權已改變，請重新登入。 Workspace authorization changed; please sign in again.'
  return productProfileSaveUnavailableMessage
}

async function saveApprovedProductProfileAttempt(approvedRevision: number, body: string) {
  return fetchWithTimeout(
    '/api/product-profiles',
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body
    },
    PRODUCT_PROFILE_TIMEOUT_MS,
    async (response, signal) => {
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new ProductProfileSaveAttemptError(
          productProfileSaveFailureMessage(response.status),
          response.status === 408 || response.status >= 500
        )
      }
      if (response.status !== 200 && response.status !== 201) {
        await response.body?.cancel().catch(() => undefined)
        throw new ProductProfileSaveAttemptError(productProfileSaveUnavailableMessage, false)
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        await response.body?.cancel().catch(() => undefined)
        throw new ProductProfileSaveAttemptError(productProfileSaveUnavailableMessage, false)
      }
      const outcome = await readBoundedJsonResponseOutcome(response, MAX_PRODUCT_PROFILE_SAVE_BYTES)
      if (signal.aborted || outcome.kind === 'stream-error') {
        throw new ProductProfileSaveAttemptError(productProfileSaveUnavailableMessage, true)
      }
      const data = outcome.kind === 'value' ? outcome.value : null
      if (!isRecord(data)
        || !hasExactKeys(data, saveResponseKeys)
        || typeof data.replayed !== 'boolean'
        || (response.status === 201) !== !data.replayed) {
        throw new ProductProfileSaveAttemptError(productProfileSaveUnavailableMessage, false)
      }
      const productProfile = normalizeProductProfile(data.productProfile)
      if (!productProfile || productProfile.approvedRevision > approvedRevision) {
        throw new ProductProfileSaveAttemptError(productProfileSaveUnavailableMessage, false)
      }
      return productProfile
    }
  )
}

export async function saveApprovedProductProfile(approvedRevision: number) {
  if (!Number.isSafeInteger(approvedRevision) || approvedRevision <= 0) {
    throw new Error(productProfileRevisionInvalidMessage)
  }
  const body = JSON.stringify({ approvedRevision })
  for (let attempt = 0; attempt < PRODUCT_PROFILE_SAVE_ATTEMPTS; attempt += 1) {
    try {
      return await saveApprovedProductProfileAttempt(approvedRevision, body)
    } catch (error) {
      const retryable = !(error instanceof ProductProfileSaveAttemptError) || error.retryable
      if (retryable && attempt + 1 < PRODUCT_PROFILE_SAVE_ATTEMPTS) continue
      throw new Error(error instanceof ProductProfileSaveAttemptError ? error.message : productProfileSaveUnavailableMessage)
    }
  }
  throw new Error(productProfileSaveUnavailableMessage)
}
