import { afterEach, describe, expect, it, vi } from 'vitest'
import { submitPasswordAuth, type PasswordAuthRequest } from '../src/lib/password-auth-client'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('password authentication client', () => {
  const canonicalSession = {
    user: {
      id: 'user-auth-client-test',
      email: 'owner@example.test',
      name: '測試商戶',
      accountStatus: 'active',
      accountType: 'beta'
    },
    currentWorkspace: {
      id: 'workspace-auth-client-test',
      name: '測試工作區',
      role: 'owner',
      accessStatus: 'active',
      availableOutputs: 6,
      reservedOutputs: 0
    }
  }

  it('sends only login-required fields and accepts a canonical session', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json(canonicalSession))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitPasswordAuth({
      mode: 'login',
      email: 'owner@example.test',
      password: 'correct-password',
      name: '不應傳送的姓名',
      workspaceName: '不應傳送的工作區',
      inviteCode: 'should-not-be-sent'
    } as PasswordAuthRequest)).resolves.toEqual(canonicalSession)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/login')
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: 'owner@example.test',
      password: 'correct-password'
    })
  })

  it('normalizes registration fields and omits an unused invitation code', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json(canonicalSession, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await submitPasswordAuth({
      mode: 'register',
      name: '  測試商戶  ',
      workspaceName: '  測試工作區  ',
      email: '  OWNER@EXAMPLE.TEST  ',
      password: '  correct-password  '
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/register')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      name: '測試商戶',
      workspaceName: '測試工作區',
      email: 'owner@example.test',
      password: 'correct-password'
    })
  })

  it('rejects an invalid successful session envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...canonicalSession,
      currentWorkspace: { ...canonicalSession.currentWorkspace, role: 'super-admin' }
    })))

    await expect(submitPasswordAuth({
      mode: 'login',
      email: 'owner@example.test',
      password: 'correct-password'
    })).rejects.toThrow(
      '登入服務暫時無法使用。 Authentication service is temporarily unavailable.'
    )
  })

  it('rejects a successful session that does not match the submitted login identity', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      ...canonicalSession,
      user: { ...canonicalSession.user, email: 'other@example.test' }
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitPasswordAuth({
      mode: 'login',
      email: 'owner@example.test',
      password: 'correct-password'
    })).rejects.toThrow(
      '登入服務暫時無法使用。 Authentication service is temporarily unavailable.'
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects a canonical session returned with the wrong authentication status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(canonicalSession, { status: 201 })))

    await expect(submitPasswordAuth({
      mode: 'login',
      email: 'owner@example.test',
      password: 'correct-password'
    })).rejects.toThrow(
      '登入服務暫時無法使用。 Authentication service is temporarily unavailable.'
    )
  })

  it('requires the canonical registration status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(canonicalSession)))

    await expect(submitPasswordAuth({
      mode: 'register',
      name: '測試商戶',
      workspaceName: '測試工作區',
      email: 'owner@example.test',
      password: 'correct-password'
    })).rejects.toThrow(
      '登入服務暫時無法使用。 Authentication service is temporarily unavailable.'
    )
  })

  it('rejects a canonical session returned with the wrong response media type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(canonicalSession), {
      headers: { 'content-type': 'text/plain' }
    })))

    await expect(submitPasswordAuth({
      mode: 'login',
      email: 'owner@example.test',
      password: 'correct-password'
    })).rejects.toThrow(
      '登入服務暫時無法使用。 Authentication service is temporarily unavailable.'
    )
  })

  it('rejects an authentication response whose streamed body exceeds the client limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `${' '.repeat(16 * 1024)}${JSON.stringify(canonicalSession)}`,
      { headers: { 'content-type': 'application/json' } }
    )))

    await expect(submitPasswordAuth({
      mode: 'login',
      email: 'owner@example.test',
      password: 'correct-password'
    })).rejects.toThrow(
      '登入服務暫時無法使用。 Authentication service is temporarily unavailable.'
    )
  })

  it('does not expose a server error detail to the form', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: 'synthetic private database detail'
    }, { status: 503 })))

    await expect(submitPasswordAuth({
      mode: 'login',
      email: 'owner@example.test',
      password: 'correct-password'
    })).rejects.toThrow(
      '登入服務暫時無法使用。 Authentication service is temporarily unavailable.'
    )
  })

  it('reconciles a login deadline through the same-email session without resending the password', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === '/api/session') {
        return Promise.resolve(Response.json({ authenticated: true, ...canonicalSession }))
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const authentication = submitPasswordAuth({
      mode: 'login',
      email: 'owner@example.test',
      password: 'correct-password'
    })
    const assertion = expect(authentication).resolves.toEqual(canonicalSession)
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('includes the complete authentication response body in the deadline before reconciliation', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === '/api/session') {
        return Response.json({ authenticated: true, ...canonicalSession })
      }
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

    const authentication = submitPasswordAuth({
      mode: 'login',
      email: 'owner@example.test',
      password: 'correct-password'
    })
    const assertion = expect(authentication).resolves.toEqual(canonicalSession)
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reconciles a registration response stream failure against the exact owner identity', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (String(input) === '/api/session') {
        return Response.json({ authenticated: true, ...canonicalSession })
      }
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new TypeError('synthetic authentication response stream failure'))
        }
      }), { status: 201, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitPasswordAuth({
      mode: 'register',
      name: '測試商戶',
      workspaceName: '測試工作區',
      email: 'owner@example.test',
      password: 'correct-password'
    })).resolves.toEqual(canonicalSession)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
  })

  it('fails closed when registration reconciliation returns a different workspace identity', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => String(input) === '/api/session'
      ? Response.json({
          authenticated: true,
          ...canonicalSession,
          currentWorkspace: { ...canonicalSession.currentWorkspace, name: '其他工作區' }
        })
      : Response.json({ error: 'synthetic registration state detail' }, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitPasswordAuth({
      mode: 'register',
      name: '測試商戶',
      workspaceName: '測試工作區',
      email: 'owner@example.test',
      password: 'correct-password'
    })).rejects.toThrow(
      '登入服務暫時無法使用。 Authentication service is temporarily unavailable.'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
  })

  it('does not reconcile invalid credentials', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: 'synthetic credential detail' }, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitPasswordAuth({
      mode: 'login',
      email: 'owner@example.test',
      password: 'incorrect-password'
    })).rejects.toThrow('電郵或密碼不正確。 Email or password is incorrect.')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects oversized fields before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitPasswordAuth({
      mode: 'login',
      email: 'owner@example.test',
      password: 'x'.repeat(257)
    })).rejects.toThrow('請核對登入資料。 Please check the submitted details.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
