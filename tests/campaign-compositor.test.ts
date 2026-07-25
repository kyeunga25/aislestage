import { describe, expect, it } from 'vitest'
import { composeCampaignSvg, validateCompositionInput } from '../src/lib/campaign-compositor'
import type { GenerationInput } from '../src/lib/types'

function input(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    workspaceId: 'workspace-test',
    workflowId: 'store-main',
    aspectRatio: '1:1',
    approvedRevision: 1,
    intent: '限時優惠',
    brand: { name: 'Test Brand', tone: 'clean', colors: ['#155eef'], forbiddenWords: '', locale: 'zh-Hant', cta: '立即選購', ctaEn: 'Shop now' },
    product: {
      name: 'MiniBeat 喇叭',
      nameEn: 'MiniBeat Speaker',
      category: 'electronics',
      benefits: ['輕巧隨行', '12 小時播放', '清晰立體聲'],
      benefitsEn: ['Compact and portable', '12-hour playback', 'Clear stereo sound'],
      specifications: 'Bluetooth 5.3 · USB-C',
      price: 'HK$399',
      promotion: '限時免運費',
      promotionEn: 'Free delivery for a limited time',
      channels: ['web']
    },
    referenceImageUrls: [],
    referenceAssetIds: ['asset-test'],
    ...overrides
  }
}

describe('deterministic Campaign Pack composition', () => {
  it('keeps verified mixed-language copy intact and escapes SVG markup', () => {
    const safeInput = input({ product: { ...input().product, name: 'Mini & 喇叭' } })
    expect(validateCompositionInput(safeInput)).toEqual([])
    const svg = composeCampaignSvg({ input: safeInput, source: { base64: 'iVBORw0KGgo=', contentType: 'image/png' } })
    expect(svg).toContain('Mini &amp; 喇叭')
    expect(svg).toContain('Bluetooth 5.3 · USB-C')
    expect(svg).not.toContain('Bluet</tspan>')
    expect(svg).toContain('data:image/png;base64,iVBORw0KGgo=')
  })

  it('rejects copy that cannot fit the narrowest approved layout', () => {
    const unsafe = input({ brand: { ...input().brand, cta: '這是一個不能安全放入按鈕的超長行動呼籲' } })
    expect(validateCompositionInput(unsafe)).toContain('CTA 超出素材安全區。')
  })
})
