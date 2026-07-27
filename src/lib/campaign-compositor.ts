import { Buffer } from 'node:buffer'
import type { AspectRatio, GenerationInput } from './types'

export const CAMPAIGN_COMPOSITION_VERSION = 'deterministic-svg-v1'
export const CAMPAIGN_OUTPUT_CONTENT_TYPE = 'image/svg+xml' as const

type CompositionAsset = {
  base64: string
  contentType: 'image/png' | 'image/jpeg' | 'image/webp'
}

type CompositionOptions = {
  input: GenerationInput
  source: CompositionAsset
  background?: { base64: string; contentType: 'image/png' }
}

type Layout = {
  width: number
  height: number
  padding: number
  product: { x: number; y: number; width: number; height: number }
  headingY: number
  headingSize: number
  promotionY: number
  detailY: number
  priceY: number
  ctaY: number
  textWidth: number
  align: 'start' | 'middle'
}

const layouts: Record<'1:1' | '4:5' | '9:16', Layout> = {
  '1:1': {
    width: 1080,
    height: 1080,
    padding: 72,
    product: { x: 438, y: 132, width: 570, height: 640 },
    headingY: 230,
    headingSize: 54,
    promotionY: 358,
    detailY: 470,
    priceY: 856,
    ctaY: 942,
    textWidth: 320,
    align: 'start'
  },
  '4:5': {
    width: 1080,
    height: 1350,
    padding: 76,
    product: { x: 210, y: 390, width: 660, height: 610 },
    headingY: 196,
    headingSize: 58,
    promotionY: 318,
    detailY: 1050,
    priceY: 1188,
    ctaY: 1278,
    textWidth: 928,
    align: 'start'
  },
  '9:16': {
    width: 1080,
    height: 1920,
    padding: 82,
    product: { x: 132, y: 485, width: 816, height: 860 },
    headingY: 252,
    headingSize: 66,
    promotionY: 390,
    detailY: 1490,
    priceY: 1665,
    ctaY: 1790,
    textWidth: 916,
    align: 'start'
  }
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function normalizedText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function safeColor(value: string | undefined) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#155eef'
}

function visualUnits(value: string) {
  return Array.from(value).reduce((total, character) => total + (/^[\u0000-\u00ff]$/.test(character) ? 0.55 : 1), 0)
}

function chunkText(value: string, maxUnits: number, maxLines: number) {
  const tokens = normalizedText(value).match(/[A-Za-z0-9][A-Za-z0-9.+/%:-]*|\s+|./gu) || []
  const lines: string[] = []
  let current = ''
  for (const token of tokens) {
    const next = `${current}${token}`
    if (current && visualUnits(next) > maxUnits) {
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

function textLines(lines: string[], x: number, y: number, lineHeight: number, anchor: Layout['align'] = 'start') {
  return lines.map((line, index) => `<tspan x="${x}" y="${y + index * lineHeight}" text-anchor="${anchor}">${escapeXml(line)}</tspan>`).join('')
}

function campaignCopy(input: GenerationInput) {
  const benefits = input.product.benefits.filter(Boolean).slice(0, 3)
  return {
    brand: normalizedText(input.brand.name),
    name: normalizedText(input.product.name),
    promotion: normalizedText(input.product.promotion),
    benefits: benefits.map(normalizedText).filter(Boolean),
    specification: normalizedText(input.product.specifications),
    price: normalizedText(input.product.price),
    cta: normalizedText(input.brand.cta)
  }
}

export function validateCompositionInput(input: GenerationInput) {
  const issues: string[] = []
  const benefits = input.product.benefits.filter(Boolean)
  const detailUnits = visualUnits(`${benefits.slice(0, 3).join(' · ')} ${input.product.specifications}`)
  if (input.referenceAssetIds.length !== 1) issues.push('每個輸出必須使用一張已批准的商品圖片。')
  if (!['1:1', '4:5', '9:16'].includes(input.aspectRatio)) issues.push('這個輸出比例尚未支援確定性合成。')
  if (visualUnits(normalizedText(input.brand.name)) > 13) issues.push('品牌名稱超出素材安全區。')
  if (visualUnits(normalizedText(input.product.name)) > 10) issues.push('商品名稱超出素材安全區。')
  if (visualUnits(normalizedText(input.product.price)) > 9) issues.push('價格超出素材安全區。')
  if (visualUnits(normalizedText(input.product.promotion)) > 24) issues.push('優惠內容超出素材安全區。')
  if (visualUnits(normalizedText(input.brand.cta)) > 9) issues.push('CTA 超出素材安全區。')
  if (benefits.length > 3) issues.push('每個素材最多顯示三個商品賣點。')
  if (detailUnits > 85) issues.push('商品賣點與規格超出素材安全區。')
  return issues
}

export function bytesToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

export function composeCampaignSvg({ input, source, background }: CompositionOptions) {
  const ratio = input.aspectRatio as Extract<AspectRatio, '1:1' | '4:5' | '9:16'>
  const layout = layouts[ratio]
  if (!layout) throw new Error('Unsupported deterministic composition ratio.')
  const copy = campaignCopy(input)
  const accent = safeColor(input.brand.colors[0])
  const productHref = `data:${source.contentType};base64,${source.base64}`
  const backgroundImage = background
    ? `<image href="data:${background.contentType};base64,${background.base64}" x="0" y="0" width="${layout.width}" height="${layout.height}" preserveAspectRatio="xMidYMid slice" opacity="0.42"/><rect width="${layout.width}" height="${layout.height}" fill="url(#background-wash)"/>`
    : `<circle cx="${layout.width * 0.84}" cy="${layout.height * 0.2}" r="${Math.round(layout.width * 0.42)}" fill="${accent}" opacity="0.08"/><path d="M0 ${Math.round(layout.height * 0.76)} C ${Math.round(layout.width * 0.3)} ${Math.round(layout.height * 0.65)}, ${Math.round(layout.width * 0.68)} ${Math.round(layout.height * 0.92)}, ${layout.width} ${Math.round(layout.height * 0.72)} L ${layout.width} ${layout.height} L 0 ${layout.height} Z" fill="${accent}" opacity="0.055"/>`
  const headingCharacters = ratio === '1:1' ? 5 : ratio === '4:5' ? 18 : 15
  const detailCharacters = ratio === '1:1' ? 14 : ratio === '4:5' ? 34 : 25
  const productRadius = ratio === '9:16' ? 42 : 32
  const brandX = layout.align === 'middle' ? layout.width / 2 : layout.padding
  const detailValues = ratio === '1:1'
    ? [...copy.benefits, copy.specification]
    : [copy.benefits.join(' · '), copy.specification]
  const detailLines = detailValues.filter(Boolean).flatMap((detail) => chunkText(detail, detailCharacters, ratio === '1:1' ? 7 : 4))
  const detailLineLimit = ratio === '1:1' ? 7 : 4
  if (detailLines.length > detailLineLimit) throw new Error('Commercial text exceeds the deterministic composition safe area.')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(copy.name)} — ${escapeXml(copy.promotion)}</title>
  <desc id="description">AisleStage ${escapeXml(ratio)} Campaign Pack output</desc>
  <defs>
    <linearGradient id="canvas" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f4f7fc"/></linearGradient>
    <linearGradient id="background-wash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.7"/><stop offset="0.55" stop-color="#ffffff" stop-opacity="0.42"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.94"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="20" stdDeviation="28" flood-color="#172033" flood-opacity="0.14"/></filter>
    <clipPath id="product-clip"><rect x="${layout.product.x}" y="${layout.product.y}" width="${layout.product.width}" height="${layout.product.height}" rx="${productRadius}"/></clipPath>
  </defs>
  <rect width="${layout.width}" height="${layout.height}" fill="url(#canvas)"/>
  ${backgroundImage}
  <text x="${brandX}" y="${layout.padding}" fill="#172033" font-family="Arial, 'Noto Sans TC', sans-serif" font-size="24" font-weight="700" letter-spacing="2" text-anchor="${layout.align}">${escapeXml(copy.brand)}</text>
  <rect x="${layout.padding}" y="${layout.padding + 30}" width="78" height="5" rx="2.5" fill="${accent}"/>
  <text fill="#172033" font-family="Arial, 'Noto Sans TC', sans-serif" font-size="${layout.headingSize}" font-weight="800" letter-spacing="-1">${textLines(chunkText(copy.name, headingCharacters, 2), layout.padding, layout.headingY, layout.headingSize * 1.12, layout.align)}</text>
  <text fill="${accent}" font-family="Arial, 'Noto Sans TC', sans-serif" font-size="${ratio === '9:16' ? 34 : 30}" font-weight="700">${textLines(chunkText(copy.promotion, ratio === '1:1' ? 12 : 24, 2), layout.padding, layout.promotionY, 42, layout.align)}</text>
  <rect x="${layout.product.x}" y="${layout.product.y}" width="${layout.product.width}" height="${layout.product.height}" rx="${productRadius}" fill="#ffffff" filter="url(#shadow)"/>
  <image href="${productHref}" x="${layout.product.x + 24}" y="${layout.product.y + 24}" width="${layout.product.width - 48}" height="${layout.product.height - 48}" preserveAspectRatio="xMidYMid meet" clip-path="url(#product-clip)"/>
  <rect x="${layout.product.x}" y="${layout.product.y}" width="${layout.product.width}" height="${layout.product.height}" rx="${productRadius}" fill="none" stroke="#dfe6f0" stroke-width="2"/>
  <text fill="#5d687d" font-family="Arial, 'Noto Sans TC', sans-serif" font-size="${ratio === '9:16' ? 28 : 24}" font-weight="500">${textLines(detailLines, layout.padding, layout.detailY, ratio === '9:16' ? 42 : 36, layout.align)}</text>
  <text x="${layout.padding}" y="${layout.priceY}" fill="#172033" font-family="Arial, 'Noto Sans TC', sans-serif" font-size="${ratio === '9:16' ? 72 : 64}" font-weight="800" text-anchor="${layout.align}">${escapeXml(copy.price)}</text>
  <rect x="${layout.padding}" y="${layout.ctaY - (ratio === '9:16' ? 72 : 58)}" width="${Math.min(layout.textWidth, Math.max(210, Array.from(copy.cta).length * 34 + 84))}" height="${ratio === '9:16' ? 82 : 68}" rx="${ratio === '9:16' ? 16 : 13}" fill="${accent}"/>
  <text x="${layout.padding + 34}" y="${layout.ctaY - (ratio === '9:16' ? 20 : 16)}" fill="#ffffff" font-family="Arial, 'Noto Sans TC', sans-serif" font-size="${ratio === '9:16' ? 31 : 26}" font-weight="700">${escapeXml(copy.cta)}</text>
  <text x="${layout.width - layout.padding}" y="${layout.height - 42}" fill="#7c8799" font-family="Arial, sans-serif" font-size="18" text-anchor="end">AisleStage · ${escapeXml(ratio)}</text>
</svg>`
}
