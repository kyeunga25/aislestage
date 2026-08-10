import type { BrandPack, CampaignAgentCheck, CampaignAgentState, CampaignBrief, CampaignPlanItem, Product } from './types'

export const campaignBriefLimits = {
  assetId: 80,
  intent: 120,
  brand: {
    name: 120,
    tone: 240,
    colors: { items: 8, itemLength: 24 },
    forbiddenWords: 500,
    cta: 120,
    ctaEn: 120
  },
  product: {
    name: 160,
    nameEn: 160,
    category: 120,
    benefits: { items: 8, itemLength: 240 },
    benefitsEn: { items: 8, itemLength: 240 },
    specifications: 1_000,
    price: 120,
    promotion: 240,
    promotionEn: 240,
    channels: { items: 12, itemLength: 80 }
  }
} as const

const MAX_TEXT = campaignBriefLimits.brand.forbiddenWords

function clean(value: unknown, max: number = MAX_TEXT) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function cleanList(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value) ? value.slice(0, maxItems).map((item) => clean(item, maxLength)).filter(Boolean) : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateTextField(issues: string[], source: Record<string, unknown>, key: string, maxLength: number, zhLabel: string, enLabel: string, allowNull = false) {
  const value = source[key]
  if (value === undefined || (allowNull && value === null)) return
  if (typeof value !== 'string') {
    issues.push(`${zhLabel}格式無效。 ${enLabel} must be text.`)
    return
  }
  if (value.trim().length > maxLength) issues.push(`${zhLabel}不得超過 ${maxLength} 個字元。 ${enLabel} must be ${maxLength} characters or fewer.`)
}

function validateTextList(issues: string[], source: Record<string, unknown>, key: string, maxItems: number, maxLength: number, zhLabel: string, enLabel: string) {
  const value = source[key]
  if (value === undefined) return
  if (!Array.isArray(value)) {
    issues.push(`${zhLabel}格式無效。 ${enLabel} must be a list of text values.`)
    return
  }
  if (value.length > maxItems) issues.push(`${zhLabel}最多可提供 ${maxItems} 項。 ${enLabel} accepts at most ${maxItems} items.`)
  value.forEach((item) => {
    if (typeof item !== 'string') issues.push(`${zhLabel}格式無效。 ${enLabel} must contain text values only.`)
    else if (item.trim().length > maxLength) issues.push(`${zhLabel}每項不得超過 ${maxLength} 個字元。 Each item in ${enLabel.toLowerCase()} must be ${maxLength} characters or fewer.`)
  })
}

export function validateCampaignBrief(value: unknown) {
  if (value === undefined || value === null) return []
  if (!isRecord(value)) return ['Campaign Brief 格式無效。Campaign Brief must be an object.']

  const issues: string[] = []
  const brandValue = value.brand
  const productValue = value.product
  const brand = isRecord(brandValue) ? brandValue : {}
  const product = isRecord(productValue) ? productValue : {}
  if (brandValue !== undefined && !isRecord(brandValue)) issues.push('品牌資料格式無效。Brand details must be an object.')
  if (productValue !== undefined && !isRecord(productValue)) issues.push('商品資料格式無效。Product details must be an object.')

  validateTextField(issues, value, 'assetId', campaignBriefLimits.assetId, '商品圖片識別碼', 'Product asset identifier', true)
  validateTextField(issues, value, 'intent', campaignBriefLimits.intent, '推廣目的', 'Campaign intent')
  validateTextField(issues, brand, 'name', campaignBriefLimits.brand.name, '品牌名稱', 'Brand name')
  validateTextField(issues, brand, 'tone', campaignBriefLimits.brand.tone, '品牌語氣', 'Brand tone')
  validateTextList(issues, brand, 'colors', campaignBriefLimits.brand.colors.items, campaignBriefLimits.brand.colors.itemLength, '品牌顏色', 'Brand colors')
  validateTextField(issues, brand, 'forbiddenWords', campaignBriefLimits.brand.forbiddenWords, '限制字詞', 'Forbidden words')
  validateTextField(issues, brand, 'cta', campaignBriefLimits.brand.cta, '行動呼籲', 'Call to action')
  validateTextField(issues, brand, 'ctaEn', campaignBriefLimits.brand.ctaEn, '英文行動呼籲', 'English call to action')
  if (brand.locale !== undefined && brand.locale !== 'zh-Hant' && brand.locale !== 'en') issues.push('語言設定格式無效；只支援繁體中文或英文。Locale must be zh-Hant or en.')

  validateTextField(issues, product, 'name', campaignBriefLimits.product.name, '商品名稱', 'Product name')
  validateTextField(issues, product, 'nameEn', campaignBriefLimits.product.nameEn, '英文商品名稱', 'English product name')
  validateTextField(issues, product, 'category', campaignBriefLimits.product.category, '商品類別', 'Product category')
  validateTextList(issues, product, 'benefits', campaignBriefLimits.product.benefits.items, campaignBriefLimits.product.benefits.itemLength, '產品賣點', 'Product benefits')
  validateTextList(issues, product, 'benefitsEn', campaignBriefLimits.product.benefitsEn.items, campaignBriefLimits.product.benefitsEn.itemLength, '英文產品賣點', 'English product benefits')
  validateTextField(issues, product, 'specifications', campaignBriefLimits.product.specifications, '商品規格', 'Product specifications')
  validateTextField(issues, product, 'price', campaignBriefLimits.product.price, '價格', 'Price')
  validateTextField(issues, product, 'promotion', campaignBriefLimits.product.promotion, '促銷資訊', 'Promotion')
  validateTextField(issues, product, 'promotionEn', campaignBriefLimits.product.promotionEn, '英文促銷資訊', 'English promotion')
  validateTextList(issues, product, 'channels', campaignBriefLimits.product.channels.items, campaignBriefLimits.product.channels.itemLength, '渠道', 'Channels')
  return [...new Set(issues)]
}

export function sanitizeCampaignBrief(value: unknown): CampaignBrief {
  const candidate = value && typeof value === 'object' ? value as Partial<CampaignBrief> : {}
  const brand = candidate.brand && typeof candidate.brand === 'object' ? candidate.brand as Partial<BrandPack> : {}
  const product = candidate.product && typeof candidate.product === 'object' ? candidate.product as Partial<Product> : {}

  return {
    assetId: clean(candidate.assetId, campaignBriefLimits.assetId) || null,
    intent: clean(candidate.intent, campaignBriefLimits.intent),
    brand: {
      name: clean(brand.name, campaignBriefLimits.brand.name),
      tone: clean(brand.tone, campaignBriefLimits.brand.tone),
      colors: cleanList(brand.colors, campaignBriefLimits.brand.colors.items, campaignBriefLimits.brand.colors.itemLength),
      forbiddenWords: clean(brand.forbiddenWords, campaignBriefLimits.brand.forbiddenWords),
      locale: brand.locale === 'en' ? 'en' : 'zh-Hant',
      cta: clean(brand.cta, campaignBriefLimits.brand.cta),
      ctaEn: clean(brand.ctaEn, campaignBriefLimits.brand.ctaEn)
    },
    product: {
      name: clean(product.name, campaignBriefLimits.product.name),
      nameEn: clean(product.nameEn, campaignBriefLimits.product.nameEn),
      category: clean(product.category, campaignBriefLimits.product.category),
      benefits: cleanList(product.benefits, campaignBriefLimits.product.benefits.items, campaignBriefLimits.product.benefits.itemLength),
      benefitsEn: cleanList(product.benefitsEn, campaignBriefLimits.product.benefitsEn.items, campaignBriefLimits.product.benefitsEn.itemLength),
      specifications: clean(product.specifications, campaignBriefLimits.product.specifications),
      price: clean(product.price, campaignBriefLimits.product.price),
      promotion: clean(product.promotion, campaignBriefLimits.product.promotion),
      promotionEn: clean(product.promotionEn, campaignBriefLimits.product.promotionEn),
      channels: cleanList(product.channels, campaignBriefLimits.product.channels.items, campaignBriefLimits.product.channels.itemLength)
    }
  }
}

export function initialCampaignAgentState(): CampaignAgentState {
  return {
    stage: 'idle',
    revision: 0,
    summary: '加入商品圖片及已核實的商業資料，Agent 會先整理輸出計劃。',
    checks: [],
    plan: [],
    messages: [{ id: 'welcome', role: 'agent', text: '我會檢查商品資料、建議三個渠道尺寸，並在你批准前停止。' }],
    mode: 'deterministic',
    approvedAt: null,
    brief: null
  }
}

export function campaignStateAfterAssetDeletion(state: CampaignAgentState, deletedAssetId: string | null) {
  return !deletedAssetId || state.brief?.assetId === deletedAssetId
    ? initialCampaignAgentState()
    : state
}

export function buildCampaignPlan(briefValue: unknown, revision = 1, mode: CampaignAgentState['mode'] = 'deterministic'): CampaignAgentState {
  const brief = sanitizeCampaignBrief(briefValue)
  const missingFacts = [
    !brief.brand.name && '品牌名稱',
    !brief.product.name && '商品名稱',
    !brief.product.category && '商品類別',
    !brief.product.price && '價格',
    !brief.product.promotion && '推廣內容',
    brief.product.benefits.filter(Boolean).length < 2 && '至少兩個賣點',
    !brief.product.nameEn && '英文商品名稱',
    !brief.product.promotionEn && '英文推廣內容',
    brief.product.benefitsEn.filter(Boolean).length < 2 && '至少兩個英文賣點',
    !brief.brand.ctaEn && '英文 CTA'
  ].filter(Boolean) as string[]

  const checks: CampaignAgentCheck[] = [
    {
      id: 'facts',
      label: missingFacts.length ? '商業資料尚未齊全' : '商業資料已核對',
      detail: missingFacts.length ? `請補充：${missingFacts.join('、')}` : '品牌、商品、價格、優惠及賣點已整理。',
      status: missingFacts.length ? 'action' : 'complete'
    },
    {
      id: 'asset',
      label: brief.assetId ? '商品圖片已就緒' : '仍需商品圖片',
      detail: brief.assetId ? '使用私人原圖作為合成來源，不重新繪製商品。' : '請先上傳有權用於商業宣傳的商品原圖。',
      status: brief.assetId ? 'complete' : 'action'
    },
    {
      id: 'claims',
      label: '宣稱與文字安全區已設定',
      detail: '只使用已提供的資料；價格、優惠與 CTA 會由程式排版。',
      status: 'complete'
    },
    {
      id: 'outputs',
      label: '三個渠道尺寸已配對',
      detail: '同一商品與推廣內容會延伸至主圖、動態消息及限時動態。',
      status: 'complete'
    }
  ]

  const plan: CampaignPlanItem[] = [
    { id: 'store-main', workflowId: 'store-main', ratio: '1:1', label: '商品主圖', dimensions: '1080 × 1080 px', rationale: '清楚呈現商品與核心優惠，適合商店及社交平台主圖。', selected: true },
    { id: 'social-ad', workflowId: 'meta-ad', ratio: '4:5', label: '社交廣告', dimensions: '1080 × 1350 px', rationale: '保留較大商品與文案區，適合動態消息。', selected: true },
    { id: 'story', workflowId: 'promo-poster', ratio: '9:16', label: '限時動態', dimensions: '1080 × 1920 px', rationale: '直向構圖預留安全區，適合手機全螢幕展示。', selected: true }
  ]

  const needsInput = missingFacts.length > 0 || !brief.assetId
  return {
    stage: needsInput ? 'needs-input' : 'awaiting-approval',
    revision,
    summary: needsInput
      ? '我已完成初步規劃，但需要你補齊標示項目才可批准。'
      : `建議以「${brief.intent || '日常推廣'}」為主題，建立三個一致但適應渠道的版面。`,
    checks,
    plan,
    messages: [
      { id: `review-${revision}`, role: 'agent', text: needsInput ? '我找到需要補充的資料，已在檢查清單標示。' : '資料檢查完成。我已準備三個輸出，等待你批准。' }
    ],
    mode,
    approvedAt: null,
    brief
  }
}
