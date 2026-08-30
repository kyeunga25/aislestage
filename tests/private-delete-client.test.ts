import { afterEach, describe, expect, it, vi } from 'vitest'
import { deletePrivateResource } from '../src/lib/private-delete-client'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('private resource delete client', () => {
  const resourceId = '123e4567-e89b-42d3-a456-426614174000'

  it('deletes one product asset through the exact same-origin route', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(deletePrivateResource('product-asset', resourceId)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/assets/${resourceId}`)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE', credentials: 'same-origin' })
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('deletes one generation through the exact same-origin route', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(deletePrivateResource('generation', resourceId)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/generations/${resourceId}`)
  })

  it('deletes one saved brand pack through the exact same-origin route', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(deletePrivateResource('brand-pack', resourceId)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/brand-packs/${resourceId}`)
  })

  it('treats an authoritative not-found response as already absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'synthetic detail' }, { status: 404 })))

    await expect(deletePrivateResource('generation', resourceId)).resolves.toBeUndefined()
  })

  it('aborts an unresolved deletion at the endpoint deadline and preserves a retryable error', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const completion = setTimeout(() => resolve(new Response(null, { status: 204 })), 30_000)
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(completion)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const deletion = deletePrivateResource('product-asset', resourceId)
    const assertion = expect(deletion).rejects.toThrow(
      '商品圖片刪除暫時無法使用。 Product image deletion is temporarily unavailable.'
    )
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a non-canonical success status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ deleted: true })))

    await expect(deletePrivateResource('product-asset', resourceId)).rejects.toThrow(
      '未能確認商品圖片刪除結果。 Unable to verify the product image deletion.'
    )
  })

  it('does not expose a server error detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: 'synthetic private object key'
    }, { status: 503 })))

    await expect(deletePrivateResource('generation', resourceId)).rejects.toThrow(
      '私人輸出刪除暫時無法使用。 Private output deletion is temporarily unavailable.'
    )
  })

  it('reports a processing conflict without trusting the response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: 'synthetic internal queue detail'
    }, { status: 409 })))

    await expect(deletePrivateResource('generation', resourceId)).rejects.toThrow(
      '輸出仍在處理中，完成後才可刪除。 The output is still processing and can be deleted after completion.'
    )
  })

  it('rejects an unsafe identifier before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(deletePrivateResource('product-asset', '../private-object')).rejects.toThrow(
      '商品圖片識別資料無效，請重新載入。 Product image identity is invalid; reload it.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
