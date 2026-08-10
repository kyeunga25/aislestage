import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCampaignPlan } from '../src/lib/campaign-agent'
import { submitCampaignAgentAction, type CampaignAgentActionRequest } from '../src/lib/campaign-agent-client'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Campaign Agent action client', () => {
  const brief = {
    assetId: 'asset-agent-client-test',
    intent: '限時優惠',
    brand: {
      name: 'Test Brand',
      tone: '可信',
      colors: ['#155eef'],
      forbiddenWords: '',
      locale: 'zh-Hant' as const,
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
  }

  it('sends an exact plan body and accepts its canonical state', async () => {
    const state = buildCampaignPlan(brief, 1)
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ state }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitCampaignAgentAction({ action: 'plan', brief, currentRevision: 0 })).resolves.toEqual(state)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/campaign-agent/plan')
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ brief })
  })

  it('rejects duplicate plan identities in a successful response', async () => {
    const state = buildCampaignPlan(brief, 1)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      state: { ...state, plan: [state.plan[0], state.plan[0], state.plan[2]] }
    })))

    await expect(submitCampaignAgentAction({ action: 'plan', brief, currentRevision: 0 })).rejects.toThrow(
      'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'
    )
  })

  it('rejects a canonical action response with a non-canonical success status', async () => {
    const state = buildCampaignPlan(brief, 1)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ state }, { status: 201 })))

    await expect(submitCampaignAgentAction({ action: 'plan', brief, currentRevision: 0 })).rejects.toThrow(
      'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'
    )
  })

  it('rejects a canonical action response with the wrong response media type', async () => {
    const state = buildCampaignPlan(brief, 1)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state }), {
      headers: { 'content-type': 'text/plain' }
    })))

    await expect(submitCampaignAgentAction({ action: 'plan', brief, currentRevision: 0 })).rejects.toThrow(
      'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'
    )
  })

  it('rejects an action response whose streamed body exceeds the client limit', async () => {
    const state = buildCampaignPlan(brief, 1)
    const fetchMock = vi.fn(async () => new Response(
      `${' '.repeat(256 * 1024)}${JSON.stringify({ state })}`,
      { headers: { 'content-type': 'application/json' } }
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitCampaignAgentAction({ action: 'plan', brief, currentRevision: 0 })).rejects.toThrow(
      'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reconciles an ambiguous plan failure without sending a second plan mutation', async () => {
    const state = buildCampaignPlan(brief, 3)
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => init?.method === 'POST'
      ? Response.json({ error: 'synthetic Durable Object availability detail' }, { status: 503 })
      : Response.json({ state }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitCampaignAgentAction({ action: 'plan', brief, currentRevision: 2 })).resolves.toEqual(state)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/campaign-agent/plan',
      '/api/campaign-agent'
    ])
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
  })

  it('reconciles a plan deadline only when the same brief advanced beyond the submitted revision', async () => {
    vi.useFakeTimers()
    const state = buildCampaignPlan(brief, 2)
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== 'POST') return Promise.resolve(Response.json({ state }))
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const planning = submitCampaignAgentAction({ action: 'plan', brief, currentRevision: 1 })
    const assertion = expect(planning).resolves.toEqual(state)
    await vi.advanceTimersByTimeAsync(40_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('includes the complete plan response body in the deadline before reconciliation', async () => {
    vi.useFakeTimers()
    const state = buildCampaignPlan(brief, 1)
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== 'POST') return Response.json({ state })
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{'))
          init.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        }
      })
      return new Response(body, { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const planning = submitCampaignAgentAction({ action: 'plan', brief, currentRevision: 0 })
    const assertion = expect(planning).resolves.toEqual(state)
    await vi.advanceTimersByTimeAsync(40_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reconciles an immediate plan response stream failure without replaying the mutation', async () => {
    const state = buildCampaignPlan(brief, 1)
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== 'POST') return Response.json({ state })
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new TypeError('synthetic response stream failure'))
        }
      })
      return new Response(body, { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitCampaignAgentAction({ action: 'plan', brief, currentRevision: 0 })).resolves.toEqual(state)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/campaign-agent/plan',
      '/api/campaign-agent'
    ])
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
  })

  it('fails closed when plan reconciliation finds only the submitted revision', async () => {
    const state = buildCampaignPlan(brief, 2)
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => init?.method === 'POST'
      ? Response.json({ error: 'synthetic service detail' }, { status: 503 })
      : Response.json({ state }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitCampaignAgentAction({ action: 'plan', brief, currentRevision: 2 })).rejects.toThrow(
      'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
  })

  it('rejects a successful plan that did not advance beyond the submitted revision', async () => {
    const state = buildCampaignPlan(brief, 2)
    const fetchMock = vi.fn(async () => Response.json({ state }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitCampaignAgentAction({ action: 'plan', brief, currentRevision: 2 })).rejects.toThrow(
      'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('accepts an approval for the requested revision', async () => {
    const planned = buildCampaignPlan(brief, 1)
    const state = { ...planned, stage: 'approved' as const, approvedAt: '2026-08-10T12:00:00.000Z' }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ state, replayed: false })))

    await expect(submitCampaignAgentAction({ action: 'approve', revision: 1 })).resolves.toEqual(state)
  })

  it('retries one approval deadline with the same revision and accepts its replay', async () => {
    vi.useFakeTimers()
    const planned = buildCampaignPlan(brief, 1)
    const state = { ...planned, stage: 'approved' as const, approvedAt: '2026-08-10T12:00:00.000Z' }
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      if (fetchMock.mock.calls.length > 1) return Promise.resolve(Response.json({ state, replayed: true }))
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const approval = submitCampaignAgentAction({ action: 'approve', revision: 1 })
    const assertion = expect(approval).resolves.toEqual(state)
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => call[1]?.body)).toEqual([
      JSON.stringify({ revision: 1 }),
      JSON.stringify({ revision: 1 })
    ])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries an immediate approval response stream failure with the same revision', async () => {
    const planned = buildCampaignPlan(brief, 1)
    const state = { ...planned, stage: 'approved' as const, approvedAt: '2026-08-10T12:00:00.000Z' }
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      if (fetchMock.mock.calls.length > 1) return Response.json({ state, replayed: true })
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new TypeError('synthetic response stream failure'))
        }
      })
      return new Response(body, { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitCampaignAgentAction({ action: 'approve', revision: 1 })).resolves.toEqual(state)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => call[1]?.body)).toEqual([
      JSON.stringify({ revision: 1 }),
      JSON.stringify({ revision: 1 })
    ])
  })

  it('does not retry an approval conflict', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: 'synthetic revision detail' }, { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitCampaignAgentAction({ action: 'approve', revision: 1 })).rejects.toThrow(
      '計劃已更新，請核對最新版本後再批准。 The plan changed; review the latest revision before approving.'
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects an approval response that does not confirm the requested revision', async () => {
    const state = buildCampaignPlan(brief, 2)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      state: { ...state, stage: 'approved', approvedAt: '2026-08-10T12:00:00.000Z' },
      replayed: false
    })))

    await expect(submitCampaignAgentAction({ action: 'approve', revision: 1 })).rejects.toThrow(
      'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'
    )
  })

  it('does not expose a server error detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: 'synthetic private Durable Object detail'
    }, { status: 503 })))

    await expect(submitCampaignAgentAction({ action: 'plan', brief, currentRevision: 0 })).rejects.toThrow(
      'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'
    )
  })

  it('rejects an invalid brief before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitCampaignAgentAction({
      action: 'plan',
      currentRevision: 0,
      brief: { ...brief, privateNote: 'must-not-be-sent' }
    } as CampaignAgentActionRequest)).rejects.toThrow('Campaign Agent 請求格式無效。 Campaign Agent request is invalid.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid current plan revision before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitCampaignAgentAction({
      action: 'plan',
      currentRevision: -1,
      brief
    })).rejects.toThrow('Campaign Agent 請求格式無效。 Campaign Agent request is invalid.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
