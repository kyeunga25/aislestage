import type { AspectRatio, BrandPack, Product } from './types'

type CampaignCompositionRatio = Extract<AspectRatio, '1:1' | '4:5' | '9:16'>

export const campaignTextLayouts: Record<CampaignCompositionRatio, {
  headingLineUnits: number
  promotionLineUnits: number
  detailLineUnits: number
  detailLineLimit: number
}> = {
  '1:1': { headingLineUnits: 5, promotionLineUnits: 12, detailLineUnits: 14, detailLineLimit: 7 },
  '4:5': { headingLineUnits: 18, promotionLineUnits: 24, detailLineUnits: 34, detailLineLimit: 4 },
  '9:16': { headingLineUnits: 15, promotionLineUnits: 24, detailLineUnits: 25, detailLineLimit: 4 }
}

export function normalizeCampaignText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function campaignTextVisualUnits(value: string) {
  return Array.from(value).reduce((total, character) => total + (/^[\u0000-\u00ff]$/.test(character) ? 0.55 : 1), 0)
}

function splitCampaignToken(token: string, maxUnits: number) {
  if (campaignTextVisualUnits(token) <= maxUnits) return [token]
  const parts: string[] = []
  let current = ''
  for (const character of Array.from(token)) {
    if (current && campaignTextVisualUnits(`${current}${character}`) > maxUnits) {
      parts.push(current)
      current = character
    } else {
      current += character
    }
  }
  if (current) parts.push(current)
  return parts
}

export function wrapCampaignText(value: string, maxUnits: number, maxLines: number) {
  const tokens = (normalizeCampaignText(value).match(/[A-Za-z0-9][A-Za-z0-9.+/%:-]*|\s+|./gu) || [])
    .flatMap((token) => splitCampaignToken(token, maxUnits))
  const lines: string[] = []
  let current = ''
  for (const token of tokens) {
    const next = `${current}${token}`
    if (current && campaignTextVisualUnits(next) > maxUnits) {
      lines.push(current.trimEnd())
      current = token.trimStart()
    } else {
      current = next
    }
  }
  if (current) lines.push(current.trimEnd())
  if (lines.length > maxLines) throw new Error('Commercial text exceeds the deterministic composition safe area.')
  return lines
}

export function campaignDetailLines(product: Product, ratio: CampaignCompositionRatio) {
  const textLayout = campaignTextLayouts[ratio]
  const benefits = product.benefits.filter(Boolean).slice(0, 3)
  const detailValues = ratio === '1:1'
    ? [...benefits, product.specifications]
    : [benefits.join(' · '), product.specifications]
  const lines = detailValues.filter(Boolean).flatMap((detail) => wrapCampaignText(detail, textLayout.detailLineUnits, textLayout.detailLineLimit))
  if (lines.length > textLayout.detailLineLimit) throw new Error('Commercial text exceeds the deterministic composition safe area.')
  return lines
}

function fitsEveryCampaignLayout(check: (ratio: CampaignCompositionRatio) => void) {
  return (Object.keys(campaignTextLayouts) as CampaignCompositionRatio[]).every((ratio) => {
    try {
      check(ratio)
      return true
    } catch {
      return false
    }
  })
}

export function validateCampaignCopy(brand: BrandPack, product: Product) {
  const issues: string[] = []
  const benefits = product.benefits.filter(Boolean)
  const detailUnits = campaignTextVisualUnits(`${benefits.slice(0, 3).join(' · ')} ${product.specifications}`)
  if (campaignTextVisualUnits(normalizeCampaignText(brand.name)) > 13) issues.push('品牌名稱超出素材安全區。 Brand name exceeds the composition safe area.')
  if (campaignTextVisualUnits(normalizeCampaignText(product.name)) > 10 || !fitsEveryCampaignLayout((ratio) => {
    wrapCampaignText(product.name, campaignTextLayouts[ratio].headingLineUnits, 2)
  })) issues.push('商品名稱超出素材安全區。 Product name exceeds the composition safe area.')
  if (campaignTextVisualUnits(normalizeCampaignText(product.price)) > 9) issues.push('價格超出素材安全區。 Price exceeds the composition safe area.')
  if (campaignTextVisualUnits(normalizeCampaignText(product.promotion)) > 24 || !fitsEveryCampaignLayout((ratio) => {
    wrapCampaignText(product.promotion, campaignTextLayouts[ratio].promotionLineUnits, 2)
  })) issues.push('優惠內容超出素材安全區。 Promotion exceeds the composition safe area.')
  if (campaignTextVisualUnits(normalizeCampaignText(brand.cta)) > 9) issues.push('CTA 超出素材安全區。 CTA exceeds the composition safe area.')
  if (benefits.length > 3) issues.push('每個素材最多顯示三個商品賣點。 Each asset can display at most three product benefits.')
  if (detailUnits > 85 || !fitsEveryCampaignLayout((ratio) => {
    campaignDetailLines(product, ratio)
  })) issues.push('商品賣點與規格超出素材安全區。 Product benefits and specifications exceed the composition safe area.')
  return issues
}
