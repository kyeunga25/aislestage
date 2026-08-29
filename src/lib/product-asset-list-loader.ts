import { readBoundedJsonResponse } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import type { ProductAssetListItem } from './types'

export const productAssetListUnavailableMessage = '私人商品來源圖暫時無法讀取。 Private product sources are temporarily unavailable.'

const MAX_PRODUCT_ASSET_LIST_BYTES = 64 * 1024
const PRODUCT_ASSET_LIST_TIMEOUT_MS = 15_000
const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024
const responseKeys = new Set(['assets'])
const assetKeys = new Set(['id', 'name', 'contentType', 'sizeBytes', 'previewUrl', 'createdAt'])
const canonicalNames = new Map<ProductAssetListItem['contentType'], string>([
  ['image/png', 'product-image.png'],
  ['image/jpeg', 'product-image.jpg'],
  ['image/webp', 'product-image.webp']
])
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

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

function normalizeProductAsset(value: unknown): ProductAssetListItem | null {
  if (!isRecord(value) || !hasExactKeys(value, assetKeys) || !uuidV4.test(String(value.id))) return null
  const contentType = value.contentType
  if (typeof contentType !== 'string' || !canonicalNames.has(contentType as ProductAssetListItem['contentType'])) return null
  const canonicalName = canonicalNames.get(contentType as ProductAssetListItem['contentType'])
  const id = String(value.id)
  if (!canonicalName
    || value.name !== canonicalName
    || !Number.isSafeInteger(value.sizeBytes)
    || Number(value.sizeBytes) <= 0
    || Number(value.sizeBytes) > MAX_PRODUCT_IMAGE_BYTES
    || value.previewUrl !== `/api/assets/${encodeURIComponent(id)}`
    || !isCanonicalUtcTimestamp(value.createdAt)) return null
  return {
    id,
    name: canonicalName,
    contentType: contentType as ProductAssetListItem['contentType'],
    sizeBytes: value.sizeBytes as number,
    previewUrl: value.previewUrl,
    createdAt: value.createdAt
  }
}

export function normalizeProductAssetList(value: unknown): ProductAssetListItem[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error(productAssetListUnavailableMessage)
  const assets = value.map(normalizeProductAsset)
  if (assets.some((asset) => asset === null)) throw new Error(productAssetListUnavailableMessage)
  const normalized = assets as ProductAssetListItem[]
  if (new Set(normalized.map((asset) => asset.id)).size !== normalized.length) {
    throw new Error(productAssetListUnavailableMessage)
  }
  return normalized
}

export async function loadProductAssetList() {
  try {
    return await fetchWithTimeout(
      '/api/assets/product',
      { credentials: 'same-origin' },
      PRODUCT_ASSET_LIST_TIMEOUT_MS,
      async (response) => {
        if (response.status !== 200 || !response.ok) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(productAssetListUnavailableMessage)
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (contentType !== 'application/json') {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(productAssetListUnavailableMessage)
        }
        const data = await readBoundedJsonResponse(response, MAX_PRODUCT_ASSET_LIST_BYTES)
        if (!isRecord(data) || !hasExactKeys(data, responseKeys)) throw new Error(productAssetListUnavailableMessage)
        return normalizeProductAssetList(data.assets)
      }
    )
  } catch {
    throw new Error(productAssetListUnavailableMessage)
  }
}

export async function loadProductAssetListSnapshot(): Promise<{
  assets: ProductAssetListItem[] | null
  error: string | null
}> {
  try {
    return { assets: await loadProductAssetList(), error: null }
  } catch (error) {
    return {
      assets: null,
      error: error instanceof Error ? error.message : productAssetListUnavailableMessage
    }
  }
}
