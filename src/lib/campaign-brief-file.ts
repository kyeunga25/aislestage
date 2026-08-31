import { sanitizeCampaignBrief, validateCampaignBrief } from './campaign-agent'
import { isSafeBrandColorList } from './brand-color'
import type { BrandPack, Product } from './types'

export const campaignBriefFileContractVersion = 'aislestage-campaign-brief-v1' as const
export const campaignBriefFileIntents = ['限時優惠', '新品推廣', '日常銷售', '節日活動'] as const
export const campaignBriefFileTypeMessage = '只支援 AisleStage Campaign Brief JSON 檔案。 Only AisleStage Campaign Brief JSON files are supported.'
export const campaignBriefFileSizeMessage = 'Campaign Brief 檔案必須有內容且不可超過 64 KiB。 Campaign Brief file must be non-empty and no larger than 64 KiB.'
export const campaignBriefFileInvalidMessage = 'Campaign Brief 檔案版本、結構或欄位無效。 Campaign Brief file version, structure, or fields are invalid.'
export const campaignBriefFileUnavailableMessage = '未能完成本機 Campaign Brief 檔案讀取。 Unable to complete the local Campaign Brief file read.'

export type CampaignBriefFileData = {
  intent: string
  brand: BrandPack
  product: Product
}

const MAX_CAMPAIGN_BRIEF_FILE_BYTES = 64 * 1024
const CAMPAIGN_BRIEF_FILE_TIMEOUT_MS = 10_000
const acceptedJsonTypes = new Set(['', 'application/json', 'text/json'])
const fileDataKeys = new Set(['intent', 'brand', 'product'])
const envelopeKeys = new Set(['contractVersion', ...fileDataKeys])
const brandKeys = new Set(['name', 'tone', 'colors', 'forbiddenWords', 'locale', 'cta', 'ctaEn'])
const productKeys = new Set(['name', 'nameEn', 'category', 'benefits', 'benefitsEn', 'specifications', 'price', 'promotion', 'promotionEn', 'channels'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.size && actualKeys.every((key) => keys.has(key))
}

function normalizeFileData(value: unknown, envelope = false): CampaignBriefFileData {
  if (!isRecord(value)
    || !hasExactKeys(value, envelope ? envelopeKeys : fileDataKeys)
    || (envelope && value.contractVersion !== campaignBriefFileContractVersion)
    || !isRecord(value.brand)
    || !hasExactKeys(value.brand, brandKeys)
    || !isRecord(value.product)
    || !hasExactKeys(value.product, productKeys)) {
    throw new Error(campaignBriefFileInvalidMessage)
  }
  const candidate = {
    assetId: null,
    intent: value.intent,
    brand: value.brand,
    product: value.product
  }
  if (validateCampaignBrief(candidate).length > 0) throw new Error(campaignBriefFileInvalidMessage)
  const normalized = sanitizeCampaignBrief(candidate)
  if (!campaignBriefFileIntents.includes(normalized.intent as typeof campaignBriefFileIntents[number])) {
    throw new Error(campaignBriefFileInvalidMessage)
  }
  if (!isSafeBrandColorList(normalized.brand.colors, 8)
    || normalized.product.benefits.length > 3
    || normalized.product.benefitsEn.length > 3) {
    throw new Error(campaignBriefFileInvalidMessage)
  }
  return { intent: normalized.intent, brand: normalized.brand, product: normalized.product }
}

async function readLocalFile(file: File) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      file.arrayBuffer(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(campaignBriefFileUnavailableMessage)), CAMPAIGN_BRIEF_FILE_TIMEOUT_MS)
      })
    ])
  } catch {
    throw new Error(campaignBriefFileUnavailableMessage)
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

export async function parseCampaignBriefFile(file: File): Promise<CampaignBriefFileData> {
  if (!(file instanceof File)
    || !file.name.toLowerCase().endsWith('.json')
    || !acceptedJsonTypes.has(file.type.toLowerCase())) {
    throw new Error(campaignBriefFileTypeMessage)
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_CAMPAIGN_BRIEF_FILE_BYTES) {
    throw new Error(campaignBriefFileSizeMessage)
  }
  const buffer = await readLocalFile(file)
  if (buffer.byteLength !== file.size || buffer.byteLength > MAX_CAMPAIGN_BRIEF_FILE_BYTES) {
    throw new Error(campaignBriefFileInvalidMessage)
  }
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '')
  } catch {
    throw new Error(campaignBriefFileInvalidMessage)
  }
  let value: unknown
  try {
    value = JSON.parse(decoded)
  } catch {
    throw new Error(campaignBriefFileInvalidMessage)
  }
  return normalizeFileData(value, true)
}

export function serializeCampaignBriefFile(value: CampaignBriefFileData) {
  const normalized = normalizeFileData(value)
  const serialized = `${JSON.stringify({
    contractVersion: campaignBriefFileContractVersion,
    intent: normalized.intent,
    brand: normalized.brand,
    product: normalized.product
  }, null, 2)}\n`
  if (new TextEncoder().encode(serialized).byteLength > MAX_CAMPAIGN_BRIEF_FILE_BYTES) {
    throw new Error(campaignBriefFileInvalidMessage)
  }
  return serialized
}
