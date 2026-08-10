import type { BrandPack, CampaignBrief, CampaignPlanItem, Product } from './types'
import { hasDecodablePngImageData, hasPrivatePngMetadata, hasSafeImageDimensions, hasValidPngStructure, pngImageDimensions } from './image-validation'

const TEXT_MODEL = 'gpt-5.6-terra'
const MAX_TEXT_PROVIDER_RESPONSE_BYTES = 64 * 1024
const MAX_IMAGE_PROVIDER_RESPONSE_BYTES = 12 * 1024 * 1024
const MAX_GENERATED_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_STRUCTURED_OUTPUT_CHARS = 16 * 1024
const MAX_TEXT_PROVIDER_OUTPUT_TOKENS = 1_024
const MAX_PROVIDER_RESPONSE_CHUNKS = 16_384
const MAX_PROVIDER_REQUEST_MS = 30_000
const defaultProviderImageSize = { apiSize: '1024x1024', width: 1_024, height: 1_024 }
const providerImageSizeByRatio: Record<string, typeof defaultProviderImageSize> = {
  '1:1': defaultProviderImageSize,
  '4:5': { apiSize: '1024x1280', width: 1_024, height: 1_280 },
  '9:16': { apiSize: '1024x1536', width: 1_024, height: 1_536 },
  '16:5': { apiSize: '1536x1024', width: 1_536, height: 1_024 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const expectedKeys = new Set(expected)
  const actualKeys = Object.keys(value)
  return actualKeys.length === expected.length && actualKeys.every((key) => expectedKeys.has(key))
}

function boundedText(value: unknown, maximumCharacters: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximumCharacters
}

async function cancelResponseBody(response: Response) {
  await response.body?.cancel().catch(() => undefined)
}

async function withProviderDeadline<T>(context: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), MAX_PROVIDER_REQUEST_MS)
  try {
    return await operation(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) throw new TypeError(`${context} request failed: 408`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function readBoundedJsonResponse(response: Response, maximumBytes: number, context: string) {
  const contentType = response.headers.get('content-type')?.toLowerCase() || ''
  if (contentType !== 'application/json' && !contentType.startsWith('application/json;')) {
    await cancelResponseBody(response)
    throw new Error(`${context} did not return JSON`)
  }

  const declaredLength = response.headers.get('content-length')?.trim()
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maximumBytes) {
    await cancelResponseBody(response)
    throw new Error(`${context} exceeded the safe response limit`)
  }
  if (!response.body) throw new Error(`${context} response is invalid`)

  const reader = response.body.getReader()
  const bytes = new Uint8Array(maximumBytes)
  let totalBytes = 0
  let chunkCount = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunkCount += 1
      if (chunkCount > MAX_PROVIDER_RESPONSE_CHUNKS) {
        await reader.cancel().catch(() => undefined)
        throw new Error(`${context} is too fragmented`)
      }
      if (!(value instanceof Uint8Array)) {
        await reader.cancel().catch(() => undefined)
        throw new Error(`${context} response is invalid`)
      }
      if (value.byteLength > maximumBytes - totalBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error(`${context} exceeded the safe response limit`)
      }
      bytes.set(value, totalBytes)
      totalBytes += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, totalBytes))
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`${context} response is invalid`)
  }
}

async function isBoundedBase64Png(
  value: unknown,
  signal: AbortSignal,
  expectedDimensions: { width: number; height: number }
) {
  if (typeof value !== 'string' || value.length < 12 || value.length % 4 !== 0) return false
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const decodedBytes = value.length / 4 * 3 - padding
  if (decodedBytes < 8 || decodedBytes > MAX_GENERATED_IMAGE_BYTES) return false
  const contentEnd = value.length - padding
  for (let index = 0; index < contentEnd; index += 1) {
    const code = value.charCodeAt(index)
    const valid = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57) || code === 43 || code === 47
    if (!valid) return false
  }
  for (let index = contentEnd; index < value.length; index += 1) {
    if (value[index] !== '=') return false
  }
  try {
    const binary = atob(value)
    if (binary.length !== decodedBytes) return false
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    const dimensions = pngImageDimensions(bytes)
    return hasValidPngStructure(bytes)
      && !hasPrivatePngMetadata(bytes)
      && hasSafeImageDimensions(dimensions)
      && dimensions?.width === expectedDimensions.width
      && dimensions.height === expectedDimensions.height
      && await hasDecodablePngImageData(bytes, signal)
  } catch {
    return false
  }
}

function responseOutputText(payload: unknown) {
  if (!payload || typeof payload !== 'object') throw new Error('OpenAI response payload is invalid')
  const direct = (payload as { output_text?: unknown }).output_text
  if (typeof direct === 'string') {
    if (!boundedText(direct, MAX_STRUCTURED_OUTPUT_CHARS)) throw new Error('OpenAI response output text is invalid')
    return direct.trim()
  }
  const output = (payload as { output?: unknown }).output
  if (!Array.isArray(output)) throw new Error('OpenAI response did not include message output')
  const texts = output.flatMap((item) => {
    if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'message') return []
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) return []
    return content.flatMap((part) => {
      if (!part || typeof part !== 'object') return []
      if ((part as { type?: unknown }).type === 'refusal') throw new Error('OpenAI declined the structured request')
      const text = (part as { text?: unknown }).text
      return (part as { type?: unknown }).type === 'output_text' && typeof text === 'string' ? [text] : []
    })
  })
  const combined = texts.join('').trim()
  if (!combined || combined.length > MAX_STRUCTURED_OUTPUT_CHARS) throw new Error('OpenAI response did not include valid output text')
  return combined
}

function parseAssistedPlan(value: string): AssistedCampaignPlan {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new Error('OpenAI campaign plan is invalid')
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ['summary', 'recommendations'])) throw new Error('OpenAI campaign plan is invalid')
  const summary = parsed.summary
  const recommendations = parsed.recommendations
  if (!boundedText(summary, 800) || !Array.isArray(recommendations) || recommendations.length !== 3) throw new Error('OpenAI campaign plan is invalid')
  const allowed = new Set(['store-main', 'social-ad', 'story'])
  const normalized = recommendations.map((item) => {
    if (!isRecord(item) || !hasExactKeys(item, ['id', 'rationale'])) throw new Error('OpenAI campaign plan is invalid')
    const id = item.id
    const rationale = item.rationale
    if (typeof id !== 'string' || !allowed.has(id) || !boundedText(rationale, 600)) throw new Error('OpenAI campaign plan is invalid')
    return { id: id as CampaignPlanItem['id'], rationale: rationale.trim() }
  })
  if (new Set(normalized.map((item) => item.id)).size !== 3) throw new Error('OpenAI campaign plan is invalid')
  return { summary: summary.trim(), recommendations: normalized }
}

function parseGeneratedCopy(value: string): GeneratedCopy {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new Error('OpenAI copy response is invalid')
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ['imagePrompt', 'headline', 'body', 'hashtags', 'cta'])) throw new Error('OpenAI copy response is invalid')
  const copy = parsed as Partial<Record<keyof GeneratedCopy, unknown>>
  if (!boundedText(copy.imagePrompt, 2_000) || !boundedText(copy.headline, 160)
    || !boundedText(copy.body, 1_200) || !boundedText(copy.cta, 120)
    || !Array.isArray(copy.hashtags) || copy.hashtags.length > 12
    || !copy.hashtags.every((item) => boundedText(item, 80))) {
    throw new Error('OpenAI copy response is invalid')
  }
  return {
    imagePrompt: copy.imagePrompt.trim(),
    headline: copy.headline.trim(),
    body: copy.body.trim(),
    hashtags: (copy.hashtags as string[]).map((item) => item.trim()),
    cta: copy.cta.trim()
  }
}

export type GeneratedCopy = {
  imagePrompt: string
  headline: string
  body: string
  hashtags: string[]
  cta: string
}

export interface CopyProvider {
  createCopy(input: { brand: BrandPack; product: Product; workflowTitle: string; aspectRatio: string }): Promise<GeneratedCopy>
}

export interface ImageProvider {
  generate(input: { prompt: string; aspectRatio: string; referenceImageUrls: string[] }): Promise<{ imageBase64: string; revisedPrompt?: string }>
}

export type AssistedCampaignPlan = {
  summary: string
  recommendations: Array<Pick<CampaignPlanItem, 'id' | 'rationale'>>
}

export interface CampaignPlanningProvider {
  createPlan(input: CampaignBrief): Promise<AssistedCampaignPlan>
}

export class OpenAICampaignPlanningProvider implements CampaignPlanningProvider {
  constructor(private readonly apiKey: string) {}

  async createPlan(input: CampaignBrief): Promise<AssistedCampaignPlan> {
    const providerInput = { intent: input.intent, brand: input.brand, product: input.product }
    return withProviderDeadline('OpenAI campaign planning', async (signal) => {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: TEXT_MODEL,
          reasoning: { effort: 'none' },
          max_output_tokens: MAX_TEXT_PROVIDER_OUTPUT_TOKENS,
          input: [
            { role: 'system', content: [{ type: 'input_text', text: 'You plan bounded ecommerce campaign assets. Use only verified facts. Never add claims. Recommend exactly store-main, social-ad, and story, and stop for human approval.' }] },
            { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(providerInput) }] }
          ],
          text: { format: { type: 'json_schema', name: 'campaign_plan', strict: true, schema: {
            type: 'object', additionalProperties: false,
            properties: {
              summary: { type: 'string' },
              recommendations: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', enum: ['store-main', 'social-ad', 'story'] }, rationale: { type: 'string' } }, required: ['id', 'rationale'] } }
            },
            required: ['summary', 'recommendations']
          } } }
        }),
        signal
      })
      if (!response.ok) {
        await cancelResponseBody(response)
        throw new Error(`OpenAI campaign planning request failed: ${response.status}`)
      }
      return parseAssistedPlan(responseOutputText(await readBoundedJsonResponse(response, MAX_TEXT_PROVIDER_RESPONSE_BYTES, 'OpenAI campaign planning response')))
    })
  }
}

export class OpenAICopyProvider implements CopyProvider {
  constructor(private readonly apiKey: string) {}

  async createCopy(input: { brand: BrandPack; product: Product; workflowTitle: string; aspectRatio: string }): Promise<GeneratedCopy> {
    return withProviderDeadline('OpenAI copy', async (signal) => {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: TEXT_MODEL,
          reasoning: { effort: 'none' },
          max_output_tokens: MAX_TEXT_PROVIDER_OUTPUT_TOKENS,
          input: [{ role: 'system', content: [{ type: 'input_text', text: 'You create concise ecommerce visual briefs. Respect brand restrictions. Never make unsupported product claims.' }] }, { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
          text: { format: { type: 'json_schema', name: 'ecommerce_copy', strict: true, schema: { type: 'object', additionalProperties: false, properties: { imagePrompt: { type: 'string' }, headline: { type: 'string' }, body: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, cta: { type: 'string' } }, required: ['imagePrompt', 'headline', 'body', 'hashtags', 'cta'] } } }
        }),
        signal
      })
      if (!response.ok) {
        await cancelResponseBody(response)
        throw new Error(`OpenAI copy request failed: ${response.status}`)
      }
      return parseGeneratedCopy(responseOutputText(await readBoundedJsonResponse(response, MAX_TEXT_PROVIDER_RESPONSE_BYTES, 'OpenAI copy response')))
    })
  }
}

export class OpenAIImageProvider implements ImageProvider {
  constructor(private readonly apiKey: string) {}

  async generate(input: { prompt: string; aspectRatio: string; referenceImageUrls: string[] }): Promise<{ imageBase64: string; revisedPrompt?: string }> {
    const outputSize = providerImageSizeByRatio[input.aspectRatio] ?? defaultProviderImageSize
    return withProviderDeadline('OpenAI image', async (signal) => {
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-2', prompt: input.prompt, size: outputSize.apiSize, quality: 'medium', output_format: 'png' }),
        signal
      })
      if (!response.ok) {
        await cancelResponseBody(response)
        throw new Error(`OpenAI image request failed: ${response.status}`)
      }
      const payload = await readBoundedJsonResponse(response, MAX_IMAGE_PROVIDER_RESPONSE_BYTES, 'OpenAI image response')
      if (!isRecord(payload) || !Array.isArray(payload.data) || payload.data.length !== 1 || !isRecord(payload.data[0])) {
        throw new Error('OpenAI image response is invalid')
      }
      const image = payload.data[0]
      const imageBase64 = image.b64_json
      if (typeof imageBase64 !== 'string'
        || !await isBoundedBase64Png(imageBase64, signal, outputSize)
        || (image.revised_prompt !== undefined && !boundedText(image.revised_prompt, 4_000))) {
        throw new Error('OpenAI image response is invalid')
      }
      return { imageBase64, revisedPrompt: typeof image.revised_prompt === 'string' ? image.revised_prompt.trim() : undefined }
    })
  }
}
