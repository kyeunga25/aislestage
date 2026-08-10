import type { BrandPack, Product } from './types'

export function normalizeCampaignText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function campaignTextVisualUnits(value: string) {
  return Array.from(value).reduce((total, character) => total + (/^[\u0000-\u00ff]$/.test(character) ? 0.55 : 1), 0)
}

export function validateCampaignCopy(brand: BrandPack, product: Product) {
  const issues: string[] = []
  const benefits = product.benefits.filter(Boolean)
  const detailUnits = campaignTextVisualUnits(`${benefits.slice(0, 3).join(' · ')} ${product.specifications}`)
  if (campaignTextVisualUnits(normalizeCampaignText(brand.name)) > 13) issues.push('品牌名稱超出素材安全區。 Brand name exceeds the composition safe area.')
  if (campaignTextVisualUnits(normalizeCampaignText(product.name)) > 10) issues.push('商品名稱超出素材安全區。 Product name exceeds the composition safe area.')
  if (campaignTextVisualUnits(normalizeCampaignText(product.price)) > 9) issues.push('價格超出素材安全區。 Price exceeds the composition safe area.')
  if (campaignTextVisualUnits(normalizeCampaignText(product.promotion)) > 24) issues.push('優惠內容超出素材安全區。 Promotion exceeds the composition safe area.')
  if (campaignTextVisualUnits(normalizeCampaignText(brand.cta)) > 9) issues.push('CTA 超出素材安全區。 CTA exceeds the composition safe area.')
  if (benefits.length > 3) issues.push('每個素材最多顯示三個商品賣點。 Each asset can display at most three product benefits.')
  if (detailUnits > 85) issues.push('商品賣點與規格超出素材安全區。 Product benefits and specifications exceed the composition safe area.')
  return issues
}
