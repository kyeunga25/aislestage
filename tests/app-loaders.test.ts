import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCampaignPlan, initialCampaignAgentState } from '../src/lib/campaign-agent'
import { loadCampaignAgentSnapshot, loadCampaignAgentState } from '../src/lib/campaign-agent-loader'
import { loadGenerations, loadGenerationSnapshot } from '../src/lib/generation-loader'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workspace generation loading', () => {
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

  it('rejects a successful response that omits the generation array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))

    await expect(loadGenerations('workspace-malformed-test')).rejects.toThrow(
      '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    )
  })

  it('uses the bounded bilingual error when the request cannot reach the API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('synthetic network failure') }))

    await expect(loadGenerations('workspace-network-test')).rejects.toThrow(
      '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    )
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
})
