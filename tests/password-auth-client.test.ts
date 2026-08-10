import { afterEach, describe, expect, it, vi } from 'vitest'
import { submitPasswordAuth, type PasswordAuthRequest } from '../src/lib/password-auth-client'

afterEach(() => {
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
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: 'owner@example.test',
      password: 'correct-password'
    })
  })

  it('normalizes registration fields and omits an unused invitation code', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json(canonicalSession))
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
