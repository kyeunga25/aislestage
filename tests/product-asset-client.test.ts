import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadProductAsset } from '../src/lib/product-asset-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('product asset upload client', () => {
  const assetId = '123e4567-e89b-42d3-a456-426614174000'
  const canonicalAsset = {
    id: assetId,
    name: 'product-image.png',
    contentType: 'image/png',
    sizeBytes: 4,
    previewUrl: `/api/assets/${assetId}`
  }

  it('accepts a canonical asset and replaces the transmitted original filename', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'private-original-name.png', { type: 'image/png' })
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ asset: canonicalAsset }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadProductAsset(file)).resolves.toEqual(canonicalAsset)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/assets/product')
    const body = fetchMock.mock.calls[0]?.[1]?.body
    expect(body).toBeInstanceOf(FormData)
    expect([...((body as FormData).keys())]).toEqual(['file'])
    const transmitted = (body as FormData).get('file')
    expect(transmitted).toBeInstanceOf(File)
    expect((transmitted as File).name).toBe('product-image.png')
    expect((transmitted as File).type).toBe(file.type)
    expect(new Uint8Array(await (transmitted as File).arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()))
  })

  it('rejects an external preview URL', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'product.png', { type: 'image/png' })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      asset: { ...canonicalAsset, previewUrl: 'https://example.invalid/private-image.png' }
    }, { status: 201 })))

    await expect(uploadProductAsset(file)).rejects.toThrow(
      '未能確認商品圖片上載結果。 Unable to verify the product image upload.'
    )
  })

  it('rejects asset metadata that does not match the uploaded file', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'product.png', { type: 'image/png' })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      asset: { ...canonicalAsset, contentType: 'image/jpeg' }
    }, { status: 201 })))

    await expect(uploadProductAsset(file)).rejects.toThrow(
      '未能確認商品圖片上載結果。 Unable to verify the product image upload.'
    )
  })

  it('rejects a canonical asset returned with a non-canonical success status', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'product.png', { type: 'image/png' })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ asset: canonicalAsset })))

    await expect(uploadProductAsset(file)).rejects.toThrow(
      '未能確認商品圖片上載結果。 Unable to verify the product image upload.'
    )
  })

  it('does not expose a server error detail', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'product.png', { type: 'image/png' })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: 'synthetic private object storage detail'
    }, { status: 503 })))

    await expect(uploadProductAsset(file)).rejects.toThrow(
      '商品圖片上載暫時無法使用。 Product image upload is temporarily unavailable.'
    )
  })

  it('rejects an unsupported file before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'product.gif', { type: 'image/gif' })

    await expect(uploadProductAsset(file)).rejects.toThrow(
      '只支援 PNG、JPEG 或靜態 WebP 圖片。 Only PNG, JPEG, or static WebP images are supported.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
