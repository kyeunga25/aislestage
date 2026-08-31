import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  preflightProductImage,
  productImagePreflightInvalidMessage,
  productImagePreflightUnavailableMessage
} from '../src/lib/product-image-preflight'

const VALID_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const VALID_WEBP_BASE64 = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='
const jpegScanHeader = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]

function decodeBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function jpegWithDimensions(width: number, height: number, metadata = false) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, metadata ? 0xe1 : 0xe0, 0x00, 0x02,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    ...jpegScanHeader,
    0x11,
    0xff, 0xd9
  ])
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('local product image preflight', () => {
  it.each([
    { type: 'image/png', name: 'product.png', bytes: decodeBase64(VALID_PNG_BASE64) },
    { type: 'image/jpeg', name: 'product.jpg', bytes: jpegWithDimensions(1, 1) },
    { type: 'image/webp', name: 'product.webp', bytes: decodeBase64(VALID_WEBP_BASE64) }
  ])('accepts a bounded, metadata-safe $type file before upload', async ({ type, name, bytes }) => {
    await expect(preflightProductImage(new File([bytes], name, { type }))).resolves.toEqual({
      widthPx: 1,
      heightPx: 1
    })
  })

  it.each([
    new File([new Uint8Array([1, 2, 3, 4])], 'fake.png', { type: 'image/png' }),
    new File([jpegWithDimensions(1, 1, true)], 'metadata.jpg', { type: 'image/jpeg' }),
    new File([jpegWithDimensions(9_000, 4_000)], 'oversized.jpg', { type: 'image/jpeg' })
  ])('rejects malformed, private-metadata, or unsafe files locally', async (file) => {
    await expect(preflightProductImage(file)).rejects.toThrow(productImagePreflightInvalidMessage)
  })

  it('stops a stalled local file read at the bounded deadline', async () => {
    vi.useFakeTimers()
    const file = new File([decodeBase64(VALID_PNG_BASE64)], 'product.png', { type: 'image/png' })
    vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise<ArrayBuffer>(() => undefined))

    const preflight = preflightProductImage(file)
    const assertion = expect(preflight).rejects.toThrow(productImagePreflightUnavailableMessage)
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })
})
