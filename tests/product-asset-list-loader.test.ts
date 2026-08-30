import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadProductAssetList,
  loadProductAssetListSnapshot,
  productAssetListUnavailableMessage
} from '../src/lib/product-asset-list-loader'

const canonicalAsset = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  name: 'product-image.png',
  contentType: 'image/png',
  sizeBytes: 1024,
  widthPx: 1024,
  heightPx: 1024,
  previewUrl: '/api/assets/123e4567-e89b-42d3-a456-426614174000',
  createdAt: '2026-08-30T05:00:00Z'
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function fetchAfterDeadline(response: () => Response) {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const completion = setTimeout(() => resolve(response()), 30_000)
    init?.signal?.addEventListener('abort', () => {
      clearTimeout(completion)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  }))
}

describe('product asset list loader', () => {
  it('accepts an exact canonical private source envelope', async () => {
    const fetchMock = vi.fn(async () => Response.json({ assets: [canonicalAsset] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadProductAssetList()).resolves.toEqual([canonicalAsset])
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/product', expect.objectContaining({
      credentials: 'same-origin',
      signal: expect.any(AbortSignal)
    }))
  })

  it('accepts a legacy source whose verified dimensions were not recorded', async () => {
    const legacyAsset = { ...canonicalAsset, widthPx: null, heightPx: null }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ assets: [legacyAsset] })))

    await expect(loadProductAssetList()).resolves.toEqual([legacyAsset])
  })

  it.each([
    { assets: [{ ...canonicalAsset, objectKey: 'private-object' }] },
    { assets: [{ ...canonicalAsset, id: 'not-a-uuid' }] },
    { assets: [{ ...canonicalAsset, name: 'original-private-name.png' }] },
    { assets: [{ ...canonicalAsset, contentType: 'image/gif' }] },
    { assets: [{ ...canonicalAsset, sizeBytes: 0 }] },
    { assets: [{ ...canonicalAsset, widthPx: null }] },
    { assets: [{ ...canonicalAsset, heightPx: null }] },
    { assets: [{ ...canonicalAsset, widthPx: 8193, heightPx: 1 }] },
    { assets: [{ ...canonicalAsset, widthPx: 8000, heightPx: 5000 }] },
    { assets: [{ ...canonicalAsset, widthPx: 1024.5 }] },
    { assets: [{ ...canonicalAsset, previewUrl: 'https://example.test/private.png' }] },
    { assets: [{ ...canonicalAsset, createdAt: '2026-02-31T05:00:00Z' }] },
    { assets: [canonicalAsset, canonicalAsset] },
    { assets: Array.from({ length: 21 }, (_, index) => ({ ...canonicalAsset, id: `123e4567-e89b-42d3-a456-${index.toString().padStart(12, '0')}` })) },
    { assets: [], cursor: 'private-cursor' }
  ])('rejects malformed or expanded product source data %#', async (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)))
    await expect(loadProductAssetList()).rejects.toThrow(productAssetListUnavailableMessage)
  })

  it('rejects non-canonical status, media type, and oversized bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'private D1 detail' }, { status: 503 })))
    await expect(loadProductAssetList()).rejects.toThrow(productAssetListUnavailableMessage)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ assets: [] }), {
      headers: { 'content-type': 'text/plain' }
    })))
    await expect(loadProductAssetList()).rejects.toThrow(productAssetListUnavailableMessage)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `${' '.repeat(64 * 1024)}${JSON.stringify({ assets: [] })}`,
      { headers: { 'content-type': 'application/json' } }
    )))
    await expect(loadProductAssetList()).rejects.toThrow(productAssetListUnavailableMessage)
  })

  it('keeps the prior snapshot authoritative when the deadline expires', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchAfterDeadline(() => Response.json({ assets: [] })))

    const snapshot = loadProductAssetListSnapshot()
    const assertion = expect(snapshot).resolves.toEqual({
      assets: null,
      error: productAssetListUnavailableMessage
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })
})
