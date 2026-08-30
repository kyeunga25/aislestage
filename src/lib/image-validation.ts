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

function uint32LittleEndian(bytes: Uint8Array, offset: number) {
  return (bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000 + bytes[offset + 3] * 0x1000000) >>> 0
}

function uint24LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000
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

export function hasValidProductImageSignature(contentType: string, bytes: Uint8Array) {
  if (contentType === 'image/png') return bytes.length >= 8 && pngSignature.every((value, index) => bytes[index] === value)
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (contentType === 'image/webp') return bytes.length >= 12
    && chunkName(bytes, 0) === 'RIFF'
    && chunkName(bytes, 8) === 'WEBP'
  return false
}

function webpBitstreamDimensions(bytes: Uint8Array, name: string, dataOffset: number, length: number) {
  if (name === 'VP8L') {
    if (length < 5 || bytes[dataOffset] !== 0x2f) return null
    const header = uint32LittleEndian(bytes, dataOffset + 1)
    if ((header >>> 29) !== 0) return null
    return { width: (header & 0x3fff) + 1, height: ((header >>> 14) & 0x3fff) + 1 }
  }
  if (name === 'VP8 ') {
    if (length < 10 || (bytes[dataOffset] & 1) !== 0) return null
    if (bytes[dataOffset + 3] !== 0x9d || bytes[dataOffset + 4] !== 0x01 || bytes[dataOffset + 5] !== 0x2a) return null
    const width = (bytes[dataOffset + 6] + bytes[dataOffset + 7] * 0x100) & 0x3fff
    const height = (bytes[dataOffset + 8] + bytes[dataOffset + 9] * 0x100) & 0x3fff
    return width > 0 && height > 0 ? { width, height } : null
  }
  return null
}

export function hasValidWebpStructure(bytes: Uint8Array) {
  if (bytes.length < 20 || uint32LittleEndian(bytes, 4) !== bytes.length - 8) return false
  let offset = 12
  let chunkCount = 0
  let extended = false
  let flags = 0
  let canvas: ImageDimensions | null = null
  let image: ({ name: string } & ImageDimensions) | null = null
  let sawIccProfile = false
  let sawAlpha = false

  while (offset < bytes.length) {
    chunkCount += 1
    if (chunkCount > MAX_IMAGE_CONTAINER_CHUNKS) return false
    if (bytes.length - offset < 8) return false
    const name = chunkName(bytes, offset)
    const length = uint32LittleEndian(bytes, offset + 4)
    const dataOffset = offset + 8
    if (length > bytes.length - dataOffset) return false
    const dataEnd = dataOffset + length
    const paddedEnd = dataEnd + (length % 2)
    if (paddedEnd > bytes.length || (length % 2 === 1 && bytes[dataEnd] !== 0)) return false

    if (offset === 12 && name === 'VP8X') {
      if (length !== 10) return false
      flags = bytes[dataOffset]
      if ((flags & 0xc1) !== 0 || (flags & 0x0e) !== 0) return false
      if (bytes[dataOffset + 1] !== 0 || bytes[dataOffset + 2] !== 0 || bytes[dataOffset + 3] !== 0) return false
      const width = uint24LittleEndian(bytes, dataOffset + 4) + 1
      const height = uint24LittleEndian(bytes, dataOffset + 7) + 1
      if (width * height > 0xffffffff) return false
      canvas = { width, height }
      extended = true
    } else if (!extended) {
      if (offset !== 12 || image) return false
      const dimensions = webpBitstreamDimensions(bytes, name, dataOffset, length)
      if (!dimensions || paddedEnd !== bytes.length) return false
      image = { name, ...dimensions }
    } else if (name === 'VP8X' || name === 'ANIM' || name === 'ANMF' || name === 'EXIF' || name === 'XMP ') {
      return false
    } else if (name === 'ICCP') {
      if (sawIccProfile || image || length === 0) return false
      sawIccProfile = true
    } else if (name === 'ALPH') {
      if (sawAlpha || image || length === 0 || (bytes[dataOffset] & 0xc0) !== 0) return false
      sawAlpha = true
    } else if (name === 'VP8 ' || name === 'VP8L') {
      if (image || (name === 'VP8L' && sawAlpha)) return false
      const dimensions = webpBitstreamDimensions(bytes, name, dataOffset, length)
      if (!dimensions || !canvas || dimensions.width !== canvas.width || dimensions.height !== canvas.height) return false
      image = { name, ...dimensions }
    } else {
      return false
    }

    offset = paddedEnd
  }

  if (!image) return false
  if (!extended) return true
  if (Boolean(flags & 0x20) !== sawIccProfile) return false
  if (image.name === 'VP8 ' && Boolean(flags & 0x10) !== sawAlpha) return false
  return true
}

export function jpegImageDimensions(bytes: Uint8Array) {
  let offset = 2
  let markerCount = 0
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return null
    const marker = bytes[offset++]
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    markerCount += 1
    if (markerCount > MAX_IMAGE_CONTAINER_CHUNKS || marker === 0xd8 || marker === 0xd9 || offset + 2 > bytes.length) return null
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2 || length > bytes.length - offset) return null
    const isFrameMarker = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrameMarker) {
      if (length < 8) return null
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6]
      }
    }
    offset += length
  }
  return null
}

export function productImageDimensions(contentType: string, bytes: Uint8Array) {
  if (contentType === 'image/png') return pngImageDimensions(bytes)
  if (contentType === 'image/jpeg') return jpegImageDimensions(bytes)
  if (contentType === 'image/webp') {
    const name = chunkName(bytes, 12)
    if (name === 'VP8X') return { width: uint24LittleEndian(bytes, 24) + 1, height: uint24LittleEndian(bytes, 27) + 1 }
    return webpBitstreamDimensions(bytes, name, 20, uint32LittleEndian(bytes, 16))
  }
  return null
}

export function hasPrivateImageMetadata(contentType: string, bytes: Uint8Array) {
  if (contentType === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return true
    let offset = 2
    let inScan = false
    let sawFrame = false
    let sawScan = false
    let markerCount = 0
    while (offset < bytes.length) {
      const markerWasInScan: boolean = inScan
      if (bytes[offset] !== 0xff) {
        if (!inScan) return true
        offset += 1
        continue
      }

      let fillBytes = 0
      while (offset < bytes.length && bytes[offset] === 0xff) {
        fillBytes += 1
        offset += 1
      }
      if (offset >= bytes.length) return true
      const marker = bytes[offset++]

      if (marker === 0x00) {
        if (!inScan || fillBytes !== 1) return true
        continue
      }
      if (marker >= 0xd0 && marker <= 0xd7) {
        if (!inScan) return true
        continue
      }
      if (marker === 0x01) continue
      markerCount += 1
      if (markerCount > MAX_IMAGE_CONTAINER_CHUNKS) return true
      if (marker === 0xe1 || marker === 0xed || marker === 0xfe) return true
      if (marker === 0xd9) return offset !== bytes.length || !sawFrame || !sawScan
      if (marker === 0xd8 || marker < 0xc0) return true
      if (offset + 2 > bytes.length) return true

      const length = (bytes[offset] << 8) | bytes[offset + 1]
      if (length < 2 || length > bytes.length - offset) return true
      const isFrameMarker = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrameMarker) {
        if (sawFrame || length < 8) return true
        const componentCount = bytes[offset + 7]
        if (componentCount < 1 || componentCount > 4 || length !== 8 + componentCount * 3) return true
        sawFrame = true
      }
      if (marker === 0xda) {
        if (!sawFrame || length < 6) return true
        const componentCount = bytes[offset + 2]
        if (componentCount < 1 || componentCount > 4 || length !== 6 + componentCount * 2) return true
        sawScan = true
      }
      if (marker === 0xdc && length !== 4) return true
      offset += length
      inScan = marker === 0xda || (markerWasInScan && marker === 0xdc)
    }
    return true
  }
  if (contentType === 'image/png') return hasPrivatePngMetadata(bytes)
  if (contentType === 'image/webp') {
    let offset = 12
    let chunkCount = 0
    while (offset + 8 <= bytes.length) {
      chunkCount += 1
      if (chunkCount > MAX_IMAGE_CONTAINER_CHUNKS) return true
      const name = chunkName(bytes, offset)
      if (name === 'EXIF' || name === 'XMP ') return true
      const length = uint32LittleEndian(bytes, offset + 4)
      offset += 8 + length + (length % 2)
    }
  }
  return false
}

export function hasPrivatePngMetadata(bytes: Uint8Array) {
  let offset = 8
  let chunkCount = 0
  while (offset + 12 <= bytes.length) {
    chunkCount += 1
    if (chunkCount > MAX_IMAGE_CONTAINER_CHUNKS) return true
    const length = uint32BigEndian(bytes, offset)
    const typeOffset = offset + 4
    if ((bytes[typeOffset + 1] & 0x20) !== 0 || privatePngMetadataChunks.has(chunkName(bytes, typeOffset))) return true
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
  let sawTransparency = false
  let sawImageData = false
  let endedImageData = false
  let imageDataBytes = 0
  let paletteEntries = 0
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
      paletteEntries = length / 3
      if (sawPalette || sawTransparency || sawImageData || colorType === 0 || colorType === 4
        || length === 0 || length > 768 || length % 3 !== 0
        || (colorType === 3 && paletteEntries > 2 ** bitDepth)) return false
      sawPalette = true
    } else if (name === 'tRNS') {
      const validLength = (colorType === 0 && length === 2)
        || (colorType === 2 && length === 6)
        || (colorType === 3 && sawPalette && length <= paletteEntries)
      if (sawTransparency || sawImageData || !validLength) return false
      sawTransparency = true
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
