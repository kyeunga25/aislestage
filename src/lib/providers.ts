import type { BrandPack, CampaignBrief, CampaignPlanItem, Product } from './types'

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
        model: 'gpt-5.4-mini',
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
    const payload = await response.json() as { output_text?: string }
    if (!payload.output_text) throw new Error('OpenAI campaign planning response did not include output_text')
    return JSON.parse(payload.output_text) as AssistedCampaignPlan
  }
}

export class OpenAICopyProvider implements CopyProvider {
  constructor(private readonly apiKey: string) {}

  async createCopy(input: { brand: BrandPack; product: Product; workflowTitle: string; aspectRatio: string }): Promise<GeneratedCopy> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        input: [{ role: 'system', content: [{ type: 'input_text', text: 'You create concise ecommerce visual briefs. Respect brand restrictions. Never make unsupported product claims.' }] }, { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
        text: { format: { type: 'json_schema', name: 'ecommerce_copy', strict: true, schema: { type: 'object', additionalProperties: false, properties: { imagePrompt: { type: 'string' }, headline: { type: 'string' }, body: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, cta: { type: 'string' } }, required: ['imagePrompt', 'headline', 'body', 'hashtags', 'cta'] } } }
      })
    })
    if (!response.ok) throw new Error(`OpenAI copy request failed: ${response.status}`)
    const payload = await response.json() as { output_text?: string }
    if (!payload.output_text) throw new Error('OpenAI copy response did not include output_text')
    return JSON.parse(payload.output_text) as GeneratedCopy
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
