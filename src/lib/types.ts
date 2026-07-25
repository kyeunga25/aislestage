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
  approvedRevision: number
  intent: string
  brand: BrandPack
  product: Product
  referenceImageUrls: string[]
  referenceAssetIds: string[]
}

export type GenerationResult = {
  id: string
  workflowId: WorkflowId
  aspectRatio: AspectRatio
  imageUrl: string | null
  title: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  errorMessage?: string | null
  contentType?: 'image/svg+xml' | 'image/png' | null
  approvedRevision?: number
  createdAt?: string
}

export type CreditBalance = {
  available: number
  reserved: number
}

export type AuthUser = {
  id: string
  email: string
  name: string
  accountStatus: 'active' | 'suspended' | 'deactivated'
  accountType: 'standard' | 'beta' | 'test'
}

export type WorkspaceSummary = {
  id: string
  name: string
  role: 'owner' | 'admin' | 'member'
  planStatus: string
  availableCredits: number
  reservedCredits: number
}

export type SessionPayload = {
  authenticated: boolean
  user?: AuthUser
  currentWorkspace?: WorkspaceSummary
}

export type PlatformStatus = {
  status: 'ok'
  service: string
  releaseMode: 'restricted'
  registrationMode: 'open' | 'invite' | 'closed'
  registrationOpen: boolean
  generationEnabled: boolean
  generationMode: 'disabled' | 'deterministic' | 'assisted'
  agentMode: 'deterministic' | 'assisted'
}

export type ProductAsset = {
  id: string
  name: string
  contentType: 'image/png' | 'image/jpeg' | 'image/webp'
  sizeBytes: number
  previewUrl: string
}

export type CampaignAgentStage = 'idle' | 'needs-input' | 'awaiting-approval' | 'approved'

export type CampaignBrief = {
  brand: BrandPack
  product: Product
  assetId: string | null
  intent: string
}

export type CampaignPlanItem = {
  id: 'store-main' | 'social-ad' | 'story'
  workflowId: WorkflowId
  ratio: '1:1' | '4:5' | '9:16'
  label: string
  dimensions: string
  rationale: string
  selected: boolean
}

export type CampaignAgentCheck = {
  id: 'facts' | 'asset' | 'claims' | 'outputs'
  label: string
  detail: string
  status: 'complete' | 'action'
}

export type CampaignAgentMessage = {
  id: string
  role: 'agent' | 'user'
  text: string
}

export type CampaignAgentState = {
  stage: CampaignAgentStage
  revision: number
  summary: string
  checks: CampaignAgentCheck[]
  plan: CampaignPlanItem[]
  messages: CampaignAgentMessage[]
  mode: 'deterministic' | 'assisted'
  approvedAt: string | null
  brief: CampaignBrief | null
}
