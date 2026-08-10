import { afterEach, describe, expect, it, vi } from 'vitest'
import { logoutPasswordSession } from '../src/lib/password-logout-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('password logout client', () => {
  it('accepts only the canonical password logout response', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(logoutPasswordSession()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/logout')
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ method: 'POST', credentials: 'same-origin' })
  })

  it('rejects an expanded success envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ok: true,
      logoutUrl: 'https://example.invalid/logout'
    })))

    await expect(logoutPasswordSession()).rejects.toThrow(
      '未能確認登出狀態。 Unable to verify the logout state.'
    )
  })

  it('rejects a non-JSON success response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', {
      headers: { 'content-type': 'text/plain' }
    })))

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
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('synthetic network detail') }))

    await expect(logoutPasswordSession()).rejects.toThrow(
      '登出暫時無法完成，工作區仍保持登入。 Logout is temporarily unavailable; the workspace remains signed in.'
    )
  })
})
