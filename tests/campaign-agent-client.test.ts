import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCampaignPlan } from '../src/lib/campaign-agent'
import { submitCampaignAgentAction, type CampaignAgentActionRequest } from '../src/lib/campaign-agent-client'

afterEach(() => {
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

    await expect(submitCampaignAgentAction({ action: 'plan', brief })).resolves.toEqual(state)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/campaign-agent/plan')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ brief })
  })

  it('rejects duplicate plan identities in a successful response', async () => {
    const state = buildCampaignPlan(brief, 1)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      state: { ...state, plan: [state.plan[0], state.plan[0], state.plan[2]] }
    })))

    await expect(submitCampaignAgentAction({ action: 'plan', brief })).rejects.toThrow(
      'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'
    )
  })

  it('rejects a canonical action response with a non-canonical success status', async () => {
    const state = buildCampaignPlan(brief, 1)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ state }, { status: 201 })))

    await expect(submitCampaignAgentAction({ action: 'plan', brief })).rejects.toThrow(
      'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'
    )
  })

  it('rejects a canonical action response with the wrong response media type', async () => {
    const state = buildCampaignPlan(brief, 1)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state }), {
      headers: { 'content-type': 'text/plain' }
    })))

    await expect(submitCampaignAgentAction({ action: 'plan', brief })).rejects.toThrow(
      'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'
    )
  })

  it('rejects an action response whose streamed body exceeds the client limit', async () => {
    const state = buildCampaignPlan(brief, 1)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `${' '.repeat(256 * 1024)}${JSON.stringify({ state })}`,
      { headers: { 'content-type': 'application/json' } }
    )))

    await expect(submitCampaignAgentAction({ action: 'plan', brief })).rejects.toThrow(
      'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'
    )
  })

  it('accepts an approval for the requested revision', async () => {
    const planned = buildCampaignPlan(brief, 1)
    const state = { ...planned, stage: 'approved' as const, approvedAt: '2026-08-10T12:00:00.000Z' }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ state, replayed: false })))

    await expect(submitCampaignAgentAction({ action: 'approve', revision: 1 })).resolves.toEqual(state)
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

    await expect(submitCampaignAgentAction({ action: 'plan', brief })).rejects.toThrow(
      'Campaign Agent 暫時未能完成這個動作。 Campaign Agent action is temporarily unavailable.'
    )
  })

  it('rejects an invalid brief before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitCampaignAgentAction({
      action: 'plan',
      brief: { ...brief, privateNote: 'must-not-be-sent' }
    } as CampaignAgentActionRequest)).rejects.toThrow('Campaign Agent 請求格式無效。 Campaign Agent request is invalid.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
