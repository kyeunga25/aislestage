import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  approvedOutputPngUnavailableMessage,
  canExportApprovedOutputPng,
  createApprovedOutputPng,
  validateApprovedCampaignSvg
} from '../src/lib/approved-output-png'
import { composeCampaignSvg } from '../src/lib/campaign-compositor'
import type { GenerationInput, GenerationResult } from '../src/lib/types'

const approvedResult: GenerationResult = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  campaignPackId: '123e4567-e89b-42d3-a456-426614174001',
  workflowId: 'store-main',
  aspectRatio: '1:1',
  imageUrl: '/api/generations/123e4567-e89b-42d3-a456-426614174000/image',
  downloadUrl: '/api/generations/123e4567-e89b-42d3-a456-426614174000/download',
  title: '1:1 · 商品主圖',
  status: 'completed',
  contentType: 'image/svg+xml',
  approvedRevision: 2,
  createdAt: '2026-08-30T00:00:00.000Z',
  reviewStatus: 'approved',
  reviewedAt: '2026-08-30T00:01:00.000Z',
  provenance: {
    approvedRevision: 2,
    compositionVersion: 'deterministic-svg-v1',
    generationMode: 'deterministic'
  }
}

function generationInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    workspaceId: 'workspace-test',
    workflowId: 'store-main',
    aspectRatio: '1:1',
    approvedRevision: 2,
    intent: '限時優惠',
    brand: { name: 'Test Brand', tone: 'clean', colors: ['#155eef'], forbiddenWords: '', locale: 'zh-Hant', cta: '立即選購', ctaEn: 'Shop now' },
    product: {
      name: 'Mini & 喇叭',
      nameEn: 'Mini Speaker',
      category: 'electronics',
      benefits: ['輕巧隨行', '12 小時播放', '清晰立體聲'],
      benefitsEn: ['Compact', '12-hour playback', 'Clear sound'],
      specifications: 'Bluetooth 5.3 · USB-C',
      price: 'HK$399',
      promotion: '限時免運費',
      promotionEn: 'Free delivery',
      channels: ['web']
    },
    referenceImageUrls: [],
    referenceAssetIds: ['asset-test'],
    ...overrides
  }
}

function campaignSvg(input = generationInput()) {
  return composeCampaignSvg({
    input,
    source: { base64: 'iVBORw0KGgo=', contentType: 'image/png' }
  })
}

function approvedSvgResponse(body: BodyInit, headers: HeadersInit = {}) {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml',
      'content-disposition': 'attachment; filename="aislestage-1x1.svg"',
      ...headers
    }
  })
}

function pngBlob() {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])], { type: 'image/png' })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('approved output local PNG eligibility', () => {
  it('accepts only an approved canonical SVG route with matching provenance', () => {
    expect(canExportApprovedOutputPng(approvedResult)).toBe(true)
    expect(canExportApprovedOutputPng({ ...approvedResult, reviewStatus: 'draft', reviewedAt: null, downloadUrl: null })).toBe(false)
    expect(canExportApprovedOutputPng({ ...approvedResult, downloadUrl: 'https://example.test/output.svg' })).toBe(false)
    expect(canExportApprovedOutputPng({ ...approvedResult, contentType: 'image/png' })).toBe(false)
    expect(canExportApprovedOutputPng({
      ...approvedResult,
      provenance: { ...approvedResult.provenance!, compositionVersion: 'legacy-composition' }
    })).toBe(false)
  })
})

describe('approved deterministic SVG allowlist', () => {
  it('accepts each canonical fixed-size composition, including a safe embedded background', () => {
    for (const [aspectRatio, workflowId] of [['1:1', 'store-main'], ['4:5', 'meta-ad'], ['9:16', 'promo-poster']] as const) {
      const input = generationInput({ aspectRatio, workflowId })
      const svg = composeCampaignSvg({
        input,
        source: { base64: 'iVBORw0KGgo=', contentType: 'image/png' },
        background: { base64: 'iVBORw0KGgo=', contentType: 'image/png' }
      })
      expect(validateApprovedCampaignSvg(svg, aspectRatio)).toBe(true)
    }
  })

  it.each([
    ['script', (svg: string) => svg.replace('</svg>', '<script>alert(1)</script></svg>')],
    ['event handler', (svg: string) => svg.replace('<svg ', '<svg onload="alert(1)" ')],
    ['external image', (svg: string) => svg.replace(/href="data:image\/png;base64,[^"]+"/, 'href="https://example.test/product.png"')],
    ['external CSS URL', (svg: string) => svg.replace('fill="url(#canvas)"', 'fill="url(https://example.test/canvas)"')],
    ['foreign object', (svg: string) => svg.replace('</svg>', '<foreignObject/></svg>')],
    ['doctype', (svg: string) => svg.replace('<svg ', '<!DOCTYPE svg><svg ')],
    ['unknown entity', (svg: string) => svg.replace('Mini &amp; 喇叭', 'Mini &private; 喇叭')],
    ['wrong dimensions', (svg: string) => svg.replace('width="1080" height="1080"', 'width="4000" height="4000"')]
  ])('rejects %s before rasterization', (_label, mutate) => {
    expect(validateApprovedCampaignSvg(mutate(campaignSvg()), '1:1')).toBe(false)
  })

  it('does not accept a canonical document under another ratio contract', () => {
    expect(validateApprovedCampaignSvg(campaignSvg(), '4:5')).toBe(false)
  })
})

describe('approved SVG download and local rasterization', () => {
  it('fetches the controlled route and returns a bounded PNG with fixed dimensions', async () => {
    const fetchMock = vi.fn(async () => approvedSvgResponse(campaignSvg()))
    vi.stubGlobal('fetch', fetchMock)
    const rasterize = vi.fn(async (_svg: string, dimensions: { width: number; height: number }) => {
      expect(dimensions).toEqual({ width: 1080, height: 1080 })
      return pngBlob()
    })

    const output = await createApprovedOutputPng(approvedResult, rasterize)

    expect(output.filename).toBe('aislestage-1x1.png')
    expect(output.blob.type).toBe('image/png')
    expect(rasterize).toHaveBeenCalledWith(expect.stringContaining('<svg'), { width: 1080, height: 1080 })
    expect(fetchMock).toHaveBeenCalledWith(
      approvedResult.downloadUrl,
      expect.objectContaining({ credentials: 'same-origin', signal: expect.any(AbortSignal) })
    )
  })

  it('rejects an ineligible route before any network request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(createApprovedOutputPng({ ...approvedResult, downloadUrl: 'https://example.test/output.svg' }, vi.fn()))
      .rejects.toThrow(approvedOutputPngUnavailableMessage)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['non-success response', () => new Response('denied', { status: 403 })],
    ['wrong MIME', () => approvedSvgResponse(campaignSvg(), { 'content-type': 'text/html' })],
    ['wrong attachment', () => approvedSvgResponse(campaignSvg(), { 'content-disposition': 'attachment; filename="other.svg"' })],
    ['oversized declaration', () => approvedSvgResponse(campaignSvg(), { 'content-length': String(19 * 1024 * 1024) })],
    ['malformed UTF-8', () => approvedSvgResponse(new Uint8Array([0xc3, 0x28]))],
    ['unsafe SVG', () => approvedSvgResponse(campaignSvg().replace('</svg>', '<script>alert(1)</script></svg>'))]
  ])('fails closed for a %s', async (_label, response) => {
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    const rasterize = vi.fn(async () => pngBlob())

    await expect(createApprovedOutputPng(approvedResult, rasterize)).rejects.toThrow(approvedOutputPngUnavailableMessage)
    expect(rasterize).not.toHaveBeenCalled()
  })

  it('rejects a response split into too many chunks', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 1_025; index += 1) controller.enqueue(new Uint8Array([0x20]))
        controller.close()
      }
    })
    vi.stubGlobal('fetch', vi.fn(async () => approvedSvgResponse(stream)))

    await expect(createApprovedOutputPng(approvedResult, vi.fn())).rejects.toThrow(approvedOutputPngUnavailableMessage)
  })

  it('rejects a rasterizer result that is empty, oversized, or not a PNG signature', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => approvedSvgResponse(campaignSvg())))
    const invalid = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: 'image/png' })

    await expect(createApprovedOutputPng(approvedResult, async () => invalid)).rejects.toThrow(approvedOutputPngUnavailableMessage)
  })
})
