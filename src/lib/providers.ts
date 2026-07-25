import type { BrandPack, CampaignBrief, CampaignPlanItem, Product } from './types'

const TEXT_MODEL = 'gpt-5.6-terra'

function responseOutputText(payload: unknown) {
  if (!payload || typeof payload !== 'object') throw new Error('OpenAI response payload is invalid')
  const direct = (payload as { output_text?: unknown }).output_text
  if (typeof direct === 'string' && direct.trim()) return direct
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
  if (!combined) throw new Error('OpenAI response did not include output text')
  return combined
}

function parseAssistedPlan(value: string): AssistedCampaignPlan {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object') throw new Error('OpenAI campaign plan is invalid')
  const summary = (parsed as { summary?: unknown }).summary
  const recommendations = (parsed as { recommendations?: unknown }).recommendations
  if (typeof summary !== 'string' || !summary.trim() || !Array.isArray(recommendations) || recommendations.length !== 3) throw new Error('OpenAI campaign plan is invalid')
  const allowed = new Set(['store-main', 'social-ad', 'story'])
  const normalized = recommendations.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('OpenAI campaign plan is invalid')
    const id = (item as { id?: unknown }).id
    const rationale = (item as { rationale?: unknown }).rationale
    if (typeof id !== 'string' || !allowed.has(id) || typeof rationale !== 'string' || !rationale.trim()) throw new Error('OpenAI campaign plan is invalid')
    return { id: id as CampaignPlanItem['id'], rationale }
  })
  if (new Set(normalized.map((item) => item.id)).size !== 3) throw new Error('OpenAI campaign plan is invalid')
  return { summary, recommendations: normalized }
}

function parseGeneratedCopy(value: string): GeneratedCopy {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object') throw new Error('OpenAI copy response is invalid')
  const copy = parsed as Partial<Record<keyof GeneratedCopy, unknown>>
  if (typeof copy.imagePrompt !== 'string' || typeof copy.headline !== 'string' || typeof copy.body !== 'string' || typeof copy.cta !== 'string' || !Array.isArray(copy.hashtags) || !copy.hashtags.every((item) => typeof item === 'string')) {
    throw new Error('OpenAI copy response is invalid')
  }
  return { imagePrompt: copy.imagePrompt, headline: copy.headline, body: copy.body, hashtags: copy.hashtags, cta: copy.cta }
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
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: TEXT_MODEL,
        reasoning: { effort: 'none' },
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
      })
    })
    if (!response.ok) throw new Error(`OpenAI campaign planning request failed: ${response.status}`)
    return parseAssistedPlan(responseOutputText(await response.json()))
  }
}

export class OpenAICopyProvider implements CopyProvider {
  constructor(private readonly apiKey: string) {}

  async createCopy(input: { brand: BrandPack; product: Product; workflowTitle: string; aspectRatio: string }): Promise<GeneratedCopy> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: TEXT_MODEL,
        reasoning: { effort: 'none' },
        input: [{ role: 'system', content: [{ type: 'input_text', text: 'You create concise ecommerce visual briefs. Respect brand restrictions. Never make unsupported product claims.' }] }, { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
        text: { format: { type: 'json_schema', name: 'ecommerce_copy', strict: true, schema: { type: 'object', additionalProperties: false, properties: { imagePrompt: { type: 'string' }, headline: { type: 'string' }, body: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, cta: { type: 'string' } }, required: ['imagePrompt', 'headline', 'body', 'hashtags', 'cta'] } } }
      })
    })
    if (!response.ok) throw new Error(`OpenAI copy request failed: ${response.status}`)
    return parseGeneratedCopy(responseOutputText(await response.json()))
  }
}

export class OpenAIImageProvider implements ImageProvider {
  constructor(private readonly apiKey: string) {}

  async generate(input: { prompt: string; aspectRatio: string; referenceImageUrls: string[] }): Promise<{ imageBase64: string; revisedPrompt?: string }> {
    const sizeByRatio: Record<string, string> = { '1:1': '1024x1024', '4:5': '1024x1280', '9:16': '1024x1536', '16:5': '1536x1024' }
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-2', prompt: input.prompt, size: sizeByRatio[input.aspectRatio] ?? '1024x1024', quality: 'medium', output_format: 'png' })
    })
    if (!response.ok) throw new Error(`OpenAI image request failed: ${response.status}`)
    const payload = await response.json() as { data?: Array<{ b64_json?: string; revised_prompt?: string }> }
    const image = payload.data?.[0]
    if (!image?.b64_json) throw new Error('OpenAI image response did not include image data')
    return { imageBase64: image.b64_json, revisedPrompt: image.revised_prompt }
  }
}
