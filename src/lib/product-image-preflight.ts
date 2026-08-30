import {
  hasPrivateImageMetadata,
  hasSafeImageDimensions,
  hasValidPngStructure,
  hasValidProductImageSignature,
  hasValidWebpStructure,
  productImageDimensions
} from './image-validation'
import type { ProductAsset } from './types'

export const productImagePreflightInvalidMessage = '圖片內容、結構、metadata 或尺寸無法通過本機預檢。 Image content, structure, metadata, or dimensions failed local preflight.'
export const productImagePreflightUnavailableMessage = '未能完成本機圖片預檢。 Unable to complete local image preflight.'

const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024
const PRODUCT_IMAGE_PREFLIGHT_TIMEOUT_MS = 10_000
const supportedTypes = new Set<ProductAsset['contentType']>(['image/png', 'image/jpeg', 'image/webp'])

async function readLocalFile(file: File) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      file.arrayBuffer(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(productImagePreflightUnavailableMessage)), PRODUCT_IMAGE_PREFLIGHT_TIMEOUT_MS)
      })
    ])
  } catch {
    throw new Error(productImagePreflightUnavailableMessage)
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

export async function preflightProductImage(file: File): Promise<{ widthPx: number; heightPx: number }> {
  if (!(file instanceof File)
    || !supportedTypes.has(file.type as ProductAsset['contentType'])
    || !Number.isSafeInteger(file.size)
    || file.size <= 0
    || file.size > MAX_PRODUCT_IMAGE_BYTES) throw new Error(productImagePreflightInvalidMessage)

  const buffer = await readLocalFile(file)
  if (buffer.byteLength !== file.size || buffer.byteLength > MAX_PRODUCT_IMAGE_BYTES) {
    throw new Error(productImagePreflightInvalidMessage)
  }
  const bytes = new Uint8Array(buffer)
  const contentType = file.type as ProductAsset['contentType']
  if (!hasValidProductImageSignature(contentType, bytes)
    || hasPrivateImageMetadata(contentType, bytes)
    || (contentType === 'image/png' && !hasValidPngStructure(bytes))
    || (contentType === 'image/webp' && !hasValidWebpStructure(bytes))) {
    throw new Error(productImagePreflightInvalidMessage)
  }
  const dimensions = productImageDimensions(contentType, bytes)
  if (!dimensions || !hasSafeImageDimensions(dimensions)) throw new Error(productImagePreflightInvalidMessage)
  return { widthPx: dimensions.width, heightPx: dimensions.height }
}
