export type Locale = 'zh-Hant' | 'en'

export type WorkflowId = 'store-main' | 'detail-banner' | 'promo-poster' | 'meta-ad' | 'package-showcase'

export type AspectRatio = '1:1' | '4:5' | '9:16' | '16:5'

export type Workflow = {
  id: WorkflowId
  icon: 'square' | 'panel' | 'poster' | 'ad' | 'box'
  title: string
  titleEn: string
  description: string
  defaultRatio: AspectRatio
  ratios: AspectRatio[]
}

export type BrandPack = {
  name: string
  tone: string
  colors: string[]
  forbiddenWords: string
  locale: Locale
  cta: string
}

export type Product = {
  name: string
  category: string
  benefits: string[]
  specifications: string
  price: string
  promotion: string
  channels: string[]
}

export type GenerationInput = {
  workspaceId: string
  workflowId: WorkflowId
  aspectRatio: AspectRatio
  brand: BrandPack
  product: Product
  referenceImageUrls: string[]
}

export type GenerationResult = {
  id: string
  workflowId: WorkflowId
  imageUrl: string
  title: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
}

export type CreditBalance = {
  available: number
  reserved: number
}
