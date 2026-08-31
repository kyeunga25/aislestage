import { describe, expect, it } from 'vitest'
import { composeCampaignSvg, validateCompositionInput } from '../src/lib/campaign-compositor'
import { wrapCampaignText } from '../src/lib/campaign-copy'
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
    expect(validateCompositionInput(unsafe)).toEqual(expect.arrayContaining([expect.stringContaining('CTA 超出素材安全區。')]))
  })

  it('rejects unsafe brand colors and keeps them out of composed SVG attributes', () => {
    const unsafe = input({ brand: { ...input().brand, colors: ['url(//example.test/color)'] } })
    expect(validateCompositionInput(unsafe)).toEqual(expect.arrayContaining([
      expect.stringMatching(/品牌顏色.*#RRGGBB|brand color.*#RRGGBB/i)
    ]))
    const svg = composeCampaignSvg({ input: unsafe, source: { base64: 'iVBORw0KGgo=', contentType: 'image/png' } })
    expect(svg).not.toContain('example.test')
    expect(svg).toContain('#155eef')
  })

  it('blocks configured forbidden terms across Chinese and English commercial copy', () => {
    const chinese = input({
      brand: { ...input().brand, forbiddenWords: '最平、保證' },
      product: { ...input().product, promotion: '保證耐用' }
    })
    const english = input({
      brand: { ...input().brand, forbiddenWords: 'guaranteed; risk-free' },
      product: { ...input().product, promotionEn: 'Guaranteed delivery' }
    })
    const issue = /限制字詞.*商業文案|forbidden words.*commercial copy/i

    expect(validateCompositionInput(chinese)).toEqual(expect.arrayContaining([expect.stringMatching(issue)]))
    expect(validateCompositionInput(english)).toEqual(expect.arrayContaining([expect.stringMatching(issue)]))
    expect(validateCompositionInput(input({ brand: { ...input().brand, forbiddenWords: '保證' } }))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(issue)])
    )
  })

  it('rejects fragmented detail copy that exceeds one ratio line budget', () => {
    const fragmented = input({
      workflowId: 'promo-poster',
      aspectRatio: '9:16',
      product: {
        ...input().product,
        benefits: ['A'.repeat(24), 'B'.repeat(24), 'C'.repeat(24)],
        specifications: `${'D'.repeat(24)} ${'E'.repeat(24)}`
      }
    })

    expect(() => composeCampaignSvg({ input: fragmented, source: { base64: 'iVBORw0KGgo=', contentType: 'image/png' } })).toThrow('Commercial text exceeds the deterministic composition safe area.')
    expect(validateCompositionInput(fragmented)).toEqual(expect.arrayContaining([expect.stringContaining('商品賣點與規格超出素材安全區。')]))
  })

  it('breaks an unspaced product identifier without losing exact characters', () => {
    const identifier = 'ABCDEFGHIJKLMNOPQR'
    const safeInput = input({ product: { ...input().product, name: identifier } })

    expect(validateCompositionInput(safeInput)).toEqual([])
    expect(wrapCampaignText(identifier, 5, 2)).toEqual(['ABCDEFGHI', 'JKLMNOPQR'])
    const svg = composeCampaignSvg({ input: safeInput, source: { base64: 'iVBORw0KGgo=', contentType: 'image/png' } })
    expect(svg).toContain('>ABCDEFGHI</tspan>')
    expect(svg).toContain('>JKLMNOPQR</tspan>')
  })
})
