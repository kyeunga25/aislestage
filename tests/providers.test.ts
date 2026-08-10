import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICampaignPlanningProvider, OpenAICopyProvider, OpenAIImageProvider } from '../src/lib/providers'
import type { CampaignBrief } from '../src/lib/types'

const validPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9ZKAAAAAASUVORK5CYII='

function syntheticBrief(): CampaignBrief {
  return {
    assetId: null,
    intent: '新品介紹',
    brand: { name: 'Test Brand', tone: 'clear', colors: ['#155eef'], forbiddenWords: '', locale: 'zh-Hant', cta: '立即查看', ctaEn: 'View now' },
    product: { name: 'Test Product', nameEn: 'Test Product', category: 'test', benefits: ['Feature A', 'Feature B'], benefitsEn: ['Feature A', 'Feature B'], specifications: 'Spec', price: 'HK$100', promotion: '測試優惠', promotionEn: 'Test offer', channels: ['web'] }
  }
}

function validCopyPayload(overrides: Record<string, unknown> = {}) {
  return {
    imagePrompt: 'Clean studio background',
    headline: 'Exact headline',
    body: 'Exact body',
    hashtags: ['#test'],
    cta: 'Shop now',
    ...overrides
  }
}

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
    expect(JSON.parse(requestBody)).toMatchObject({ max_output_tokens: 1_024, reasoning: { effort: 'none' } })
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
        content: [{ type: 'output_text', text: JSON.stringify(validCopyPayload()) }]
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

  it('stops reading an understated streamed response once the actual body exceeds the safe limit', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ output_text: 'x'.repeat(72 * 1024) }))
    let offset = 0
    let cancelled = false
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.byteLength) {
          controller.close()
          return
        }
        const next = bytes.slice(offset, Math.min(offset + 1024, bytes.byteLength))
        offset += next.byteLength
        controller.enqueue(next)
      },
      cancel() {
        cancelled = true
      }
    }), { headers: { 'content-type': 'application/json', 'content-length': '1' } })))

    await expect(new OpenAICampaignPlanningProvider('test-key').createPlan(syntheticBrief()))
      .rejects.toThrow('exceeded the safe response limit')
    expect(cancelled).toBe(true)
  })

  it('cancels a pathologically fragmented response before chunk overhead can exhaust the isolate', async () => {
    const payload = JSON.stringify({
      output_text: JSON.stringify({
        summary: 'Bounded plan',
        recommendations: [
          { id: 'store-main', rationale: 'Store layout' },
          { id: 'social-ad', rationale: 'Feed layout' },
          { id: 'story', rationale: 'Story layout' }
        ]
      })
    })
    const bytes = new TextEncoder().encode(`${' '.repeat(17_000)}${payload}`)
    let offset = 0
    let cancelled = false
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.byteLength) {
          controller.close()
          return
        }
        controller.enqueue(bytes.slice(offset, offset + 1))
        offset += 1
      },
      cancel() {
        cancelled = true
      }
    }), { headers: { 'content-type': 'application/json' } })))

    await expect(new OpenAICampaignPlanningProvider('test-key').createPlan(syntheticBrief()))
      .rejects.toThrow('too fragmented')
    expect(cancelled).toBe(true)
  })

  it('rejects structured plan text that exceeds its bounded field contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      output_text: JSON.stringify({
        summary: 'x'.repeat(2_000),
        recommendations: [
          { id: 'store-main', rationale: 'Store layout' },
          { id: 'social-ad', rationale: 'Feed layout' },
          { id: 'story', rationale: 'Story layout' }
        ]
      })
    })))

    await expect(new OpenAICampaignPlanningProvider('test-key').createPlan(syntheticBrief()))
      .rejects.toThrow('campaign plan is invalid')
  })

  it('rejects a misleading provider content type instead of treating it as JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        summary: 'Bounded plan',
        recommendations: [
          { id: 'store-main', rationale: 'Store layout' },
          { id: 'social-ad', rationale: 'Feed layout' },
          { id: 'story', rationale: 'Story layout' }
        ]
      })
    }), { headers: { 'content-type': 'application/json-malicious' } })))

    await expect(new OpenAICampaignPlanningProvider('test-key').createPlan(syntheticBrief()))
      .rejects.toThrow('did not return JSON')
  })

  it('cancels an unused provider error body before returning the bounded status error', async () => {
    let cancelled = false
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('synthetic provider failure'))
      },
      cancel() {
        cancelled = true
      }
    }), { status: 429, headers: { 'content-type': 'text/plain' } })))

    await expect(new OpenAICampaignPlanningProvider('test-key').createPlan(syntheticBrief()))
      .rejects.toThrow('request failed: 429')
    expect(cancelled).toBe(true)
  })

  it('rejects copy payloads with fields outside the exact local contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      output_text: JSON.stringify(validCopyPayload({ unreviewedClaim: 'unsupported' }))
    })))

    await expect(new OpenAICopyProvider('test-key').createCopy({
      brand: syntheticBrief().brand,
      product: syntheticBrief().product,
      workflowTitle: '商品主圖',
      aspectRatio: '1:1'
    })).rejects.toThrow('copy response is invalid')
  })

  it('rejects a declared oversized image response before parsing its JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: validPngBase64 }] }), {
      headers: { 'content-type': 'application/json', 'content-length': String(64 * 1024 * 1024) }
    })))

    await expect(new OpenAIImageProvider('test-key').generate({ prompt: 'Synthetic background', aspectRatio: '1:1', referenceImageUrls: [] }))
      .rejects.toThrow('exceeded the safe response limit')
  })

  it('rejects image data that is not a bounded base64 PNG', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: 'not-a-png' }] })))

    await expect(new OpenAIImageProvider('test-key').generate({ prompt: 'Synthetic background', aspectRatio: '1:1', referenceImageUrls: [] }))
      .rejects.toThrow('image response is invalid')
  })

  it('accepts one bounded base64 PNG from the image adapter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: validPngBase64, revised_prompt: 'Synthetic studio' }] })))

    await expect(new OpenAIImageProvider('test-key').generate({ prompt: 'Synthetic background', aspectRatio: '1:1', referenceImageUrls: [] }))
      .resolves.toEqual({ imageBase64: validPngBase64, revisedPrompt: 'Synthetic studio' })
  })
})
