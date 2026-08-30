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
  ctaEn: string
}

export type SavedBrandPack = BrandPack & {
  id: string
  approvedRevision: number
  createdAt: string
}

export type Product = {
  name: string
  nameEn: string
  category: string
  benefits: string[]
  benefitsEn: string[]
  specifications: string
  price: string
  promotion: string
  promotionEn: string
  channels: string[]
}

export type SavedProductProfile = Product & {
  id: string
  approvedRevision: number
  createdAt: string
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
  campaignPackId?: string | null
  workflowId: WorkflowId
  aspectRatio: AspectRatio
  imageUrl: string | null
  downloadUrl?: string | null
  title: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  errorMessage?: string | null
  contentType?: 'image/svg+xml' | 'image/png' | null
  approvedRevision?: number
  createdAt?: string
  reviewStatus?: 'draft' | 'approved' | 'rejected'
  reviewedAt?: string | null
  provenance?: {
    approvedRevision: number
    compositionVersion: string | null
    generationMode: 'deterministic' | 'assisted' | null
  }
}

export type OutputAllowance = {
  available: number
  reserved: number
}

export type OutputUsageEventType = 'reservation' | 'settlement' | 'release'

export type OutputUsageEvent = {
  type: OutputUsageEventType
  amount: -1 | 0 | 1
  createdAt: string
}

export type OutputUsageSnapshot = {
  allowance: {
    availableOutputs: number
    reservedOutputs: number
    updatedAt: string
  }
  summary: {
    completedOutputs: number
    releasedOutputs: number
  }
  events: OutputUsageEvent[]
}

export type IntegrationReadinessSnapshot = {
  contractVersion: 'integration-readiness-v1'
  access: {
    authMode: 'access' | 'password'
    registrationMode: 'open' | 'invite' | 'closed'
  }
  generation: {
    requestedMode: 'disabled' | 'deterministic' | 'assisted'
    effectiveMode: 'disabled' | 'deterministic' | 'assisted'
    enabled: boolean
    maxActivePerWorkspace: number
  }
  agent: {
    requestedMode: 'deterministic' | 'assisted'
    effectiveMode: 'deterministic' | 'assisted'
  }
  assisted: {
    requested: boolean
    executionApproved: boolean
    gates: {
      providerAllowlisted: boolean
      dataPolicyApproved: boolean
      evaluationApproved: boolean
      budgetApproved: boolean
      credentialConfigured: boolean
    }
  }
  payment: {
    enabled: false
    checkoutAvailable: false
    subscriptionAvailable: false
    approvalRequired: true
  }
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
  accessStatus: 'active' | 'suspended' | 'closed'
  availableOutputs: number
  reservedOutputs: number
}

export type WorkspaceMember = {
  id: string
  name: string
  email: string
  role: 'owner' | 'admin' | 'member'
  accountStatus: 'active' | 'suspended' | 'deactivated'
  authMode: 'access' | 'password'
  createdAt: string
}

export type WorkspaceActivityEventType =
  | 'product_asset_uploaded'
  | 'product_asset_deleted'
  | 'campaign_pack_created'
  | 'generation_approved'
  | 'generation_rejected'
  | 'generation_deleted'

export type WorkspaceActivityEvent = {
  id: string
  type: WorkspaceActivityEventType
  actorName: string | null
  createdAt: string
}

export type SessionPayload = {
  authenticated: boolean
  user?: AuthUser
  currentWorkspace?: WorkspaceSummary
  code?: 'authentication-required' | 'authentication-invalid' | 'authentication-expired' | 'authentication-audience-mismatch' | 'authentication-issuer-mismatch' | 'authentication-signature-invalid' | 'identity-incomplete' | 'membership-required' | 'configuration-error' | 'unavailable'
  error?: string
}

export type PlatformStatus = {
  status: 'ok'
  service: string
  releaseMode: 'restricted'
  authMode: 'access' | 'password'
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
  widthPx: number | null
  heightPx: number | null
  rightsStatus: 'confirmed' | 'unconfirmed'
  previewUrl: string
}

export type ProductAssetListItem = ProductAsset & {
  createdAt: string
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
