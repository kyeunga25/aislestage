export const MAX_IMAGE_CONTAINER_CHUNKS = 4_096
export const MAX_SAFE_IMAGE_DIMENSION = 8_192
export const MAX_SAFE_IMAGE_PIXELS = 32_000_000

export type ImageDimensions = { width: number; height: number }

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]

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
      const bitDepth = bytes[dataOffset + 8]
      colorType = bytes[dataOffset + 9]
      const validBitDepth = (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth))
        || (colorType === 2 && [8, 16].includes(bitDepth))
        || (colorType === 3 && [1, 2, 4, 8].includes(bitDepth))
        || ((colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth))
      if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff || !validBitDepth) return false
      if (bytes[dataOffset + 10] !== 0 || bytes[dataOffset + 11] !== 0 || bytes[dataOffset + 12] > 1) return false
      sawHeader = true
    } else if (name === 'PLTE') {
      if (sawPalette || sawImageData || colorType === 0 || colorType === 4 || length === 0 || length > 768 || length % 3 !== 0) return false
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
