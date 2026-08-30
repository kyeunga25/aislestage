import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  campaignBriefFileContractVersion,
  campaignBriefFileInvalidMessage,
  campaignBriefFileSizeMessage,
  campaignBriefFileTypeMessage,
  campaignBriefFileUnavailableMessage,
  parseCampaignBriefFile,
  serializeCampaignBriefFile
} from '../src/lib/campaign-brief-file'

const brief = {
  intent: '新品推廣',
  brand: {
    name: '合成品牌',
    tone: '清楚、可信',
    colors: ['#112233', '#abcdef'],
    forbiddenWords: '合成限制字詞',
    locale: 'zh-Hant' as const,
    cta: '了解更多',
    ctaEn: 'Learn more'
  },
  product: {
    name: '合成商品',
    nameEn: 'Synthetic Product',
    category: '測試類別',
    benefits: ['合成賣點一', '合成賣點二'],
    benefitsEn: ['Synthetic benefit one', 'Synthetic benefit two'],
    specifications: '合成規格',
    price: 'HK$100',
    promotion: '合成推廣資訊',
    promotionEn: 'Synthetic promotion',
    channels: ['Web', 'Social']
  }
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: campaignBriefFileContractVersion,
    ...brief,
    ...overrides
  }
}

function jsonFile(value: unknown, name = 'campaign-brief.json', type = 'application/json') {
  return new File([JSON.stringify(value)], name, { type })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('local Campaign Brief file contract', () => {
  it('imports an exact versioned JSON brief without making a network request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(parseCampaignBriefFile(jsonFile(payload()))).resolves.toEqual(brief)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    new File(['{}'], 'campaign-brief.txt', { type: 'text/plain' }),
    new File(['{}'], 'campaign-brief.json', { type: 'text/plain' }),
    new File(['{}'], 'campaign-brief.csv', { type: 'application/json' })
  ])('rejects unsupported or contradictory file identity %#', async (file) => {
    await expect(parseCampaignBriefFile(file)).rejects.toThrow(campaignBriefFileTypeMessage)
  })

  it.each([
    new File([], 'campaign-brief.json', { type: 'application/json' }),
    new File([new Uint8Array(64 * 1024 + 1)], 'campaign-brief.json', { type: 'application/json' })
  ])('rejects empty or oversized files %#', async (file) => {
    await expect(parseCampaignBriefFile(file)).rejects.toThrow(campaignBriefFileSizeMessage)
  })

  it.each([
    new File(['{'], 'campaign-brief.json', { type: 'application/json' }),
    new File([new Uint8Array([0xc3, 0x28])], 'campaign-brief.json', { type: 'application/json' }),
    jsonFile(payload({ contractVersion: 'aislestage-campaign-brief-v2' })),
    jsonFile({ ...payload(), assetId: 'not-importable' }),
    jsonFile({ contractVersion: campaignBriefFileContractVersion, intent: brief.intent, brand: brief.brand }),
    jsonFile(payload({ brand: { ...brief.brand, privateWorkspaceId: 'not-importable' } })),
    jsonFile(payload({ brand: { ...brief.brand, colors: ['url(//example.test/x)'] } })),
    jsonFile(payload({ product: { ...brief.product, benefits: 'not-a-list' } })),
    jsonFile(payload({ product: { ...brief.product, benefits: ['一', '二', '三', '四'] } })),
    jsonFile(payload({ intent: '不支援的推廣目的' })),
    jsonFile(payload({ intent: 'x'.repeat(121) }))
  ])('rejects malformed, expanded, mismatched, or over-limit content %#', async (file) => {
    await expect(parseCampaignBriefFile(file)).rejects.toThrow(campaignBriefFileInvalidMessage)
  })

  it('uses a ten-second local read deadline and clears the timer', async () => {
    vi.useFakeTimers()
    const file = jsonFile(payload())
    vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise<ArrayBuffer>(() => undefined))

    const read = parseCampaignBriefFile(file)
    const assertion = expect(read).rejects.toThrow(campaignBriefFileUnavailableMessage)
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })

  it('serializes a deterministic, identity-free file that round-trips locally', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const serialized = serializeCampaignBriefFile(brief)
    const decoded = JSON.parse(serialized) as Record<string, unknown>
    expect(Object.keys(decoded)).toEqual(['contractVersion', 'intent', 'brand', 'product'])
    expect(decoded).not.toHaveProperty('assetId')
    expect(serialized).not.toMatch(/workspace|user|provider|imageId|assetId/i)
    await expect(parseCampaignBriefFile(new File([serialized], 'campaign-brief.json', { type: '' }))).resolves.toEqual(brief)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses to serialize an invalid runtime brief', () => {
    expect(() => serializeCampaignBriefFile({ ...brief, intent: 'x'.repeat(121) })).toThrow(campaignBriefFileInvalidMessage)
  })
})
