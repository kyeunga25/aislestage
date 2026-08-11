import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout } from '../src/lib/fetch-with-timeout'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('fetch timeout boundary', () => {
  it('returns a response completed before the deadline and clears its timer', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })))

    await expect(fetchWithTimeout(
      '/api/test',
      { credentials: 'same-origin' },
      15_000,
      async (response) => response
    )).resolves.toBeInstanceOf(Response)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts a pending request at the deadline', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const completion = setTimeout(() => resolve(Response.json({ ok: true })), 30_000)
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(completion)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })))

    const request = fetchWithTimeout(
      '/api/test',
      { credentials: 'same-origin' },
      15_000,
      async (response) => response
    )
    const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects an invalid timeout before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchWithTimeout('/api/test', undefined, 0, async (response) => response)).rejects.toThrow('Invalid fetch timeout')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the deadline active while the response body is being consumed', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{'))
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        }
      })
      return new Response(body, { headers: { 'content-type': 'application/json' } })
    }))

    const request = fetchWithTimeout(
      '/api/test',
      { credentials: 'same-origin' },
      15_000,
      async (response) => response.text()
    )
    const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })
})
