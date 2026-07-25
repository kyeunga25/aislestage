import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICampaignPlanningProvider, OpenAICopyProvider } from '../src/lib/providers'
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
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'output_text',
            text: JSON.stringify({
              summary: 'Bounded plan',
              recommendations: [
                { id: 'store-main', rationale: 'Store layout' },
                { id: 'social-ad', rationale: 'Feed layout' },
                { id: 'story', rationale: 'Story layout' }
              ]
            })
          }]
        }]
      })
    }))

    const brief: CampaignBrief = {
      assetId: 'private-asset-marker',
      intent: '新品介紹',
      brand: { name: 'Test Brand', tone: 'clear', colors: ['#155eef'], forbiddenWords: '', locale: 'zh-Hant', cta: '立即查看', ctaEn: 'View now' },
      product: { name: 'Test Product', nameEn: 'Test Product', category: 'test', benefits: ['Feature A', 'Feature B'], benefitsEn: ['Feature A', 'Feature B'], specifications: 'Spec', price: 'HK$100', promotion: '測試優惠', promotionEn: 'Test offer', channels: ['web'] }
    }

    await new OpenAICampaignPlanningProvider('test-key').createPlan(brief)

    expect(requestBody).not.toContain('private-asset-marker')
    expect(requestBody).toContain('Test Product')
    expect(requestBody).toContain('gpt-5.6-terra')
  })

  it('rejects an incomplete structured plan instead of trusting an unchecked cast', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ summary: 'Incomplete', recommendations: [] }) }] }]
    })))
    const brief: CampaignBrief = {
      assetId: null,
      intent: '新品介紹',
      brand: { name: 'Test Brand', tone: 'clear', colors: ['#155eef'], forbiddenWords: '', locale: 'zh-Hant', cta: '立即查看', ctaEn: 'View now' },
      product: { name: 'Test Product', nameEn: 'Test Product', category: 'test', benefits: ['Feature A', 'Feature B'], benefitsEn: ['Feature A', 'Feature B'], specifications: 'Spec', price: 'HK$100', promotion: '測試優惠', promotionEn: 'Test offer', channels: ['web'] }
    }

    await expect(new OpenAICampaignPlanningProvider('test-key').createPlan(brief)).rejects.toThrow('campaign plan is invalid')
  })

  it('extracts copy from the raw Responses API message shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify({ imagePrompt: 'Clean studio background', headline: 'Exact headline', body: 'Exact body', hashtags: ['#test'], cta: 'Shop now' }) }]
      }]
    })))

    const copy = await new OpenAICopyProvider('test-key').createCopy({
      brand: { name: 'Test Brand', tone: 'clear', colors: ['#155eef'], forbiddenWords: '', locale: 'zh-Hant', cta: '立即查看', ctaEn: 'View now' },
      product: { name: 'Test Product', nameEn: 'Test Product', category: 'test', benefits: ['Feature A', 'Feature B'], benefitsEn: ['Feature A', 'Feature B'], specifications: 'Spec', price: 'HK$100', promotion: '測試優惠', promotionEn: 'Test offer', channels: ['web'] },
      workflowTitle: '商品主圖',
      aspectRatio: '1:1'
    })

    expect(copy).toMatchObject({ imagePrompt: 'Clean studio background', cta: 'Shop now' })
  })
})
