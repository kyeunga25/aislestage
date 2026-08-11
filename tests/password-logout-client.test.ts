import { afterEach, describe, expect, it, vi } from 'vitest'
import { logoutPasswordSession } from '../src/lib/password-logout-client'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('password logout client', () => {
  it('accepts only the canonical password logout response', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(logoutPasswordSession()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/logout')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('rejects an expanded success envelope', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      ok: true,
      logoutUrl: 'https://example.invalid/logout'
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(logoutPasswordSession()).rejects.toThrow(
      '未能確認登出狀態。 Unable to verify the logout state.'
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects a non-JSON success response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', {
      headers: { 'content-type': 'text/plain' }
    })))

    await expect(logoutPasswordSession()).rejects.toThrow(
      '未能確認登出狀態。 Unable to verify the logout state.'
    )
  })

  it('rejects a logout response whose streamed body exceeds the client limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `${' '.repeat(1024)}${JSON.stringify({ ok: true })}`,
      { headers: { 'content-type': 'application/json' } }
    )))

    await expect(logoutPasswordSession()).rejects.toThrow(
      '未能確認登出狀態。 Unable to verify the logout state.'
    )
  })

  it('does not expose a server error detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: 'synthetic session token hash detail'
    }, { status: 503 })))

    await expect(logoutPasswordSession()).rejects.toThrow(
      '登出暫時無法完成，工作區仍保持登入。 Logout is temporarily unavailable; the workspace remains signed in.'
    )
  })

  it('retains a retryable failure when the request cannot complete', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('synthetic network detail') })
    vi.stubGlobal('fetch', fetchMock)

    await expect(logoutPasswordSession()).rejects.toThrow(
      '登出暫時無法完成，工作區仍保持登入。 Logout is temporarily unavailable; the workspace remains signed in.'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries one request deadline before accepting the canonical response', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      if (fetchMock.mock.calls.length > 1) return Promise.resolve(Response.json({ ok: true }))
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const logout = logoutPasswordSession()
    const assertion = expect(logout).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every((call) => call[0] === '/api/auth/logout')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries when response headers arrive but the canonical body stalls', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (fetchMock.mock.calls.length > 1) return Response.json({ ok: true })
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{'))
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        }
      })
      return new Response(body, { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const logout = logoutPasswordSession()
    const assertion = expect(logout).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries an immediate logout response stream failure with the same cookie context', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      if (fetchMock.mock.calls.length > 1) return Response.json({ ok: true })
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new TypeError('synthetic response stream failure'))
        }
      })
      return new Response(body, { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(logoutPasswordSession()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every((call) => call[0] === '/api/auth/logout')).toBe(true)
    expect(fetchMock.mock.calls.every((call) => call[1]?.credentials === 'same-origin')).toBe(true)
  })

  it('retries one server-unavailable response', async () => {
    const fetchMock = vi.fn(async () => fetchMock.mock.calls.length === 1
      ? Response.json({ error: 'synthetic temporary failure' }, { status: 503 })
      : Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(logoutPasswordSession()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not replay an authorization failure', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      error: 'synthetic authorization detail'
    }, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(logoutPasswordSession()).rejects.toThrow(
      '登出暫時無法完成，工作區仍保持登入。 Logout is temporarily unavailable; the workspace remains signed in.'
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('stops after two deadlines and clears both attempt timers', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const logout = logoutPasswordSession()
    const assertion = expect(logout).rejects.toThrow(
      '登出暫時無法完成，工作區仍保持登入。 Logout is temporarily unavailable; the workspace remains signed in.'
    )
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
