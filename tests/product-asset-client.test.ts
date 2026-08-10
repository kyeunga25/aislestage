import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadProductAsset } from '../src/lib/product-asset-client'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
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

  beforeEach(() => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(assetId)
  })

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
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('idempotency-key')).toBe(assetId)
  })

  it('rejects an asset identity that is not bound to the upload idempotency key', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'product.png', { type: 'image/png' })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      asset: { ...canonicalAsset, id: '223e4567-e89b-42d3-a456-426614174000', previewUrl: '/api/assets/223e4567-e89b-42d3-a456-426614174000' }
    }, { status: 201 })))

    await expect(uploadProductAsset(file)).rejects.toThrow(
      '未能確認商品圖片上載結果。 Unable to verify the product image upload.'
    )
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

  it('rejects an upload response whose streamed body exceeds the client limit', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'product.png', { type: 'image/png' })
    const fetchMock = vi.fn(async () => new Response(
      `${' '.repeat(4 * 1024)}${JSON.stringify({ asset: canonicalAsset })}`,
      { status: 201, headers: { 'content-type': 'application/json' } }
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadProductAsset(file)).rejects.toThrow(
      '未能確認商品圖片上載結果。 Unable to verify the product image upload.'
    )
    expect(fetchMock).toHaveBeenCalledOnce()
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

  it('maps an idempotency conflict to a fixed retry message', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'product.png', { type: 'image/png' })
    const fetchMock = vi.fn(async () => Response.json({
      error: 'synthetic private idempotency detail'
    }, { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadProductAsset(file)).rejects.toThrow(
      '商品圖片上載識別資料已被使用，請重新選擇圖片。 Product image upload identity was already used; select the image again.'
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('retries a transport deadline once with the same upload identity', async () => {
    vi.useFakeTimers()
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'product.png', { type: 'image/png' })
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      if (fetchMock.mock.calls.length > 1) return Promise.resolve(Response.json({ asset: canonicalAsset }, { status: 201 }))
      return new Promise<Response>((resolve, reject) => {
        const completion = setTimeout(() => resolve(Response.json({ asset: canonicalAsset }, { status: 201 })), 90_000)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(completion)
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const upload = uploadProductAsset(file)
    const assertion = expect(upload).resolves.toEqual(canonicalAsset)
    await vi.advanceTimersByTimeAsync(90_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => new Headers(call[1]?.headers).get('idempotency-key'))).toEqual([assetId, assetId])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries when response headers arrive but the success body stalls until the deadline', async () => {
    vi.useFakeTimers()
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'product.png', { type: 'image/png' })
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (fetchMock.mock.calls.length > 1) return Response.json({ asset: canonicalAsset }, { status: 201 })
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{'))
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        }
      })
      return new Response(body, { status: 201, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const upload = uploadProductAsset(file)
    const assertion = expect(upload).resolves.toEqual(canonicalAsset)
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => new Headers(call[1]?.headers).get('idempotency-key'))).toEqual([assetId, assetId])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries one server-unavailable response with the same upload identity', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'product.png', { type: 'image/png' })
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => fetchMock.mock.calls.length === 1
      ? Response.json({ error: 'synthetic temporary failure' }, { status: 503 })
      : Response.json({ asset: canonicalAsset }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadProductAsset(file)).resolves.toEqual(canonicalAsset)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => new Headers(call[1]?.headers).get('idempotency-key'))).toEqual([assetId, assetId])
  })

  it('stops after two transport deadlines and clears both attempt timers', async () => {
    vi.useFakeTimers()
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'product.png', { type: 'image/png' })
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const upload = uploadProductAsset(file)
    const assertion = expect(upload).rejects.toThrow(
      '商品圖片上載暫時無法使用。 Product image upload is temporarily unavailable.'
    )
    await vi.advanceTimersByTimeAsync(90_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => new Headers(call[1]?.headers).get('idempotency-key'))).toEqual([assetId, assetId])
    expect(vi.getTimerCount()).toBe(0)
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
