import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasDecodablePngImageData } from '../src/lib/image-validation'
import { OpenAICampaignPlanningProvider, OpenAICopyProvider, OpenAIImageProvider } from '../src/lib/providers'
import type { CampaignBrief } from '../src/lib/types'

const validPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const invalidFilterPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNl+A8AAREBBWRUW6oAAAAASUVORK5CYII='

function decodeBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function encodeBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}

function writeUint32BigEndian(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

function pngCrc(bytes: Uint8Array, start: number, end: number) {
  let crc = 0xffffffff
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset]
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngWithDimensions(width: number, height: number) {
  const bytes = decodeBase64(validPngBase64)
  writeUint32BigEndian(bytes, 16, width)
  writeUint32BigEndian(bytes, 20, height)
  writeUint32BigEndian(bytes, 29, pngCrc(bytes, 12, 29))
  return encodeBase64(bytes)
}

function pngWithMetadataChunk(type: 'eXIf' | 'tEXt' | 'zTXt' | 'iTXt') {
  const source = decodeBase64(validPngBase64)
  const data = new TextEncoder().encode('synthetic metadata')
  const chunk = new Uint8Array(12 + data.length)
  writeUint32BigEndian(chunk, 0, data.length)
  for (let index = 0; index < type.length; index += 1) chunk[4 + index] = type.charCodeAt(index)
  chunk.set(data, 8)
  writeUint32BigEndian(chunk, 8 + data.length, pngCrc(chunk, 4, 8 + data.length))

  const insertionOffset = 33
  const output = new Uint8Array(source.length + chunk.length)
  output.set(source.subarray(0, insertionOffset))
  output.set(chunk, insertionOffset)
  output.set(source.subarray(insertionOffset), insertionOffset + chunk.length)
  return encodeBase64(output)
}

function pngWithCorruptedCompressedData() {
  const bytes = decodeBase64(validPngBase64)
  bytes[41] ^= 0xff
  writeUint32BigEndian(bytes, 52, pngCrc(bytes, 37, 52))
  return encodeBase64(bytes)
}

function pngWithHighDecodedCost() {
  const bytes = decodeBase64(pngWithDimensions(8_000, 4_000))
  bytes[24] = 16
  bytes[25] = 6
  writeUint32BigEndian(bytes, 29, pngCrc(bytes, 12, 29))
  return bytes
}

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
  vi.useRealTimers()
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

  it('aborts a provider request that never returns response headers at the fixed deadline', async () => {
    vi.useFakeTimers()
    let aborted = false
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.signal) throw new Error('Provider request did not include an abort signal')
      return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => {
          aborted = true
          reject(init.signal!.reason)
        }, { once: true })
      })
    }))

    const outcome = new OpenAICampaignPlanningProvider('test-key').createPlan(syntheticBrief()).then(
      () => undefined,
      (error: unknown) => error
    )
    await vi.advanceTimersByTimeAsync(30_000)
    const error = await outcome
    expect(error).toBeInstanceOf(TypeError)
    expect((error as Error).message).toContain('request failed: 408')
    expect(aborted).toBe(true)
  })

  it('keeps the same deadline active while reading a stalled provider body', async () => {
    vi.useFakeTimers()
    let bodyAborted = false
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.signal) throw new Error('Provider request did not include an abort signal')
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{'))
          init.signal!.addEventListener('abort', () => {
            bodyAborted = true
            controller.error(init.signal!.reason)
          }, { once: true })
        }
      }), { headers: { 'content-type': 'application/json' } })
    }))

    const outcome = new OpenAICampaignPlanningProvider('test-key').createPlan(syntheticBrief()).then(
      () => undefined,
      (error: unknown) => error
    )
    await vi.advanceTimersByTimeAsync(30_000)
    const error = await outcome
    expect(error).toBeInstanceOf(TypeError)
    expect((error as Error).message).toContain('request failed: 408')
    expect(bodyAborted).toBe(true)
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

  it('rejects a signature-only provider PNG', async () => {
    const signatureOnly = encodeBase64(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: signatureOnly }] })))

    await expect(new OpenAIImageProvider('test-key').generate({ prompt: 'Synthetic background', aspectRatio: '1:1', referenceImageUrls: [] }))
      .rejects.toThrow('image response is invalid')
  })

  it('rejects a provider PNG with a corrupted chunk checksum', async () => {
    const bytes = decodeBase64(validPngBase64)
    bytes[bytes.length - 1] ^= 1
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: encodeBase64(bytes) }] })))

    await expect(new OpenAIImageProvider('test-key').generate({ prompt: 'Synthetic background', aspectRatio: '1:1', referenceImageUrls: [] }))
      .rejects.toThrow('image response is invalid')
  })

  it('rejects CRC-valid provider PNG image data with an invalid zlib stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: pngWithCorruptedCompressedData() }] })))

    await expect(new OpenAIImageProvider('test-key').generate({ prompt: 'Synthetic background', aspectRatio: '1:1', referenceImageUrls: [] }))
      .rejects.toThrow('image response is invalid')
  })

  it('rejects provider PNG scanlines that do not match the declared dimensions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: pngWithDimensions(2, 1) }] })))

    await expect(new OpenAIImageProvider('test-key').generate({ prompt: 'Synthetic background', aspectRatio: '1:1', referenceImageUrls: [] }))
      .rejects.toThrow('image response is invalid')
  })

  it('rejects a provider PNG with an invalid decoded scanline filter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: invalidFilterPngBase64 }] })))

    await expect(new OpenAIImageProvider('test-key').generate({ prompt: 'Synthetic background', aspectRatio: '1:1', referenceImageUrls: [] }))
      .rejects.toThrow('image response is invalid')
  })

  it('rejects an excessive decoded scanline budget before starting decompression', async () => {
    const decompressor = vi.fn()
    vi.stubGlobal('DecompressionStream', decompressor)

    await expect(hasDecodablePngImageData(pngWithHighDecodedCost())).resolves.toBe(false)
    expect(decompressor).not.toHaveBeenCalled()
  })

  it('keeps PNG decompression inside the provider request deadline', async () => {
    vi.useFakeTimers()
    const stalled = new TransformStream({
      transform() {
        return new Promise<void>(() => undefined)
      }
    })
    vi.stubGlobal('DecompressionStream', class {
      readable = stalled.readable
      writable = stalled.writable
    })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: validPngBase64 }] })))

    const outcome = new OpenAIImageProvider('test-key').generate({ prompt: 'Synthetic background', aspectRatio: '1:1', referenceImageUrls: [] }).then(
      () => undefined,
      (error: unknown) => error
    )
    await vi.advanceTimersByTimeAsync(30_000)
    const error = await outcome
    expect(error).toBeInstanceOf(TypeError)
    expect((error as Error).message).toContain('request failed: 408')
  })

  it('rejects a provider PNG without image data or a canonical ending', async () => {
    const headerOnly = decodeBase64(validPngBase64).slice(0, 33)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: encodeBase64(headerOnly) }] })))

    await expect(new OpenAIImageProvider('test-key').generate({ prompt: 'Synthetic background', aspectRatio: '1:1', referenceImageUrls: [] }))
      .rejects.toThrow('image response is invalid')
  })

  it('rejects a structurally valid provider PNG outside the shared safe dimensions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: pngWithDimensions(9_000, 4_000) }] })))

    await expect(new OpenAIImageProvider('test-key').generate({ prompt: 'Synthetic background', aspectRatio: '1:1', referenceImageUrls: [] }))
      .rejects.toThrow('image response is invalid')
  })

  it.each(['eXIf', 'tEXt', 'zTXt', 'iTXt'] as const)('rejects a structurally valid provider PNG containing %s metadata', async (type) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: pngWithMetadataChunk(type) }] })))

    await expect(new OpenAIImageProvider('test-key').generate({ prompt: 'Synthetic background', aspectRatio: '1:1', referenceImageUrls: [] }))
      .rejects.toThrow('image response is invalid')
  })

  it('accepts one bounded base64 PNG from the image adapter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: validPngBase64, revised_prompt: 'Synthetic studio' }] })))

    await expect(new OpenAIImageProvider('test-key').generate({ prompt: 'Synthetic background', aspectRatio: '1:1', referenceImageUrls: [] }))
      .resolves.toEqual({ imageBase64: validPngBase64, revisedPrompt: 'Synthetic studio' })
  })
})
