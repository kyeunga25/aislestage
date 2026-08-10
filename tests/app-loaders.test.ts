import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCampaignPlan, initialCampaignAgentState } from '../src/lib/campaign-agent'
import { loadCampaignAgentSnapshot, loadCampaignAgentState } from '../src/lib/campaign-agent-loader'
import { loadGenerations, loadGenerationSnapshot } from '../src/lib/generation-loader'
import { loadPlatformStatus, loadSession } from '../src/lib/workspace-bootstrap-loader'

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

describe('workspace generation loading', () => {
  const canonicalGeneration = {
    id: 'generation-loader-test',
    campaignPackId: 'pack-loader-test',
    workflowId: 'store-main',
    aspectRatio: '1:1',
    status: 'completed',
    contentType: 'image/svg+xml',
    approvedRevision: 1,
    errorMessage: null,
    createdAt: '2026-08-10 12:00:00',
    reviewStatus: 'draft',
    reviewedAt: null,
    imageUrl: '/api/generations/generation-loader-test/image',
    downloadUrl: null,
    provenance: {
      approvedRevision: 1,
      compositionVersion: 'campaign-svg-v1',
      generationMode: 'deterministic'
    }
  }

  it('keeps an unavailable generation list distinct from a legitimate empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      code: 'unavailable',
      error: 'synthetic private storage detail'
    }, { status: 503 })))

    await expect(loadGenerations('workspace-availability-test')).rejects.toThrow(
      '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    )
  })

  it('returns no authoritative snapshot when the list is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      code: 'unavailable',
      error: 'synthetic private storage detail'
    }, { status: 503 })))

    await expect(loadGenerationSnapshot('workspace-snapshot-test')).resolves.toEqual({
      results: null,
      error: '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    })
  })

  it('accepts an explicit empty generation array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ generations: [] })))

    await expect(loadGenerations('workspace-empty-test')).resolves.toEqual([])
  })

  it('accepts and labels a canonical generation envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ generations: [canonicalGeneration] })))

    await expect(loadGenerations('workspace-canonical-test')).resolves.toEqual([{
      ...canonicalGeneration,
      title: '1:1 · 商店主圖'
    }])
  })

  it('rejects external download URLs in an otherwise successful generation list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      generations: [{
        ...canonicalGeneration,
        reviewStatus: 'approved',
        reviewedAt: '2026-08-10 12:01:00',
        downloadUrl: 'https://example.invalid/private-output.svg'
      }]
    })))

    await expect(loadGenerations('workspace-url-test')).rejects.toThrow(
      '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    )
  })

  it('rejects duplicate generation identities', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      generations: [canonicalGeneration, canonicalGeneration]
    })))

    await expect(loadGenerations('workspace-duplicate-test')).rejects.toThrow(
      '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    )
  })

  it('rejects a successful response that omits the generation array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))

    await expect(loadGenerations('workspace-malformed-test')).rejects.toThrow(
      '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    )
  })

  it('rejects an expanded generation-list envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      generations: [canonicalGeneration],
      privateCursor: 'synthetic-private-cursor'
    })))

    await expect(loadGenerations('workspace-expanded-test')).rejects.toThrow(
      '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    )
  })

  it('rejects a generation list with the wrong response media type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ generations: [] }), {
      headers: { 'content-type': 'text/plain' }
    })))

    await expect(loadGenerations('workspace-media-type-test')).rejects.toThrow(
      '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    )
  })

  it('rejects a generation list with a non-canonical success status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ generations: [] }, { status: 201 })))

    await expect(loadGenerations('workspace-status-test')).rejects.toThrow(
      '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    )
  })

  it('rejects a generation list whose streamed body exceeds the client limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `${' '.repeat(128 * 1024)}${JSON.stringify({ generations: [] })}`,
      { headers: { 'content-type': 'application/json' } }
    )))

    await expect(loadGenerations('workspace-oversized-test')).rejects.toThrow(
      '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    )
  })

  it('uses the bounded bilingual error when the request cannot reach the API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('synthetic network failure') }))

    await expect(loadGenerations('workspace-network-test')).rejects.toThrow(
      '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    )
  })

  it('returns no authoritative generation snapshot when the GET deadline expires', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchAfterDeadline(() => Response.json({ generations: [] })))

    const snapshot = loadGenerationSnapshot('workspace-timeout-test')
    const assertion = expect(snapshot).resolves.toEqual({
      results: null,
      error: '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })
})

describe('Campaign Agent state loading', () => {
  it('accepts an explicit valid Agent state', async () => {
    const state = initialCampaignAgentState()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ state })))

    await expect(loadCampaignAgentState()).resolves.toEqual(state)
  })

  it('accepts a canonical planned Agent state', async () => {
    const state = buildCampaignPlan({
      assetId: 'asset-loader-test',
      intent: '限時優惠',
      brand: {
        name: 'Test Brand',
        tone: '可信',
        colors: ['#155eef'],
        forbiddenWords: '',
        locale: 'zh-Hant',
        cta: '立即選購',
        ctaEn: 'Shop now'
      },
      product: {
        name: '測試商品',
        nameEn: 'Test product',
        category: '電子產品',
        benefits: ['已核實賣點一', '已核實賣點二'],
        benefitsEn: ['Verified benefit one', 'Verified benefit two'],
        specifications: '已核實規格',
        price: 'HK$399',
        promotion: '限時免運費',
        promotionEn: 'Free delivery for a limited time',
        channels: ['Web']
      }
    }, 1)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ state })))

    await expect(loadCampaignAgentState()).resolves.toEqual(state)
  })

  it('returns no authoritative Agent snapshot when the service is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: 'synthetic private Durable Object detail'
    }, { status: 503 })))

    await expect(loadCampaignAgentSnapshot()).resolves.toEqual({
      state: null,
      error: 'Campaign Agent 計劃暫時無法讀取。 Campaign Agent plan is temporarily unavailable.'
    })
  })

  it('rejects malformed Agent state instead of replacing the current plan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ state: { stage: 'idle' } })))

    await expect(loadCampaignAgentState()).rejects.toThrow(
      'Campaign Agent 計劃暫時無法讀取。 Campaign Agent plan is temporarily unavailable.'
    )
  })

  it('rejects an expanded Agent-state envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      state: initialCampaignAgentState(),
      durableObjectId: 'synthetic-private-object-id'
    })))

    await expect(loadCampaignAgentState()).rejects.toThrow(
      'Campaign Agent 計劃暫時無法讀取。 Campaign Agent plan is temporarily unavailable.'
    )
  })

  it('rejects Agent state with the wrong response media type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: initialCampaignAgentState() }), {
      headers: { 'content-type': 'text/plain' }
    })))

    await expect(loadCampaignAgentState()).rejects.toThrow(
      'Campaign Agent 計劃暫時無法讀取。 Campaign Agent plan is temporarily unavailable.'
    )
  })

  it('rejects Agent state with a non-canonical success status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      state: initialCampaignAgentState()
    }, { status: 201 })))

    await expect(loadCampaignAgentState()).rejects.toThrow(
      'Campaign Agent 計劃暫時無法讀取。 Campaign Agent plan is temporarily unavailable.'
    )
  })

  it('rejects Agent state whose streamed body exceeds the client limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `${' '.repeat(256 * 1024)}${JSON.stringify({ state: initialCampaignAgentState() })}`,
      { headers: { 'content-type': 'application/json' } }
    )))

    await expect(loadCampaignAgentState()).rejects.toThrow(
      'Campaign Agent 計劃暫時無法讀取。 Campaign Agent plan is temporarily unavailable.'
    )
  })

  it('returns no authoritative Agent snapshot when the GET deadline expires', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchAfterDeadline(() => Response.json({ state: initialCampaignAgentState() })))

    const snapshot = loadCampaignAgentSnapshot()
    const assertion = expect(snapshot).resolves.toEqual({
      state: null,
      error: 'Campaign Agent 計劃暫時無法讀取。 Campaign Agent plan is temporarily unavailable.'
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })
})

describe('workspace bootstrap loading', () => {
  const canonicalSession = {
    authenticated: true,
    user: {
      id: 'user-bootstrap-test',
      email: 'owner@example.test',
      name: '測試商戶',
      accountStatus: 'active',
      accountType: 'beta'
    },
    currentWorkspace: {
      id: 'workspace-bootstrap-test',
      name: '測試工作區',
      role: 'owner',
      accessStatus: 'active',
      availableOutputs: 6,
      reservedOutputs: 0
    }
  }
  const canonicalPlatformStatus = {
    status: 'ok',
    service: 'campaign-asset-worker',
    releaseMode: 'restricted',
    authMode: 'access',
    registrationMode: 'closed',
    registrationOpen: false,
    generationEnabled: false,
    generationMode: 'disabled',
    agentMode: 'deterministic'
  }

  it('accepts a canonical active session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(canonicalSession)))

    await expect(loadSession()).resolves.toEqual({
      session: {
        user: canonicalSession.user,
        currentWorkspace: canonicalSession.currentWorkspace
      },
      failure: null
    })
  })

  it('rejects an authenticated session with an unknown workspace role', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...canonicalSession,
      currentWorkspace: { ...canonicalSession.currentWorkspace, role: 'super-admin' }
    })))

    await expect(loadSession()).rejects.toThrow(
      '登入資料暫時無法確認。 Session data is temporarily unavailable.'
    )
  })

  it('rejects non-integer output allowance data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...canonicalSession,
      currentWorkspace: { ...canonicalSession.currentWorkspace, availableOutputs: '6' }
    })))

    await expect(loadSession()).rejects.toThrow(
      '登入資料暫時無法確認。 Session data is temporarily unavailable.'
    )
  })

  it('maps a non-success session response to a bounded supported reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      code: 'unavailable',
      error: 'synthetic private session detail'
    }, { status: 503 })))

    await expect(loadSession()).resolves.toEqual({ session: null, failure: 'unavailable' })
  })

  it('uses the bounded Access failure header without parsing the response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('synthetic private Access detail', {
      status: 403,
      headers: {
        'content-type': 'text/plain',
        'x-aislestage-access-failure': 'membership-required'
      }
    })))

    await expect(loadSession()).resolves.toEqual({ session: null, failure: 'membership-required' })
  })

  it('does not trust a body-only Access failure code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      authenticated: false,
      code: 'membership-required',
      error: 'synthetic private Access detail'
    }, { status: 403 })))

    await expect(loadSession()).resolves.toEqual({ session: null, failure: 'authentication-required' })
  })

  it('accepts the exact unauthenticated session envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ authenticated: false })))

    await expect(loadSession()).resolves.toEqual({ session: null, failure: 'authentication-required' })
  })

  it('rejects a successful session with the wrong response media type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(canonicalSession), {
      headers: { 'content-type': 'text/plain' }
    })))

    await expect(loadSession()).rejects.toThrow(
      '登入資料暫時無法確認。 Session data is temporarily unavailable.'
    )
  })

  it('rejects a session whose streamed body exceeds the client limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `${' '.repeat(16 * 1024)}${JSON.stringify(canonicalSession)}`,
      { headers: { 'content-type': 'application/json' } }
    )))

    await expect(loadSession()).rejects.toThrow(
      '登入資料暫時無法確認。 Session data is temporarily unavailable.'
    )
  })

  it('rejects session loading when the GET deadline expires', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchAfterDeadline(() => Response.json(canonicalSession)))

    const session = loadSession()
    const assertion = expect(session).rejects.toThrow(
      '登入資料暫時無法確認。 Session data is temporarily unavailable.'
    )
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })

  it('accepts a canonical restricted platform status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(canonicalPlatformStatus)))

    await expect(loadPlatformStatus()).resolves.toEqual(canonicalPlatformStatus)
  })

  it('rejects platform status with the wrong response media type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(canonicalPlatformStatus), {
      headers: { 'content-type': 'text/plain' }
    })))

    await expect(loadPlatformStatus()).rejects.toThrow(
      '平台狀態暫時無法確認。 Platform status is temporarily unavailable.'
    )
  })

  it('rejects platform status whose streamed body exceeds the client limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `${' '.repeat(4 * 1024)}${JSON.stringify(canonicalPlatformStatus)}`,
      { headers: { 'content-type': 'application/json' } }
    )))

    await expect(loadPlatformStatus()).rejects.toThrow(
      '平台狀態暫時無法確認。 Platform status is temporarily unavailable.'
    )
  })

  it('rejects platform status loading when the GET deadline expires', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchAfterDeadline(() => Response.json(canonicalPlatformStatus)))

    const status = loadPlatformStatus()
    const assertion = expect(status).rejects.toThrow(
      '平台狀態暫時無法確認。 Platform status is temporarily unavailable.'
    )
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })

  it('rejects contradictory Access registration state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...canonicalPlatformStatus,
      registrationMode: 'open',
      registrationOpen: false
    })))

    await expect(loadPlatformStatus()).rejects.toThrow(
      '平台狀態暫時無法確認。 Platform status is temporarily unavailable.'
    )
  })

  it('rejects contradictory generation availability state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...canonicalPlatformStatus,
      generationEnabled: true
    })))

    await expect(loadPlatformStatus()).rejects.toThrow(
      '平台狀態暫時無法確認。 Platform status is temporarily unavailable.'
    )
  })
})
