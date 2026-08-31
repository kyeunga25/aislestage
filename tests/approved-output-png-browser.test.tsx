import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadApprovedOutputPng } from '../src/client/approved-output-png-download'
import { composeCampaignSvg } from '../src/lib/campaign-compositor'
import type { GenerationInput, GenerationResult } from '../src/lib/types'

const result: GenerationResult = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  campaignPackId: '123e4567-e89b-42d3-a456-426614174001',
  workflowId: 'store-main',
  aspectRatio: '1:1',
  imageUrl: '/api/generations/123e4567-e89b-42d3-a456-426614174000/image',
  downloadUrl: '/api/generations/123e4567-e89b-42d3-a456-426614174000/download',
  title: '1:1 · 商品主圖',
  status: 'completed',
  contentType: 'image/svg+xml',
  approvedRevision: 1,
  reviewStatus: 'approved',
  reviewedAt: '2026-08-30T00:01:00.000Z',
  provenance: { approvedRevision: 1, compositionVersion: 'deterministic-svg-v1', generationMode: 'deterministic' }
}

const input: GenerationInput = {
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
    benefitsEn: ['Compact', '12-hour playback', 'Clear sound'],
    specifications: 'Bluetooth 5.3',
    price: 'HK$399',
    promotion: '限時免運費',
    promotionEn: 'Free delivery',
    channels: ['web']
  },
  referenceImageUrls: [],
  referenceAssetIds: ['asset-test']
}

function response() {
  const svg = composeCampaignSvg({ input, source: { base64: 'iVBORw0KGgo=', contentType: 'image/png' } })
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml',
      'content-disposition': 'attachment; filename="aislestage-1x1.svg"'
    }
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('approved output browser PNG adapter', () => {
  it('revokes both the rasterization and saved-file object URLs', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    const createObjectURL = vi.fn()
      .mockReturnValueOnce('blob:approved-svg')
      .mockReturnValueOnce('blob:local-png')
    const revokeObjectURL = vi.fn()
    const NativeURL = globalThis.URL
    class TestURL extends NativeURL {}
    Object.assign(TestURL, { createObjectURL, revokeObjectURL })
    vi.stubGlobal('URL', TestURL)

    const drawImage = vi.fn()
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])], { type: 'image/png' })
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn((callback: (blob: Blob) => void) => callback(png))
    }
    const click = vi.fn()
    const remove = vi.fn()
    const anchor = { href: '', download: '', rel: '', click, remove }
    const append = vi.fn()
    vi.stubGlobal('document', {
      createElement: vi.fn((tagName: string) => tagName === 'canvas' ? canvas : anchor),
      body: { append }
    })
    vi.stubGlobal('window', { setTimeout, clearTimeout })

    class TestImage {
      decoding = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', TestImage)

    await downloadApprovedOutputPng(result)

    expect(canvas.width).toBe(1080)
    expect(canvas.height).toBe(1080)
    expect(drawImage).toHaveBeenCalledWith(expect.any(TestImage), 0, 0, 1080, 1080)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:approved-svg')
    expect(anchor).toMatchObject({ href: 'blob:local-png', download: 'aislestage-1x1.png', rel: 'noopener' })
    expect(append).toHaveBeenCalledWith(anchor)
    expect(click).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:local-png')

    await vi.runOnlyPendingTimersAsync()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-png')

    createObjectURL
      .mockReturnValueOnce('blob:approved-svg-failed-save')
      .mockReturnValueOnce('blob:local-png-failed-save')
    click.mockImplementationOnce(() => { throw new Error('synthetic click failure') })

    await expect(downloadApprovedOutputPng(result)).rejects.toThrow('未能在本機建立 PNG')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:approved-svg-failed-save')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-png-failed-save')
    expect(remove).toHaveBeenCalledTimes(2)
  })
})
