export const MAX_IMAGE_CONTAINER_CHUNKS = 4_096
export const MAX_SAFE_IMAGE_DIMENSION = 8_192
export const MAX_SAFE_IMAGE_PIXELS = 32_000_000
export const MAX_SAFE_PNG_DECODED_BYTES = 128 * 1024 * 1024

export type ImageDimensions = { width: number; height: number }

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]
const privatePngMetadataChunks = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt'])

function chunkName(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + 4))
}

function uint32BigEndian(bytes: Uint8Array, offset: number) {
  return (bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3]) >>> 0
}

const pngCrcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function hasValidPngChunkCrc(bytes: Uint8Array, typeOffset: number, crcOffset: number) {
  let crc = 0xffffffff
  for (let offset = typeOffset; offset < crcOffset; offset += 1) crc = pngCrcTable[(crc ^ bytes[offset]) & 0xff] ^ (crc >>> 8)
  return ((crc ^ 0xffffffff) >>> 0) === uint32BigEndian(bytes, crcOffset)
}

export function pngImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null
  return { width: uint32BigEndian(bytes, 16), height: uint32BigEndian(bytes, 20) }
}

export function hasSafeImageDimensions(dimensions: ImageDimensions | null) {
  return Boolean(dimensions
    && Number.isSafeInteger(dimensions.width)
    && Number.isSafeInteger(dimensions.height)
    && dimensions.width > 0
    && dimensions.height > 0
    && dimensions.width <= MAX_SAFE_IMAGE_DIMENSION
    && dimensions.height <= MAX_SAFE_IMAGE_DIMENSION
    && dimensions.width * dimensions.height <= MAX_SAFE_IMAGE_PIXELS)
}

export function hasPrivatePngMetadata(bytes: Uint8Array) {
  let offset = 8
  let chunkCount = 0
  while (offset + 12 <= bytes.length) {
    chunkCount += 1
    if (chunkCount > MAX_IMAGE_CONTAINER_CHUNKS) return true
    const length = uint32BigEndian(bytes, offset)
    if (privatePngMetadataChunks.has(chunkName(bytes, offset + 4))) return true
    offset += 12 + length
  }
  return false
}

export function hasValidPngStructure(bytes: Uint8Array) {
  if (bytes.length < pngSignature.length
    || pngSignature.some((value, index) => bytes[index] !== value)) return false

  let offset = 8
  let chunkCount = 0
  let sawHeader = false
  let sawPalette = false
  let sawImageData = false
  let endedImageData = false
  let imageDataBytes = 0
  let bitDepth = -1
  let colorType = -1

  while (offset < bytes.length) {
    chunkCount += 1
    if (chunkCount > MAX_IMAGE_CONTAINER_CHUNKS) return false
    if (bytes.length - offset < 12) return false
    const length = uint32BigEndian(bytes, offset)
    if (length > bytes.length - offset - 12) return false
    const typeOffset = offset + 4
    const dataOffset = offset + 8
    const crcOffset = dataOffset + length
    const typeBytes = bytes.subarray(typeOffset, typeOffset + 4)
    if ([...typeBytes].some((value) => !((value >= 65 && value <= 90) || (value >= 97 && value <= 122)))) return false
    if ((typeBytes[2] & 0x20) !== 0 || !hasValidPngChunkCrc(bytes, typeOffset, crcOffset)) return false

    const name = chunkName(bytes, typeOffset)
    if (!sawHeader && name !== 'IHDR') return false
    if (sawImageData && name !== 'IDAT') endedImageData = true

    if (name === 'IHDR') {
      if (sawHeader || offset !== 8 || length !== 13) return false
      const width = uint32BigEndian(bytes, dataOffset)
      const height = uint32BigEndian(bytes, dataOffset + 4)
      bitDepth = bytes[dataOffset + 8]
      colorType = bytes[dataOffset + 9]
      const validBitDepth = (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth))
        || (colorType === 2 && [8, 16].includes(bitDepth))
        || (colorType === 3 && [1, 2, 4, 8].includes(bitDepth))
        || ((colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth))
      if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff || !validBitDepth) return false
      if (bytes[dataOffset + 10] !== 0 || bytes[dataOffset + 11] !== 0 || bytes[dataOffset + 12] > 1) return false
      sawHeader = true
    } else if (name === 'PLTE') {
      const paletteEntries = length / 3
      if (sawPalette || sawImageData || colorType === 0 || colorType === 4
        || length === 0 || length > 768 || length % 3 !== 0
        || (colorType === 3 && paletteEntries > 2 ** bitDepth)) return false
      sawPalette = true
    } else if (name === 'IDAT') {
      if (!sawHeader || endedImageData || (colorType === 3 && !sawPalette)) return false
      sawImageData = true
      imageDataBytes += length
    } else if (name === 'IEND') {
      return length === 0 && sawImageData && imageDataBytes > 0 && crcOffset + 4 === bytes.length
    } else if ((typeBytes[0] & 0x20) === 0) {
      return false
    }

    offset = crcOffset + 4
  }
  return false
}

type PngImageData = {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlace: number
  chunks: Uint8Array<ArrayBuffer>[]
}

const adam7Passes = [
  { xStart: 0, yStart: 0, xStep: 8, yStep: 8 },
  { xStart: 4, yStart: 0, xStep: 8, yStep: 8 },
  { xStart: 0, yStart: 4, xStep: 4, yStep: 8 },
  { xStart: 2, yStart: 0, xStep: 4, yStep: 4 },
  { xStart: 0, yStart: 2, xStep: 2, yStep: 4 },
  { xStart: 1, yStart: 0, xStep: 2, yStep: 2 },
  { xStart: 0, yStart: 1, xStep: 1, yStep: 2 }
]

function pngImageData(bytes: Uint8Array): PngImageData | null {
  if (!hasValidPngStructure(bytes)) return null
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = -1
  const chunks: Uint8Array<ArrayBuffer>[] = []

  while (offset + 12 <= bytes.length) {
    const length = uint32BigEndian(bytes, offset)
    const dataOffset = offset + 8
    const name = chunkName(bytes, offset + 4)
    if (name === 'IHDR') {
      width = uint32BigEndian(bytes, dataOffset)
      height = uint32BigEndian(bytes, dataOffset + 4)
      bitDepth = bytes[dataOffset + 8]
      colorType = bytes[dataOffset + 9]
      interlace = bytes[dataOffset + 12]
    } else if (name === 'IDAT') {
      chunks.push(bytes.slice(dataOffset, dataOffset + length))
    } else if (name === 'IEND') {
      break
    }
    offset += 12 + length
  }

  return chunks.length ? { width, height, bitDepth, colorType, interlace, chunks } : null
}

function sampledLength(size: number, start: number, step: number) {
  return size <= start ? 0 : Math.ceil((size - start) / step)
}

function pngScanlineLengths(image: PngImageData) {
  if (!hasSafeImageDimensions(image)) return null
  const channels = image.colorType === 0 || image.colorType === 3
    ? 1
    : image.colorType === 2
      ? 3
      : image.colorType === 4
        ? 2
        : image.colorType === 6 ? 4 : 0
  if (!channels) return null
  const bitsPerPixel = channels * image.bitDepth
  const passes = image.interlace === 0
    ? [{ xStart: 0, yStart: 0, xStep: 1, yStep: 1 }]
    : adam7Passes
  const lengths: number[] = []
  let totalBytes = 0

  for (const pass of passes) {
    const width = sampledLength(image.width, pass.xStart, pass.xStep)
    const height = sampledLength(image.height, pass.yStart, pass.yStep)
    if (!width || !height) continue
    const rowBytes = 1 + Math.ceil(width * bitsPerPixel / 8)
    const passBytes = rowBytes * height
    if (!Number.isSafeInteger(passBytes) || passBytes > MAX_SAFE_PNG_DECODED_BYTES - totalBytes) return null
    totalBytes += passBytes
    for (let row = 0; row < height; row += 1) lengths.push(rowBytes)
  }
  return lengths.length ? { lengths, totalBytes } : null
}

export async function hasDecodablePngImageData(bytes: Uint8Array, signal?: AbortSignal) {
  const image = pngImageData(bytes)
  if (!image || signal?.aborted) return false
  const scanlines = pngScanlineLengths(image)
  if (!scanlines) return false

  let chunkIndex = 0
  try {
    const compressed = new ReadableStream<BufferSource>({
      pull(controller) {
        if (chunkIndex < image.chunks.length) controller.enqueue(image.chunks[chunkIndex++])
        else controller.close()
      }
    })
    const reader = compressed.pipeThrough(new DecompressionStream('deflate')).getReader()
    const abort = () => { void reader.cancel().catch(() => undefined) }
    signal?.addEventListener('abort', abort, { once: true })
    let rowIndex = 0
    let rowOffset = 0
    let totalBytes = 0

    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel().catch(() => undefined)
          return false
        }
        const { done, value } = await reader.read()
        if (done) break
        let valueOffset = 0
        while (valueOffset < value.byteLength) {
          if (rowIndex >= scanlines.lengths.length) {
            await reader.cancel().catch(() => undefined)
            return false
          }
          if (rowOffset === 0 && value[valueOffset] > 4) {
            await reader.cancel().catch(() => undefined)
            return false
          }
          const consumed = Math.min(scanlines.lengths[rowIndex] - rowOffset, value.byteLength - valueOffset)
          rowOffset += consumed
          valueOffset += consumed
          totalBytes += consumed
          if (rowOffset === scanlines.lengths[rowIndex]) {
            rowIndex += 1
            rowOffset = 0
          }
        }
      }
      return !signal?.aborted
        && totalBytes === scanlines.totalBytes
        && rowIndex === scanlines.lengths.length
        && rowOffset === 0
    } finally {
      signal?.removeEventListener('abort', abort)
      reader.releaseLock()
    }
  } catch {
    return false
  }
}
