import { campaignBriefLimits } from './campaign-agent'
import { readBoundedJsonResponse } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import type { CampaignAgentState, CampaignBrief } from './types'

export const campaignAgentUnavailableMessage = 'Campaign Agent 計劃暫時無法讀取。 Campaign Agent plan is temporarily unavailable.'

const MAX_CAMPAIGN_AGENT_RESPONSE_BYTES = 256 * 1024
const HYDRATION_REQUEST_TIMEOUT_MS = 15_000
const stateKeys = new Set(['stage', 'revision', 'summary', 'checks', 'plan', 'messages', 'mode', 'approvedAt', 'brief'])
const briefKeys = new Set(['assetId', 'intent', 'brand', 'product'])
const brandKeys = new Set(['name', 'tone', 'colors', 'forbiddenWords', 'locale', 'cta', 'ctaEn'])
const productKeys = new Set(['name', 'nameEn', 'category', 'benefits', 'benefitsEn', 'specifications', 'price', 'promotion', 'promotionEn', 'channels'])
const checkKeys = new Set(['id', 'label', 'detail', 'status'])
const planKeys = new Set(['id', 'workflowId', 'ratio', 'label', 'dimensions', 'rationale', 'selected'])
const messageKeys = new Set(['id', 'role', 'text'])
const responseKeys = new Set(['state'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.size && actualKeys.every((key) => keys.has(key))
}

function isText(value: unknown, maxLength: number, allowEmpty = true): value is string {
  return typeof value === 'string' && value.length <= maxLength && (allowEmpty || value.length > 0)
}

function isTextList(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => isText(item, maxLength))
}

function isCampaignBrief(value: unknown): value is CampaignBrief {
  if (!isRecord(value) || !hasExactKeys(value, briefKeys)) return false
  const brand = value.brand
  const product = value.product
  if (!isRecord(brand) || !hasExactKeys(brand, brandKeys) || !isRecord(product) || !hasExactKeys(product, productKeys)) return false
  return (value.assetId === null || isText(value.assetId, campaignBriefLimits.assetId, false))
    && isText(value.intent, campaignBriefLimits.intent)
    && isText(brand.name, campaignBriefLimits.brand.name)
    && isText(brand.tone, campaignBriefLimits.brand.tone)
    && isTextList(brand.colors, campaignBriefLimits.brand.colors.items, campaignBriefLimits.brand.colors.itemLength)
    && isText(brand.forbiddenWords, campaignBriefLimits.brand.forbiddenWords)
    && (brand.locale === 'zh-Hant' || brand.locale === 'en')
    && isText(brand.cta, campaignBriefLimits.brand.cta)
    && isText(brand.ctaEn, campaignBriefLimits.brand.ctaEn)
    && isText(product.name, campaignBriefLimits.product.name)
    && isText(product.nameEn, campaignBriefLimits.product.nameEn)
    && isText(product.category, campaignBriefLimits.product.category)
    && isTextList(product.benefits, campaignBriefLimits.product.benefits.items, campaignBriefLimits.product.benefits.itemLength)
    && isTextList(product.benefitsEn, campaignBriefLimits.product.benefitsEn.items, campaignBriefLimits.product.benefitsEn.itemLength)
    && isText(product.specifications, campaignBriefLimits.product.specifications)
    && isText(product.price, campaignBriefLimits.product.price)
    && isText(product.promotion, campaignBriefLimits.product.promotion)
    && isText(product.promotionEn, campaignBriefLimits.product.promotionEn)
    && isTextList(product.channels, campaignBriefLimits.product.channels.items, campaignBriefLimits.product.channels.itemLength)
}

function isCampaignAgentState(value: unknown): value is CampaignAgentState {
  if (!isRecord(value) || !hasExactKeys(value, stateKeys)) return false
  const checks = value.checks
  const plan = value.plan
  const messages = value.messages
  return ['idle', 'needs-input', 'awaiting-approval', 'approved'].includes(String(value.stage))
    && Number.isSafeInteger(value.revision)
    && Number(value.revision) >= 0
    && isText(value.summary, 1_000)
    && Array.isArray(checks)
    && checks.length <= 8
    && checks.every((item) => isRecord(item)
      && hasExactKeys(item, checkKeys)
      && ['facts', 'asset', 'claims', 'outputs'].includes(String(item.id))
      && isText(item.label, 1_000)
      && isText(item.detail, 1_000)
      && (item.status === 'complete' || item.status === 'action'))
    && Array.isArray(plan)
    && plan.length <= 3
    && plan.every((item) => isRecord(item)
      && hasExactKeys(item, planKeys)
      && ['store-main', 'social-ad', 'story'].includes(String(item.id))
      && ['store-main', 'detail-banner', 'promo-poster', 'meta-ad', 'package-showcase'].includes(String(item.workflowId))
      && ['1:1', '4:5', '9:16'].includes(String(item.ratio))
      && isText(item.label, 1_000)
      && isText(item.dimensions, 1_000)
      && isText(item.rationale, 1_000)
      && typeof item.selected === 'boolean')
    && Array.isArray(messages)
    && messages.length <= 12
    && messages.every((item) => isRecord(item)
      && hasExactKeys(item, messageKeys)
      && isText(item.id, 200, false)
      && (item.role === 'agent' || item.role === 'user')
      && isText(item.text, 2_000))
    && (value.mode === 'deterministic' || value.mode === 'assisted')
    && (value.approvedAt === null || isText(value.approvedAt, 64, false))
    && (value.brief === null || isCampaignBrief(value.brief))
}

function hasUniqueIds(items: Array<{ id: string }>) {
  return new Set(items.map((item) => item.id)).size === items.length
}

export function normalizeCampaignAgentState(value: unknown): CampaignAgentState | null {
  if (!isCampaignAgentState(value)
    || !hasUniqueIds(value.checks)
    || !hasUniqueIds(value.plan)
    || !hasUniqueIds(value.messages)) return null
  return value
}

export async function loadCampaignAgentState() {
  try {
    return await fetchWithTimeout(
      '/api/campaign-agent',
      { credentials: 'same-origin' },
      HYDRATION_REQUEST_TIMEOUT_MS,
      async (response) => {
        if (!response.ok || response.status !== 200) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(campaignAgentUnavailableMessage)
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (contentType !== 'application/json') {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(campaignAgentUnavailableMessage)
        }
        const data = await readBoundedJsonResponse(response, MAX_CAMPAIGN_AGENT_RESPONSE_BYTES)
        if (!isRecord(data) || !hasExactKeys(data, responseKeys)) throw new Error(campaignAgentUnavailableMessage)
        const state = normalizeCampaignAgentState(data.state)
        if (!state) throw new Error(campaignAgentUnavailableMessage)
        return state
      }
    )
  } catch {
    throw new Error(campaignAgentUnavailableMessage)
  }
}

export async function loadCampaignAgentSnapshot(): Promise<{
  state: CampaignAgentState | null
  error: string | null
}> {
  try {
    return { state: await loadCampaignAgentState(), error: null }
  } catch {
    return { state: null, error: campaignAgentUnavailableMessage }
  }
}
