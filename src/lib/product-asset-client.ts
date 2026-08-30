import { readBoundedJsonResponseOutcome } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import { hasSafeImageDimensions } from './image-validation'
import type { ProductAsset } from './types'

export const productAssetTypeMessage = '只支援 PNG、JPEG 或靜態 WebP 圖片。 Only PNG, JPEG, or static WebP images are supported.'
export const productAssetSizeMessage = '圖片必須有內容且不可超過 4 MB。 Image must be non-empty and no larger than 4 MB.'
export const productAssetResponseInvalidMessage = '未能確認商品圖片上載結果。 Unable to verify the product image upload.'
export const productAssetUploadUnavailableMessage = '商品圖片上載暫時無法使用。 Product image upload is temporarily unavailable.'
export const productAssetConflictMessage = '商品圖片上載識別資料已被使用，請重新選擇圖片。 Product image upload identity was already used; select the image again.'

const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_PRODUCT_ASSET_RESPONSE_BYTES = 4 * 1024
const PRODUCT_UPLOAD_TIMEOUT_MS = 45_000
const PRODUCT_UPLOAD_ATTEMPTS = 2
const assetKeys = new Set(['id', 'name', 'contentType', 'sizeBytes', 'widthPx', 'heightPx', 'previewUrl'])
const responseKeys = new Set(['asset'])
const imageNames = new Map<ProductAsset['contentType'], string>([
  ['image/png', 'product-image.png'],
  ['image/jpeg', 'product-image.jpg'],
  ['image/webp', 'product-image.webp']
])
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

class ProductAssetUploadAttemptError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'ProductAssetUploadAttemptError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.size && actualKeys.every((key) => keys.has(key))
}

function uploadFailureMessage(status: number) {
  if (status === 400) return '圖片內容或 metadata 無效，請重新匯出後再上傳。 Image content or metadata is invalid; export it again.'
  if (status === 409) return productAssetConflictMessage
  if (status === 413) return productAssetSizeMessage
  if (status === 415) return productAssetTypeMessage
  return productAssetUploadUnavailableMessage
}

function normalizeProductAsset(value: unknown, file: File, idempotencyKey: string): ProductAsset | null {
  if (!isRecord(value)
    || !hasExactKeys(value, assetKeys)
    || !uuidV4.test(String(value.id))
    || value.id !== idempotencyKey) return null
  const contentType = value.contentType
  if (typeof contentType !== 'string' || !imageNames.has(contentType as ProductAsset['contentType'])) return null
  const expectedName = imageNames.get(contentType as ProductAsset['contentType'])
  if (!expectedName
    || contentType !== file.type
    || value.name !== expectedName
    || value.sizeBytes !== file.size
    || !Number.isSafeInteger(value.sizeBytes)
    || Number(value.sizeBytes) <= 0
    || !hasSafeImageDimensions({ width: value.widthPx as number, height: value.heightPx as number })
    || value.previewUrl !== `/api/assets/${encodeURIComponent(String(value.id))}`) return null
  return {
    id: String(value.id),
    name: expectedName,
    contentType: contentType as ProductAsset['contentType'],
    sizeBytes: value.sizeBytes as number,
    widthPx: value.widthPx as number,
    heightPx: value.heightPx as number,
    previewUrl: value.previewUrl
  }
}

async function uploadProductAssetAttempt(file: File, form: FormData, idempotencyKey: string) {
  return fetchWithTimeout(
    '/api/assets/product',
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'idempotency-key': idempotencyKey },
      body: form
    },
    PRODUCT_UPLOAD_TIMEOUT_MS,
    async (response, signal) => {
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new ProductAssetUploadAttemptError(
          uploadFailureMessage(response.status),
          response.status === 408 || response.status >= 500
        )
      }
      if (response.status !== 201) {
        await response.body?.cancel().catch(() => undefined)
        throw new ProductAssetUploadAttemptError(productAssetResponseInvalidMessage, false)
      }
      const responseContentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      if (responseContentType !== 'application/json') {
        await response.body?.cancel().catch(() => undefined)
        throw new ProductAssetUploadAttemptError(productAssetResponseInvalidMessage, false)
      }
      const outcome = await readBoundedJsonResponseOutcome(response, MAX_PRODUCT_ASSET_RESPONSE_BYTES)
      if (signal.aborted || outcome.kind === 'stream-error') {
        throw new ProductAssetUploadAttemptError(productAssetUploadUnavailableMessage, true)
      }
      const data = outcome.kind === 'value' ? outcome.value : null
      if (!isRecord(data) || !hasExactKeys(data, responseKeys)) {
        throw new ProductAssetUploadAttemptError(productAssetResponseInvalidMessage, false)
      }
      const asset = normalizeProductAsset(data.asset, file, idempotencyKey)
      if (!asset) throw new ProductAssetUploadAttemptError(productAssetResponseInvalidMessage, false)
      return asset
    }
  )
}

export async function uploadProductAsset(file: File) {
  if (!(file instanceof File) || !imageNames.has(file.type as ProductAsset['contentType'])) {
    throw new Error(productAssetTypeMessage)
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_PRODUCT_IMAGE_BYTES) {
    throw new Error(productAssetSizeMessage)
  }

  const canonicalFilename = imageNames.get(file.type as ProductAsset['contentType'])!
  const idempotencyKey = crypto.randomUUID()
  const form = new FormData()
  form.set('file', file, canonicalFilename)
  for (let attempt = 0; attempt < PRODUCT_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await uploadProductAssetAttempt(file, form, idempotencyKey)
    } catch (error) {
      const retryable = !(error instanceof ProductAssetUploadAttemptError) || error.retryable
      if (retryable && attempt + 1 < PRODUCT_UPLOAD_ATTEMPTS) continue
      if (error instanceof ProductAssetUploadAttemptError) throw new Error(error.message)
      throw new Error(productAssetUploadUnavailableMessage)
    }
  }
  throw new Error(productAssetUploadUnavailableMessage)
}
