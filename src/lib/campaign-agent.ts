import type { BrandPack, CampaignAgentCheck, CampaignAgentState, CampaignBrief, CampaignPlanItem, Product } from './types'

const MAX_TEXT = 500

function clean(value: unknown, max = MAX_TEXT) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function cleanList(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value) ? value.slice(0, maxItems).map((item) => clean(item, maxLength)).filter(Boolean) : []
}

export function sanitizeCampaignBrief(value: unknown): CampaignBrief {
  const candidate = value && typeof value === 'object' ? value as Partial<CampaignBrief> : {}
  const brand = candidate.brand && typeof candidate.brand === 'object' ? candidate.brand as Partial<BrandPack> : {}
  const product = candidate.product && typeof candidate.product === 'object' ? candidate.product as Partial<Product> : {}

  return {
    assetId: clean(candidate.assetId, 80) || null,
    intent: clean(candidate.intent, 120),
    brand: {
      name: clean(brand.name, 120),
      tone: clean(brand.tone, 240),
      colors: cleanList(brand.colors, 8, 24),
      forbiddenWords: clean(brand.forbiddenWords, 500),
      locale: brand.locale === 'en' ? 'en' : 'zh-Hant',
      cta: clean(brand.cta, 120),
      ctaEn: clean(brand.ctaEn, 120)
    },
    product: {
      name: clean(product.name, 160),
      nameEn: clean(product.nameEn, 160),
      category: clean(product.category, 120),
      benefits: cleanList(product.benefits, 8, 240),
      benefitsEn: cleanList(product.benefitsEn, 8, 240),
      specifications: clean(product.specifications, 1_000),
      price: clean(product.price, 120),
      promotion: clean(product.promotion, 240),
      promotionEn: clean(product.promotionEn, 240),
      channels: cleanList(product.channels, 12, 80)
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

export function buildCampaignPlan(briefValue: unknown, revision = 1, mode: CampaignAgentState['mode'] = 'deterministic'): CampaignAgentState {
  const brief = sanitizeCampaignBrief(briefValue)
  const missingFacts = [
    !brief.brand.name && '品牌名稱',
    !brief.product.name && '商品名稱',
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
