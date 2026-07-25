import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICampaignPlanningProvider } from '../src/lib/providers'
import type { CampaignBrief } from '../src/lib/types'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('assisted provider privacy boundary', () => {
  it('does not send the private asset identifier to the planning provider', async () => {
    let requestBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestBody = String(init?.body || '')
      return Response.json({
        output_text: JSON.stringify({
          summary: 'Bounded plan',
          recommendations: [
            { id: 'store-main', rationale: 'Store layout' },
            { id: 'social-ad', rationale: 'Feed layout' },
            { id: 'story', rationale: 'Story layout' }
          ]
        })
      })
    }))

    const brief: CampaignBrief = {
      assetId: 'private-asset-marker',
      intent: '新品介紹',
      brand: { name: 'Test Brand', tone: 'clear', colors: ['#155eef'], forbiddenWords: '', locale: 'zh-Hant', cta: '立即查看' },
      product: { name: 'Test Product', category: 'test', benefits: ['Feature A', 'Feature B'], specifications: 'Spec', price: 'HK$100', promotion: 'Test offer', channels: ['web'] }
    }

    await new OpenAICampaignPlanningProvider('test-key').createPlan(brief)

    expect(requestBody).not.toContain('private-asset-marker')
    expect(requestBody).toContain('Test Product')
  })
})
