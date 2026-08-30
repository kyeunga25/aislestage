import { CircleHelp, LogOut, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import demoSpeaker from './assets/demo-speaker.png'
import campaignScene from './assets/campaign-speaker-scene.png'
import { AccessLoginPage } from './components/AccessGate'
import { AuthPage } from './components/AuthPage'
import { BrandMark } from './components/BrandMark'
import { CampaignWorkspace, type ImageState } from './components/CampaignWorkspace'
import { CollectionView } from './components/CollectionView'
import type { NavigationSection } from './components/Icon'
import { LandingPage } from './components/LandingPage'
import { ResultsPanel } from './components/ResultsPanel'
import { Sidebar } from './components/Sidebar'
import { WorkspaceActivityView } from './components/WorkspaceActivityView'
import { WorkspaceAccessView, type WorkspaceAccessMutation } from './components/WorkspaceAccessView'
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher'
import { WorkspaceUsageView } from './components/WorkspaceUsageView'
import { loadBrandPackListSnapshot, saveApprovedBrandPack } from './lib/brand-pack-client'
import { buildCampaignPlan, campaignStateAfterAssetDeletion, initialCampaignAgentState } from './lib/campaign-agent'
import { submitCampaignAgentAction } from './lib/campaign-agent-client'
import { loadCampaignAgentSnapshot, loadCampaignAgentState } from './lib/campaign-agent-loader'
import { createCampaignPack } from './lib/campaign-pack-client'
import { pollCampaignPack } from './lib/campaign-pack-poller'
import { demoResults, emptyBrand, emptyProduct, starterBrand, starterProduct } from './lib/demo-data'
import { isPublicDemoPath } from './lib/demo-mode'
import type { AccessFailureReason } from './lib/access-login'
import { generationListUnavailableMessage, loadGenerationSnapshot } from './lib/generation-loader'
import { generationReviewSourceInvalidMessage, submitGenerationReview } from './lib/generation-review-client'
import {
  productAssetSizeMessage,
  productAssetTypeMessage,
  productAssetUploadUnavailableMessage,
  uploadProductAsset
} from './lib/product-asset-client'
import { loadProductAssetListSnapshot } from './lib/product-asset-list-loader'
import { loadProductProfileListSnapshot, saveApprovedProductProfile } from './lib/product-profile-client'
import { deletePrivateResource } from './lib/private-delete-client'
import { logoutPasswordSession, passwordLogoutUnavailableMessage } from './lib/password-logout-client'
import { loadOutputUsageSnapshot } from './lib/output-usage-loader'
import type { BrandPack, CampaignAgentState, GenerationResult, OutputUsageSnapshot, PlatformStatus, Product, ProductAssetListItem, SavedBrandPack, SavedProductProfile, WorkspaceActivityEvent, WorkspaceMember, WorkspaceSummary } from './lib/types'
import { createWorkspaceBootstrapLoader } from './lib/workspace-bootstrap'
import { loadWorkspaceActivitySnapshot } from './lib/workspace-activity-loader'
import {
  inviteWorkspaceMember as submitWorkspaceMemberInvite,
  loadWorkspaceMembersSnapshot,
  removeWorkspaceMember as submitWorkspaceMemberRemoval,
  updateWorkspaceMemberRole as submitWorkspaceMemberRole
} from './lib/workspace-access-client'
import { loadSession, type AuthedSession } from './lib/workspace-bootstrap-loader'
import { loadWorkspaceListSnapshot, selectCurrentWorkspace, workspaceSelectionUnavailableMessage } from './lib/workspace-selection-client'
import { persistSelectedWorkspaceId, workspaceIdFromSelectionEvent } from './lib/workspace-selection-storage'

const demoSession: AuthedSession = {
  user: { id: 'demo-user', email: 'demo@example.test', name: 'Demo User', accountStatus: 'active', accountType: 'test' },
  currentWorkspace: { id: 'demo-workspace', name: 'Example Store', role: 'owner', accessStatus: 'active', availableOutputs: 6, reservedOutputs: 0 }
}

const restrictedPlatformStatus: PlatformStatus = { status: 'ok', service: 'campaign-asset-worker', releaseMode: 'restricted', authMode: 'access', registrationMode: 'closed', registrationOpen: false, generationEnabled: false, generationMode: 'disabled', agentMode: 'deterministic' }
const localPlatformStatus: PlatformStatus = { ...restrictedPlatformStatus, authMode: 'password', registrationMode: 'open', registrationOpen: true, generationEnabled: true, generationMode: 'deterministic' }
const demoPlatformStatus: PlatformStatus = { ...restrictedPlatformStatus, authMode: 'password', generationEnabled: true, generationMode: 'deterministic' }
const demoActivity: WorkspaceActivityEvent[] = [
  { id: 'demo-activity-pack', type: 'campaign_pack_created', actorName: 'Demo User', createdAt: '2026-08-30T04:00:00Z' },
  { id: 'demo-activity-review', type: 'generation_approved', actorName: 'Demo User', createdAt: '2026-08-30T04:05:00Z' }
]
const demoOutputUsage: OutputUsageSnapshot = {
  allowance: { availableOutputs: 6, reservedOutputs: 0, updatedAt: '2026-08-30T04:05:00Z' },
  summary: { completedOutputs: 3, releasedOutputs: 1 },
  events: [
    { type: 'settlement', amount: 0, createdAt: '2026-08-30T04:05:00Z' },
    { type: 'release', amount: 1, createdAt: '2026-08-30T04:03:00Z' },
    { type: 'reservation', amount: -1, createdAt: '2026-08-30T04:00:00Z' }
  ]
}
const demoWorkspaceMembers: WorkspaceMember[] = [
  {
    id: 'demo-user',
    name: 'Demo User',
    email: 'demo@example.test',
    role: 'owner',
    accountStatus: 'active',
    authMode: 'access',
    createdAt: '2026-08-30T03:45:00Z'
  },
  {
    id: 'demo-member',
    name: 'Campaign Reviewer',
    email: 'reviewer@example.test',
    role: 'member',
    accountStatus: 'active',
    authMode: 'access',
    createdAt: '2026-08-30T03:50:00Z'
  }
]
const demoProductAssets: ProductAssetListItem[] = [{
  id: '123e4567-e89b-42d3-a456-426614174100',
  name: 'product-image.png',
  contentType: 'image/png',
  sizeBytes: 1_000_640,
  previewUrl: demoSpeaker,
  createdAt: '2026-08-30T03:55:00Z'
}]
const demoBrandPacks: SavedBrandPack[] = [{
  ...starterBrand,
  id: '123e4567-e89b-42d3-a456-426614174110',
  approvedRevision: 1,
  createdAt: '2026-08-30T04:10:00Z'
}]
const demoProductProfiles: SavedProductProfile[] = [{
  ...starterProduct,
  id: '123e4567-e89b-42d3-a456-426614174120',
  approvedRevision: 1,
  createdAt: '2026-08-30T04:12:00Z'
}]

function brandFromSavedBrandPack({ id: _id, approvedRevision: _approvedRevision, createdAt: _createdAt, ...brand }: SavedBrandPack): BrandPack {
  return brand
}

function savedBrandMatches(saved: SavedBrandPack, brand: BrandPack) {
  return JSON.stringify(brandFromSavedBrandPack(saved)) === JSON.stringify(brand)
}

function productFromSavedProductProfile({ id: _id, approvedRevision: _approvedRevision, createdAt: _createdAt, ...product }: SavedProductProfile): Product {
  return product
}

function savedProductMatches(saved: SavedProductProfile, product: Product) {
  return JSON.stringify(productFromSavedProductProfile(saved)) === JSON.stringify(product)
}

function WorkspaceApp({ demoMode = false }: { demoMode?: boolean }) {
  const previewMode = import.meta.env.DEV || demoMode
  const [session, setSession] = useState<AuthedSession | null>(demoMode ? demoSession : null)
  const [accessFailure, setAccessFailure] = useState<AccessFailureReason>('authentication-required')
  const [isLoadingSession, setIsLoadingSession] = useState(!demoMode)
  const [platformStatus, setPlatformStatus] = useState<PlatformStatus>(demoMode ? demoPlatformStatus : import.meta.env.DEV ? localPlatformStatus : restrictedPlatformStatus)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>(demoMode ? [demoSession.currentWorkspace] : [])
  const [workspaceListNotice, setWorkspaceListNotice] = useState('')
  const [isRefreshingWorkspaceList, setIsRefreshingWorkspaceList] = useState(false)
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false)
  const [activeSection, setActiveSection] = useState<NavigationSection>('workspace')
  const [brand, setBrand] = useState<BrandPack>(previewMode ? starterBrand : emptyBrand)
  const [product, setProduct] = useState<Product>(previewMode ? starterProduct : emptyProduct)
  const [intent, setIntent] = useState('限時優惠')
  const [image, setImage] = useState<ImageState>(previewMode
    ? { name: 'minibeat_speaker_black.png', url: demoSpeaker, asset: null, status: 'demo', error: '' }
    : { name: '尚未選擇圖片', url: '', asset: null, status: 'error', error: '請上傳商品原圖' })
  const [agentState, setAgentState] = useState<CampaignAgentState>(initialCampaignAgentState())
  const [agentBusy, setAgentBusy] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isDeletingProductImage, setIsDeletingProductImage] = useState(false)
  const [deletingGenerationId, setDeletingGenerationId] = useState<string | null>(null)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewingDecision, setReviewingDecision] = useState<'approve' | 'reject' | null>(null)
  const [isRefreshingResults, setIsRefreshingResults] = useState(false)
  const [serverResults, setServerResults] = useState<GenerationResult[]>([])
  const [productAssets, setProductAssets] = useState<ProductAssetListItem[]>(demoMode ? demoProductAssets : [])
  const [productAssetNotice, setProductAssetNotice] = useState('')
  const [isRefreshingProductAssets, setIsRefreshingProductAssets] = useState(false)
  const [deletingProductAssetId, setDeletingProductAssetId] = useState<string | null>(null)
  const [productProfiles, setProductProfiles] = useState<SavedProductProfile[]>(demoMode ? demoProductProfiles : [])
  const [selectedProductProfileId, setSelectedProductProfileId] = useState<string | null>(null)
  const [productProfileNotice, setProductProfileNotice] = useState('')
  const [isRefreshingProductProfiles, setIsRefreshingProductProfiles] = useState(false)
  const [isSavingProductProfile, setIsSavingProductProfile] = useState(false)
  const [deletingProductProfileId, setDeletingProductProfileId] = useState<string | null>(null)
  const [brandPacks, setBrandPacks] = useState<SavedBrandPack[]>(demoMode ? demoBrandPacks : [])
  const [selectedBrandPackId, setSelectedBrandPackId] = useState<string | null>(null)
  const [brandPackNotice, setBrandPackNotice] = useState('')
  const [isRefreshingBrandPacks, setIsRefreshingBrandPacks] = useState(false)
  const [isSavingBrandPack, setIsSavingBrandPack] = useState(false)
  const [deletingBrandPackId, setDeletingBrandPackId] = useState<string | null>(null)
  const [workspaceActivity, setWorkspaceActivity] = useState<WorkspaceActivityEvent[]>(demoMode ? demoActivity : [])
  const [activityNotice, setActivityNotice] = useState('')
  const [isRefreshingActivity, setIsRefreshingActivity] = useState(false)
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>(demoMode ? demoWorkspaceMembers : [])
  const [workspaceAccessNotice, setWorkspaceAccessNotice] = useState('')
  const [isRefreshingWorkspaceMembers, setIsRefreshingWorkspaceMembers] = useState(false)
  const [workspaceAccessMutation, setWorkspaceAccessMutation] = useState<WorkspaceAccessMutation | null>(null)
  const [outputUsage, setOutputUsage] = useState<OutputUsageSnapshot | null>(demoMode ? demoOutputUsage : null)
  const [outputUsageNotice, setOutputUsageNotice] = useState('')
  const [isRefreshingOutputUsage, setIsRefreshingOutputUsage] = useState(false)
  const [notice, setNotice] = useState('')
  const generationRequestKey = useRef<string | null>(null)
  const productImageDeleteLock = useRef(false)
  const generationDeleteLock = useRef(false)
  const generationReviewLock = useRef(false)
  const generationRefreshLock = useRef(false)
  const generationRefreshEpoch = useRef(0)
  const productAssetRefreshLock = useRef(false)
  const productAssetRefreshEpoch = useRef(0)
  const productProfileMutationLock = useRef(false)
  const productProfileRefreshLock = useRef(false)
  const productProfileRefreshEpoch = useRef(0)
  const brandPackMutationLock = useRef(false)
  const brandPackRefreshLock = useRef(false)
  const brandPackRefreshEpoch = useRef(0)
  const activityRefreshLock = useRef(false)
  const activityRefreshEpoch = useRef(0)
  const workspaceAccessRefreshLock = useRef(false)
  const workspaceAccessRefreshEpoch = useRef(0)
  const workspaceAccessMutationLock = useRef(false)
  const workspaceAccessMutationEpoch = useRef(0)
  const workspaceListRefreshLock = useRef(false)
  const workspaceListRefreshEpoch = useRef(0)
  const workspaceSwitchLock = useRef(false)
  const outputUsageRefreshLock = useRef(false)
  const outputUsageRefreshEpoch = useRef(0)
  const workspaceHydrationEpoch = useRef(0)
  const campaignPackLock = useRef(false)
  const campaignAgentLock = useRef(false)
  const workspaceBootstrapLoader = useRef<ReturnType<typeof createWorkspaceBootstrapLoader> | null>(null)
  if (!workspaceBootstrapLoader.current) workspaceBootstrapLoader.current = createWorkspaceBootstrapLoader()

  function applyCampaignState(nextState: CampaignAgentState) {
    setAgentState(nextState)
    if (!nextState.brief) {
      setBrand(emptyBrand)
      setProduct(emptyProduct)
      setIntent('限時優惠')
      setImage({ name: '尚未選擇圖片', url: '', asset: null, status: 'error', error: '請上傳商品原圖' })
      setSelectedBrandPackId(null)
      setSelectedProductProfileId(null)
      return
    }
    setBrand(nextState.brief.brand)
    setProduct(nextState.brief.product)
    setIntent(nextState.brief.intent || '限時優惠')
    setSelectedBrandPackId((current) => {
      const selected = brandPacks.find((saved) => saved.id === current)
      return selected && savedBrandMatches(selected, nextState.brief!.brand) ? current : null
    })
    setSelectedProductProfileId((current) => {
      const selected = productProfiles.find((saved) => saved.id === current)
      return selected && savedProductMatches(selected, nextState.brief!.product) ? current : null
    })
    if (nextState.brief.assetId) {
      const previewUrl = `/api/assets/${nextState.brief.assetId}`
      setImage({
        name: '已保存的商品圖片',
        url: previewUrl,
        asset: { id: nextState.brief.assetId, name: '已保存的商品圖片', contentType: 'image/png', sizeBytes: 0, previewUrl },
        status: 'ready',
        error: ''
      })
    }
  }

  function applyWorkspaceSnapshots(
    generationSnapshot: Awaited<ReturnType<typeof loadGenerationSnapshot>>,
    campaignAgentSnapshot: Awaited<ReturnType<typeof loadCampaignAgentSnapshot>>,
    hydrationEpoch: number,
    generationEpoch: number
  ) {
    if (hydrationEpoch !== workspaceHydrationEpoch.current) return
    const generationSnapshotCurrent = generationEpoch === generationRefreshEpoch.current
    if (generationSnapshotCurrent && generationSnapshot.results !== null) setServerResults(generationSnapshot.results)
    if (campaignAgentSnapshot.state !== null) applyCampaignState(campaignAgentSnapshot.state)
    const availabilityErrors = [generationSnapshotCurrent ? generationSnapshot.error : null, campaignAgentSnapshot.error].filter(Boolean)
    if (availabilityErrors.length) setNotice(availabilityErrors.join(' '))
  }

  async function hydrateWorkspace(nextSession: AuthedSession) {
    const hydrationEpoch = ++workspaceHydrationEpoch.current
    const generationEpoch = ++generationRefreshEpoch.current
    const [generationSnapshot, campaignAgentSnapshot] = await Promise.all([
      loadGenerationSnapshot(nextSession.currentWorkspace.id),
      loadCampaignAgentSnapshot()
    ])
    applyWorkspaceSnapshots(generationSnapshot, campaignAgentSnapshot, hydrationEpoch, generationEpoch)
  }

  function mergeCurrentWorkspaceSummary(nextWorkspace: WorkspaceSummary) {
    setWorkspaces((current) => {
      const remaining = current.filter((workspace) => workspace.id !== nextWorkspace.id)
      return [nextWorkspace, ...remaining]
    })
  }

  async function refreshSessionState() {
    const refreshedSession = await loadSession().catch(() => null)
    if (!refreshedSession?.session) return false
    setSession(refreshedSession.session)
    mergeCurrentWorkspaceSummary(refreshedSession.session.currentWorkspace)
    return true
  }

  async function refreshWorkspaceList() {
    if (!session
      || session.user.id === 'demo-user'
      || workspaceListRefreshLock.current
      || workspaceSwitchLock.current) return
    workspaceListRefreshLock.current = true
    const refreshEpoch = ++workspaceListRefreshEpoch.current
    const hydrationEpoch = workspaceHydrationEpoch.current
    const currentWorkspaceId = session.currentWorkspace.id
    setIsRefreshingWorkspaceList(true)
    setWorkspaceListNotice('')
    try {
      const snapshot = await loadWorkspaceListSnapshot()
      if (refreshEpoch !== workspaceListRefreshEpoch.current
        || hydrationEpoch !== workspaceHydrationEpoch.current) return
      if (snapshot.workspaceList) {
        if (snapshot.workspaceList.currentWorkspace.id !== currentWorkspaceId) {
          persistSelectedWorkspaceId(snapshot.workspaceList.currentWorkspace.id)
          window.location.reload()
          return
        }
        setWorkspaces(snapshot.workspaceList.workspaces)
      }
      if (snapshot.error) setWorkspaceListNotice(snapshot.error)
    } finally {
      if (refreshEpoch === workspaceListRefreshEpoch.current) {
        workspaceListRefreshLock.current = false
        setIsRefreshingWorkspaceList(false)
      }
    }
  }

  function workspaceMutationPending() {
    return agentBusy
      || isGenerating
      || isLoggingOut
      || isDeletingProductImage
      || image.status === 'uploading'
      || deletingGenerationId !== null
      || reviewingId !== null
      || deletingProductAssetId !== null
      || isSavingProductProfile
      || deletingProductProfileId !== null
      || isSavingBrandPack
      || deletingBrandPackId !== null
      || workspaceAccessMutation !== null
      || campaignPackLock.current
      || campaignAgentLock.current
      || productProfileMutationLock.current
      || brandPackMutationLock.current
      || workspaceAccessMutationLock.current
  }

  async function switchWorkspace(workspaceId: string) {
    if (!session
      || session.user.id === 'demo-user'
      || workspaceId === session.currentWorkspace.id
      || workspaceSwitchLock.current
      || workspaceMutationPending()) return
    workspaceSwitchLock.current = true
    setIsSwitchingWorkspace(true)
    setWorkspaceListNotice('')
    let switched = false
    try {
      const selected = await selectCurrentWorkspace(workspaceId)
      if (selected.id !== workspaceId) throw new Error(workspaceSelectionUnavailableMessage)
      switched = true
      window.location.reload()
    } catch (error) {
      setWorkspaceListNotice(error instanceof Error ? error.message : workspaceSelectionUnavailableMessage)
    } finally {
      if (!switched) {
        workspaceSwitchLock.current = false
        setIsSwitchingWorkspace(false)
      }
    }
  }

  async function refreshGenerationResults() {
    if (!session
      || session.user.id === 'demo-user'
      || generationRefreshLock.current
      || generationDeleteLock.current
      || generationReviewLock.current) return
    generationRefreshLock.current = true
    const refreshEpoch = ++generationRefreshEpoch.current
    const workspaceId = session.currentWorkspace.id
    setIsRefreshingResults(true)
    setNotice('')
    try {
      const snapshot = await loadGenerationSnapshot(workspaceId)
      if (refreshEpoch !== generationRefreshEpoch.current) return
      if (snapshot.results !== null) {
        setServerResults(snapshot.results)
      } else {
        setNotice(snapshot.error || generationListUnavailableMessage)
      }
    } finally {
      if (refreshEpoch === generationRefreshEpoch.current) {
        generationRefreshLock.current = false
        setIsRefreshingResults(false)
      }
    }
  }

  async function refreshProductAssets() {
    if (!session
      || session.user.id === 'demo-user'
      || productAssetRefreshLock.current
      || productImageDeleteLock.current) return
    productAssetRefreshLock.current = true
    const refreshEpoch = ++productAssetRefreshEpoch.current
    setIsRefreshingProductAssets(true)
    setProductAssetNotice('')
    try {
      const snapshot = await loadProductAssetListSnapshot()
      if (refreshEpoch !== productAssetRefreshEpoch.current) return
      if (snapshot.assets !== null) {
        setProductAssets(snapshot.assets)
        setImage((current) => {
          const canonicalAsset = snapshot.assets?.find((asset) => asset.id === current.asset?.id)
          return canonicalAsset
            ? { ...current, name: canonicalAsset.name, url: canonicalAsset.previewUrl, asset: canonicalAsset }
            : current
        })
      }
      if (snapshot.error) setProductAssetNotice(snapshot.error)
    } finally {
      if (refreshEpoch === productAssetRefreshEpoch.current) {
        productAssetRefreshLock.current = false
        setIsRefreshingProductAssets(false)
      }
    }
  }

  async function refreshProductProfiles() {
    if (!session
      || session.user.id === 'demo-user'
      || productProfileRefreshLock.current
      || productProfileMutationLock.current) return
    productProfileRefreshLock.current = true
    const refreshEpoch = ++productProfileRefreshEpoch.current
    setIsRefreshingProductProfiles(true)
    setProductProfileNotice('')
    try {
      const snapshot = await loadProductProfileListSnapshot()
      if (refreshEpoch !== productProfileRefreshEpoch.current) return
      if (snapshot.productProfiles !== null) {
        setProductProfiles(snapshot.productProfiles)
        setSelectedProductProfileId((current) => current && snapshot.productProfiles?.some((saved) => saved.id === current) ? current : null)
      }
      if (snapshot.error) setProductProfileNotice(snapshot.error)
    } finally {
      if (refreshEpoch === productProfileRefreshEpoch.current) {
        productProfileRefreshLock.current = false
        setIsRefreshingProductProfiles(false)
      }
    }
  }

  async function refreshBrandPacks() {
    if (!session
      || session.user.id === 'demo-user'
      || brandPackRefreshLock.current
      || brandPackMutationLock.current) return
    brandPackRefreshLock.current = true
    const refreshEpoch = ++brandPackRefreshEpoch.current
    setIsRefreshingBrandPacks(true)
    setBrandPackNotice('')
    try {
      const snapshot = await loadBrandPackListSnapshot()
      if (refreshEpoch !== brandPackRefreshEpoch.current) return
      if (snapshot.brandPacks !== null) {
        setBrandPacks(snapshot.brandPacks)
        setSelectedBrandPackId((current) => current && snapshot.brandPacks?.some((saved) => saved.id === current) ? current : null)
      }
      if (snapshot.error) setBrandPackNotice(snapshot.error)
    } finally {
      if (refreshEpoch === brandPackRefreshEpoch.current) {
        brandPackRefreshLock.current = false
        setIsRefreshingBrandPacks(false)
      }
    }
  }

  async function refreshWorkspaceActivity() {
    if (!session
      || session.user.id === 'demo-user'
      || (session.currentWorkspace.role !== 'owner' && session.currentWorkspace.role !== 'admin')
      || activityRefreshLock.current) return
    activityRefreshLock.current = true
    const refreshEpoch = ++activityRefreshEpoch.current
    setIsRefreshingActivity(true)
    setActivityNotice('')
    try {
      const snapshot = await loadWorkspaceActivitySnapshot()
      if (refreshEpoch !== activityRefreshEpoch.current) return
      if (snapshot.activity !== null) setWorkspaceActivity(snapshot.activity)
      if (snapshot.error) setActivityNotice(snapshot.error)
    } finally {
      if (refreshEpoch === activityRefreshEpoch.current) {
        activityRefreshLock.current = false
        setIsRefreshingActivity(false)
      }
    }
  }

  async function refreshWorkspaceMembers() {
    if (!session
      || session.user.id === 'demo-user'
      || (session.currentWorkspace.role !== 'owner' && session.currentWorkspace.role !== 'admin')
      || workspaceAccessRefreshLock.current
      || workspaceAccessMutationLock.current) return
    workspaceAccessRefreshLock.current = true
    const refreshEpoch = ++workspaceAccessRefreshEpoch.current
    const hydrationEpoch = workspaceHydrationEpoch.current
    const workspaceId = session.currentWorkspace.id
    setIsRefreshingWorkspaceMembers(true)
    setWorkspaceAccessNotice('')
    try {
      const snapshot = await loadWorkspaceMembersSnapshot()
      if (refreshEpoch !== workspaceAccessRefreshEpoch.current
        || hydrationEpoch !== workspaceHydrationEpoch.current
        || session.currentWorkspace.id !== workspaceId) return
      if (snapshot.members !== null) setWorkspaceMembers(snapshot.members)
      if (snapshot.error) setWorkspaceAccessNotice(snapshot.error)
    } finally {
      if (refreshEpoch === workspaceAccessRefreshEpoch.current) {
        workspaceAccessRefreshLock.current = false
        setIsRefreshingWorkspaceMembers(false)
      }
    }
  }

  async function refreshOutputUsage() {
    if (!session || session.user.id === 'demo-user' || outputUsageRefreshLock.current) return
    outputUsageRefreshLock.current = true
    const refreshEpoch = ++outputUsageRefreshEpoch.current
    const hydrationEpoch = workspaceHydrationEpoch.current
    const workspaceId = session.currentWorkspace.id
    setIsRefreshingOutputUsage(true)
    setOutputUsageNotice('')
    try {
      const snapshot = await loadOutputUsageSnapshot()
      if (refreshEpoch !== outputUsageRefreshEpoch.current || hydrationEpoch !== workspaceHydrationEpoch.current) return
      if (snapshot.usage !== null) {
        setOutputUsage(snapshot.usage)
        setWorkspaces((current) => current.map((workspace) => workspace.id === workspaceId ? {
          ...workspace,
          availableOutputs: snapshot.usage!.allowance.availableOutputs,
          reservedOutputs: snapshot.usage!.allowance.reservedOutputs
        } : workspace))
        setSession((current) => current?.currentWorkspace.id === workspaceId ? {
          ...current,
          currentWorkspace: {
            ...current.currentWorkspace,
            availableOutputs: snapshot.usage!.allowance.availableOutputs,
            reservedOutputs: snapshot.usage!.allowance.reservedOutputs
          }
        } : current)
      }
      if (snapshot.error) setOutputUsageNotice(snapshot.error)
    } finally {
      if (refreshEpoch === outputUsageRefreshEpoch.current) {
        outputUsageRefreshLock.current = false
        setIsRefreshingOutputUsage(false)
      }
    }
  }

  function mergeWorkspaceMember(member: WorkspaceMember) {
    setWorkspaceMembers((current) => {
      const next = [...current.filter((item) => item.id !== member.id), member]
      const roleOrder = { owner: 0, admin: 1, member: 2 } as const
      return next.sort((left, right) => roleOrder[left.role] - roleOrder[right.role]
        || left.createdAt.localeCompare(right.createdAt)
        || left.id.localeCompare(right.id))
    })
  }

  async function inviteMemberFromAccessView(input: { email: string; name: string; role: 'admin' | 'member' }) {
    if (!session
      || (session.currentWorkspace.role !== 'owner' && session.currentWorkspace.role !== 'admin')
      || workspaceAccessMutationLock.current
      || workspaceAccessRefreshLock.current) return false
    workspaceAccessMutationLock.current = true
    const mutationEpoch = ++workspaceAccessMutationEpoch.current
    const hydrationEpoch = workspaceHydrationEpoch.current
    setWorkspaceAccessMutation({ kind: 'invite', memberId: null })
    setWorkspaceAccessNotice('')
    try {
      if (session.user.id === 'demo-user') {
        if (workspaceMembers.some((member) => member.email === input.email)) {
          setWorkspaceAccessNotice('這個 Demo 成員已在工作區。 This demo member is already in the workspace.')
          return false
        }
        if (workspaceMembers.length >= 50) {
          setWorkspaceAccessNotice('Demo 工作區成員已達目前上限。 The demo workspace member limit has been reached.')
          return false
        }
        mergeWorkspaceMember({
          id: crypto.randomUUID(),
          ...input,
          role: session.currentWorkspace.role === 'admin' ? 'member' : input.role,
          accountStatus: 'active',
          authMode: 'access',
          createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
        })
        return true
      }
      const member = await submitWorkspaceMemberInvite(input)
      if (mutationEpoch !== workspaceAccessMutationEpoch.current
        || hydrationEpoch !== workspaceHydrationEpoch.current) return false
      mergeWorkspaceMember(member)
      return true
    } catch (error) {
      if (mutationEpoch === workspaceAccessMutationEpoch.current
        && hydrationEpoch === workspaceHydrationEpoch.current) {
        setWorkspaceAccessNotice(error instanceof Error ? error.message : '成員邀請暫時無法使用。 Workspace member invitation is temporarily unavailable.')
      }
      return false
    } finally {
      if (mutationEpoch === workspaceAccessMutationEpoch.current) {
        workspaceAccessMutationLock.current = false
        setWorkspaceAccessMutation(null)
      }
    }
  }

  async function changeWorkspaceMemberRole(member: WorkspaceMember, role: 'admin' | 'member') {
    if (!session
      || session.currentWorkspace.role !== 'owner'
      || workspaceAccessMutationLock.current
      || workspaceAccessRefreshLock.current) return
    workspaceAccessMutationLock.current = true
    const mutationEpoch = ++workspaceAccessMutationEpoch.current
    const hydrationEpoch = workspaceHydrationEpoch.current
    setWorkspaceAccessMutation({ kind: 'role', memberId: member.id })
    setWorkspaceAccessNotice('')
    try {
      const updated = session.user.id === 'demo-user'
        ? { ...member, role }
        : await submitWorkspaceMemberRole(member.id, role)
      if (mutationEpoch !== workspaceAccessMutationEpoch.current
        || hydrationEpoch !== workspaceHydrationEpoch.current) return
      mergeWorkspaceMember(updated)
    } catch (error) {
      if (mutationEpoch === workspaceAccessMutationEpoch.current
        && hydrationEpoch === workspaceHydrationEpoch.current) {
        setWorkspaceAccessNotice(error instanceof Error ? error.message : '成員角色更新暫時無法使用。 Workspace member role update is temporarily unavailable.')
      }
    } finally {
      if (mutationEpoch === workspaceAccessMutationEpoch.current) {
        workspaceAccessMutationLock.current = false
        setWorkspaceAccessMutation(null)
      }
    }
  }

  async function removeMemberFromWorkspace(member: WorkspaceMember) {
    if (!session
      || (session.currentWorkspace.role !== 'owner' && session.currentWorkspace.role !== 'admin')
      || workspaceAccessMutationLock.current
      || workspaceAccessRefreshLock.current) return
    workspaceAccessMutationLock.current = true
    const mutationEpoch = ++workspaceAccessMutationEpoch.current
    const hydrationEpoch = workspaceHydrationEpoch.current
    setWorkspaceAccessMutation({ kind: 'remove', memberId: member.id })
    setWorkspaceAccessNotice('')
    try {
      if (session.user.id !== 'demo-user') await submitWorkspaceMemberRemoval(member.id)
      if (mutationEpoch !== workspaceAccessMutationEpoch.current
        || hydrationEpoch !== workspaceHydrationEpoch.current) return
      setWorkspaceMembers((current) => current.filter((item) => item.id !== member.id))
    } catch (error) {
      if (mutationEpoch === workspaceAccessMutationEpoch.current
        && hydrationEpoch === workspaceHydrationEpoch.current) {
        setWorkspaceAccessNotice(error instanceof Error ? error.message : '成員移除暫時無法使用。 Workspace member removal is temporarily unavailable.')
      }
    } finally {
      if (mutationEpoch === workspaceAccessMutationEpoch.current) {
        workspaceAccessMutationLock.current = false
        setWorkspaceAccessMutation(null)
      }
    }
  }

  function navigateToSection(nextSection: NavigationSection) {
    setActiveSection(nextSection)
    if (nextSection === 'campaigns' || nextSection === 'assets') {
      void refreshGenerationResults()
    }
    if (nextSection === 'products') {
      void refreshProductAssets()
      void refreshProductProfiles()
    }
    if (nextSection === 'brands') void refreshBrandPacks()
    if (nextSection === 'usage') void refreshOutputUsage()
    if (nextSection === 'activity') void refreshWorkspaceActivity()
    if (nextSection === 'access') void refreshWorkspaceMembers()
  }

  useEffect(() => {
    if (demoMode) return
    let active = true
    const hydrationEpoch = ++workspaceHydrationEpoch.current
    const generationEpoch = ++generationRefreshEpoch.current

    void workspaceBootstrapLoader.current!().then(({ sessionResult, platformStatus: nextPlatformStatus, generationSnapshot, campaignAgentSnapshot }) => {
      if (!active || hydrationEpoch !== workspaceHydrationEpoch.current) return
      const nextSession = sessionResult.session
      setSession(nextSession)
      setWorkspaces(nextSession ? [nextSession.currentWorkspace] : [])
      if (sessionResult.failure) setAccessFailure(sessionResult.failure)
      setPlatformStatus(nextPlatformStatus)
      if (nextSession && generationSnapshot && campaignAgentSnapshot) {
        applyWorkspaceSnapshots(generationSnapshot, campaignAgentSnapshot, hydrationEpoch, generationEpoch)
      }
    }).catch(() => {
      if (!active || hydrationEpoch !== workspaceHydrationEpoch.current) return
      const fallbackSession = import.meta.env.DEV ? demoSession : null
      setSession(fallbackSession)
      setWorkspaces(fallbackSession ? [fallbackSession.currentWorkspace] : [])
      setPlatformStatus(import.meta.env.DEV ? localPlatformStatus : restrictedPlatformStatus)
      if (!import.meta.env.DEV) setAccessFailure('unavailable')
    }).finally(() => {
      if (active && hydrationEpoch === workspaceHydrationEpoch.current) setIsLoadingSession(false)
    })

    return () => {
      active = false
    }
  }, [demoMode])

  useEffect(() => {
    if (demoMode || !session) return
    const currentWorkspaceId = session.currentWorkspace.id
    const handleWorkspaceSelection = (event: Event) => {
      const selectedWorkspaceId = workspaceIdFromSelectionEvent(event as unknown as { key: string | null; newValue: string | null })
      if (!selectedWorkspaceId || selectedWorkspaceId === currentWorkspaceId) return
      persistSelectedWorkspaceId(selectedWorkspaceId)
      workspaceSwitchLock.current = true
      setIsSwitchingWorkspace(true)
      window.location.reload()
    }
    window.addEventListener('storage', handleWorkspaceSelection)
    return () => window.removeEventListener('storage', handleWorkspaceSelection)
  }, [demoMode, session?.currentWorkspace.id])

  function campaignBrief() {
    return {
      brand,
      product,
      intent,
      assetId: image.asset?.id || (image.status === 'demo' ? 'demo-product-source' : null)
    }
  }

  function invalidatePlan() {
    generationRequestKey.current = null
    setAgentState((current) => current.stage === 'idle' ? current : initialCampaignAgentState())
  }

  function campaignIdentityLocked() {
    return campaignPackLock.current
      || campaignAgentLock.current
      || productProfileMutationLock.current
      || brandPackMutationLock.current
  }

  function changeBrand(next: BrandPack) {
    if (campaignIdentityLocked()) return
    setBrand(next)
    setSelectedBrandPackId(null)
    invalidatePlan()
  }

  function changeProduct(next: Product) {
    if (campaignIdentityLocked()) return
    setProduct(next)
    setSelectedProductProfileId(null)
    invalidatePlan()
  }

  function changeIntent(next: string) {
    if (campaignIdentityLocked()) return
    setIntent(next)
    invalidatePlan()
  }

  async function planCampaign() {
    if (campaignIdentityLocked()) return
    campaignAgentLock.current = true
    const brief = campaignBrief()
    const currentRevision = agentState.revision
    generationRequestKey.current = null
    setAgentBusy(true)
    setNotice('')
    try {
      if (session?.user.id === 'demo-user') {
        await new Promise((resolve) => window.setTimeout(resolve, 620))
        setAgentState(buildCampaignPlan(brief, currentRevision + 1, 'deterministic'))
      } else {
        setAgentState(await submitCampaignAgentAction({ action: 'plan', brief, currentRevision }))
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Campaign Agent 暫時未能完成規劃。')
    } finally {
      setAgentBusy(false)
      campaignAgentLock.current = false
    }
  }

  async function approveCampaign() {
    if (campaignIdentityLocked() || agentState.stage !== 'awaiting-approval') return
    campaignAgentLock.current = true
    const revision = agentState.revision
    setAgentBusy(true)
    setNotice('')
    try {
      if (session?.user.id === 'demo-user') {
        await new Promise((resolve) => window.setTimeout(resolve, 420))
        setAgentState((current) => ({ ...current, stage: 'approved', approvedAt: new Date().toISOString(), messages: [...current.messages, { id: `approved-${revision}`, role: 'user', text: '已批准這個輸出計劃。' }] }))
      } else {
        setAgentState(await submitCampaignAgentAction({ action: 'approve', revision }))
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '未能批准計劃。')
    } finally {
      setAgentBusy(false)
      campaignAgentLock.current = false
    }
  }

  async function uploadProductImage(file: File) {
    if (campaignIdentityLocked()) return
    generationRequestKey.current = null
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setNotice(productAssetTypeMessage)
      return
    }
    if (file.size <= 0 || file.size > 4 * 1024 * 1024) {
      setNotice(productAssetSizeMessage)
      return
    }
    setNotice('')
    const localUrl = URL.createObjectURL(file)
    setImage((current) => {
      if (current.url.startsWith('blob:')) URL.revokeObjectURL(current.url)
      return { name: file.name, url: localUrl, asset: null, status: 'uploading', error: '' }
    })
    if (session?.user.id === 'demo-user') {
      setImage({ name: file.name, url: localUrl, asset: null, status: 'demo', error: '' })
      setAgentState(initialCampaignAgentState())
      return
    }
    try {
      const asset = await uploadProductAsset(file)
      setImage({ name: asset.name, url: asset.previewUrl, asset, status: 'ready', error: '' })
      setAgentState(initialCampaignAgentState())
      URL.revokeObjectURL(localUrl)
    } catch (error) {
      if (session?.user.id === 'demo-user') {
        setImage({ name: file.name, url: localUrl, asset: null, status: 'demo', error: '' })
        setAgentState(initialCampaignAgentState())
      } else {
        setImage({ name: file.name, url: localUrl, asset: null, status: 'error', error: error instanceof Error ? error.message : productAssetUploadUnavailableMessage })
      }
    }
  }

  function selectProductAssetFromLibrary(asset: ProductAssetListItem) {
    if (campaignIdentityLocked()
      || productImageDeleteLock.current
      || productAssetRefreshLock.current
      || productProfileMutationLock.current
      || productProfileRefreshLock.current
      || image.status === 'uploading') return
    generationRequestKey.current = null
    if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url)
    setImage({
      name: asset.name,
      url: asset.previewUrl,
      asset,
      status: session?.user.id === 'demo-user' ? 'demo' : 'ready',
      error: ''
    })
    invalidatePlan()
    setProductAssetNotice('')
    setNotice('')
    setActiveSection('workspace')
  }

  async function deleteProductImage() {
    if (campaignIdentityLocked() || productImageDeleteLock.current || productAssetRefreshLock.current) return
    const confirmation = demoMode
      ? '移除這張本機 Demo 圖片？引用此圖的 Agent 計劃亦會重設。 Remove this local demo image? A plan using it will also reset.'
      : '刪除這張私人商品圖片？只有引用此圖的 Agent 計劃會重設。 Delete this private product image? Only a plan using it will reset.'
    if (!window.confirm(confirmation)) return
    productImageDeleteLock.current = true
    setDeletingProductAssetId(image.asset?.id || null)
    setIsDeletingProductImage(true)
    setNotice('')
    setProductAssetNotice('')
    try {
      const deletedAssetId = image.asset?.id || null
      if (image.asset && session?.user.id !== 'demo-user') {
        await deletePrivateResource('product-asset', image.asset.id)
      }
      if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url)
      let planReloadFailed = false
      const nextAgentState = demoMode
        ? initialCampaignAgentState()
        : await loadCampaignAgentState().catch(() => {
            planReloadFailed = true
            return campaignStateAfterAssetDeletion(agentState, deletedAssetId)
          })
      applyCampaignState(nextAgentState)
      if (!nextAgentState.brief || nextAgentState.brief.assetId === deletedAssetId) {
        generationRequestKey.current = null
      }
      if (deletedAssetId) setProductAssets((current) => current.filter((asset) => asset.id !== deletedAssetId))
      if (planReloadFailed) {
        setNotice('圖片已刪除，但暫時未能重新載入 Agent 計劃。 Image deleted, but the Agent plan could not be reloaded.')
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '未能刪除商品圖片。')
    } finally {
      productImageDeleteLock.current = false
      setIsDeletingProductImage(false)
      setDeletingProductAssetId(null)
    }
  }

  async function deleteProductAssetFromLibrary(asset: ProductAssetListItem) {
    if (asset.id === image.asset?.id) {
      await deleteProductImage()
      return
    }
    if (campaignIdentityLocked()
      || productImageDeleteLock.current
      || productAssetRefreshLock.current
      || productProfileMutationLock.current
      || productProfileRefreshLock.current) return
    if (!window.confirm('刪除這張已保存的私人商品來源圖？ Delete this saved private product source?')) return
    productImageDeleteLock.current = true
    setDeletingProductAssetId(asset.id)
    setProductAssetNotice('')
    try {
      if (session?.user.id !== 'demo-user') await deletePrivateResource('product-asset', asset.id)
      setProductAssets((current) => current.filter((item) => item.id !== asset.id))
    } catch (error) {
      setProductAssetNotice(error instanceof Error ? error.message : '未能刪除商品圖片。 Unable to delete product image.')
    } finally {
      productImageDeleteLock.current = false
      setDeletingProductAssetId(null)
    }
  }

  function selectProductProfileFromLibrary(savedProduct: SavedProductProfile) {
    if (campaignIdentityLocked()
      || productProfileMutationLock.current
      || productProfileRefreshLock.current
      || productImageDeleteLock.current
      || productAssetRefreshLock.current
      || image.status === 'uploading') return
    setProduct(productFromSavedProductProfile(savedProduct))
    setSelectedProductProfileId(savedProduct.id)
    generationRequestKey.current = null
    setAgentState(initialCampaignAgentState())
    setNotice('已套用商品資料快照；請配合目前品牌及圖片重新規劃及批准。 Product profile applied; re-plan and approve it with the current brand and image.')
    setActiveSection('workspace')
  }

  async function saveProductProfileToLibrary() {
    if (!session
      || agentState.stage !== 'approved'
      || !agentState.brief
      || campaignIdentityLocked()
      || productProfileMutationLock.current
      || productProfileRefreshLock.current
      || productImageDeleteLock.current
      || productAssetRefreshLock.current
      || image.status === 'uploading') return
    productProfileMutationLock.current = true
    const mutationEpoch = workspaceHydrationEpoch.current
    setIsSavingProductProfile(true)
    setProductProfileNotice('')
    try {
      let savedProduct: SavedProductProfile
      if (session.user.id === 'demo-user') {
        savedProduct = productProfiles.find((saved) => savedProductMatches(saved, agentState.brief!.product)) || {
          ...agentState.brief.product,
          id: crypto.randomUUID(),
          approvedRevision: agentState.revision,
          createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
        }
      } else {
        savedProduct = await saveApprovedProductProfile(agentState.revision)
      }
      if (mutationEpoch !== workspaceHydrationEpoch.current) return
      setProductProfiles((current) => [savedProduct, ...current.filter((item) => item.id !== savedProduct.id)].slice(0, 20))
      setSelectedProductProfileId(savedProduct.id)
      setProductProfileNotice('已保存核准商品資料；相同內容不會建立重複記錄。 Approved product profile saved without duplicating identical content.')
    } catch (error) {
      if (mutationEpoch !== workspaceHydrationEpoch.current) return
      setProductProfileNotice(error instanceof Error ? error.message : '商品資料儲存暫時無法使用。 Saving the product profile is temporarily unavailable.')
    } finally {
      if (mutationEpoch === workspaceHydrationEpoch.current) {
        productProfileMutationLock.current = false
        setIsSavingProductProfile(false)
      }
    }
  }

  async function deleteProductProfileFromLibrary(savedProduct: SavedProductProfile) {
    if (productProfileMutationLock.current || productProfileRefreshLock.current) return
    if (!window.confirm('刪除這個已保存的商品資料快照？ Delete this saved product profile?')) return
    productProfileMutationLock.current = true
    const mutationEpoch = workspaceHydrationEpoch.current
    setDeletingProductProfileId(savedProduct.id)
    setProductProfileNotice('')
    try {
      if (session?.user.id !== 'demo-user') await deletePrivateResource('product-profile', savedProduct.id)
      if (mutationEpoch !== workspaceHydrationEpoch.current) return
      setProductProfiles((current) => current.filter((item) => item.id !== savedProduct.id))
      setSelectedProductProfileId((current) => current === savedProduct.id ? null : current)
    } catch (error) {
      if (mutationEpoch !== workspaceHydrationEpoch.current) return
      setProductProfileNotice(error instanceof Error ? error.message : '商品資料快照刪除暫時無法使用。 Product profile deletion is temporarily unavailable.')
    } finally {
      if (mutationEpoch === workspaceHydrationEpoch.current) {
        productProfileMutationLock.current = false
        setDeletingProductProfileId(null)
      }
    }
  }

  function selectBrandPackFromLibrary(savedBrand: SavedBrandPack) {
    if (campaignIdentityLocked() || brandPackMutationLock.current || brandPackRefreshLock.current) return
    setBrand(brandFromSavedBrandPack(savedBrand))
    setSelectedBrandPackId(savedBrand.id)
    generationRequestKey.current = null
    setAgentState(initialCampaignAgentState())
    setNotice('已套用品牌快照；請配合目前商品重新規劃及批准。 Brand snapshot applied; re-plan and approve it with the current product.')
    setActiveSection('workspace')
  }

  async function saveBrandPackToLibrary() {
    if (!session
      || agentState.stage !== 'approved'
      || !agentState.brief
      || campaignIdentityLocked()
      || brandPackMutationLock.current
      || brandPackRefreshLock.current) return
    brandPackMutationLock.current = true
    const mutationEpoch = workspaceHydrationEpoch.current
    setIsSavingBrandPack(true)
    setBrandPackNotice('')
    try {
      let savedBrand: SavedBrandPack
      if (session.user.id === 'demo-user') {
        savedBrand = brandPacks.find((saved) => savedBrandMatches(saved, agentState.brief!.brand)) || {
          ...agentState.brief.brand,
          id: crypto.randomUUID(),
          approvedRevision: agentState.revision,
          createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
        }
      } else {
        savedBrand = await saveApprovedBrandPack(agentState.revision)
      }
      if (mutationEpoch !== workspaceHydrationEpoch.current) return
      setBrandPacks((current) => [savedBrand, ...current.filter((item) => item.id !== savedBrand.id)].slice(0, 20))
      setSelectedBrandPackId(savedBrand.id)
      setBrandPackNotice('已保存核准品牌快照；相同內容不會建立重複記錄。 Approved brand snapshot saved without duplicating identical content.')
    } catch (error) {
      if (mutationEpoch !== workspaceHydrationEpoch.current) return
      setBrandPackNotice(error instanceof Error ? error.message : '品牌資料儲存暫時無法使用。 Saving the brand snapshot is temporarily unavailable.')
    } finally {
      if (mutationEpoch === workspaceHydrationEpoch.current) {
        brandPackMutationLock.current = false
        setIsSavingBrandPack(false)
      }
    }
  }

  async function deleteBrandPackFromLibrary(savedBrand: SavedBrandPack) {
    if (brandPackMutationLock.current || brandPackRefreshLock.current) return
    if (!window.confirm('刪除這個已保存的品牌快照？ Delete this saved brand snapshot?')) return
    brandPackMutationLock.current = true
    const mutationEpoch = workspaceHydrationEpoch.current
    setDeletingBrandPackId(savedBrand.id)
    setBrandPackNotice('')
    try {
      if (session?.user.id !== 'demo-user') await deletePrivateResource('brand-pack', savedBrand.id)
      if (mutationEpoch !== workspaceHydrationEpoch.current) return
      setBrandPacks((current) => current.filter((item) => item.id !== savedBrand.id))
      setSelectedBrandPackId((current) => current === savedBrand.id ? null : current)
    } catch (error) {
      if (mutationEpoch !== workspaceHydrationEpoch.current) return
      setBrandPackNotice(error instanceof Error ? error.message : '品牌快照刪除暫時無法使用。 Brand snapshot deletion is temporarily unavailable.')
    } finally {
      if (mutationEpoch === workspaceHydrationEpoch.current) {
        brandPackMutationLock.current = false
        setDeletingBrandPackId(null)
      }
    }
  }

  async function deleteGeneration(result: GenerationResult) {
    if (generationDeleteLock.current) return
    if (!window.confirm(`刪除 ${result.aspectRatio} 私人輸出？`)) return
    generationDeleteLock.current = true
    setDeletingGenerationId(result.id)
    setNotice('')
    try {
      if (session?.user.id !== 'demo-user') {
        await deletePrivateResource('generation', result.id)
      }
      setServerResults((current) => current.filter((item) => item.id !== result.id))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '未能刪除輸出。')
    } finally {
      generationDeleteLock.current = false
      setDeletingGenerationId(null)
    }
  }

  async function reviewGeneration(result: GenerationResult, decision: 'approve' | 'reject') {
    if (generationReviewLock.current) return
    if (!result.approvedRevision) {
      setNotice(generationReviewSourceInvalidMessage)
      return
    }
    const confirmed = window.confirm(decision === 'approve'
      ? `核准 ${result.aspectRatio} 私人草稿並開放正式下載？審核決定不可變更。`
      : `標記 ${result.aspectRatio} 私人草稿需要修改？審核決定不可變更。`)
    if (!confirmed) return
    generationReviewLock.current = true
    setReviewingId(result.id)
    setReviewingDecision(decision)
    setNotice('')
    try {
      const reviewed = await submitGenerationReview(result, decision)
      setServerResults((current) => current.map((item) => item.id === reviewed.id ? reviewed : item))
      setNotice(decision === 'approve' ? '草稿已核准，正式下載現已開放。' : '草稿已標記為需要修改，不會開放正式下載。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '未能保存審核決定。')
    } finally {
      generationReviewLock.current = false
      setReviewingId(null)
      setReviewingDecision(null)
    }
  }

  async function generatePack() {
    if (!session || agentState.stage !== 'approved' || campaignIdentityLocked()) return
    if (!platformStatus.generationEnabled) {
      setNotice('計劃已保存；這個部署目前不接受外部 AI 生成請求。')
      return
    }
    campaignPackLock.current = true
    setIsGenerating(true)
    setNotice('')
    if (session.user.id === 'demo-user') {
      window.setTimeout(() => {
        setServerResults(demoResults.map((result) => ({ ...result, imageUrl: campaignScene, status: 'completed' })))
        campaignPackLock.current = false
        setIsGenerating(false)
        window.setTimeout(() => document.getElementById('campaign-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
      }, 950)
      return
    }

    try {
      const selectedPlan = agentState.plan.filter((item) => item.selected)
      generationRequestKey.current ||= crypto.randomUUID()
      const pack = await createCampaignPack({
        idempotencyKey: generationRequestKey.current,
        workspaceId: session.currentWorkspace.id,
        approvedRevision: agentState.revision,
        intent,
        brand,
        product,
        referenceAssetIds: image.asset ? [image.asset.id] : [],
        outputs: selectedPlan.map((item) => ({ workflowId: item.workflowId, aspectRatio: item.ratio }))
      })
      const created = pack.generations
      generationRequestKey.current = null
      const generationIds = new Set(created.map((item) => item.id))
      let sessionRefreshed = false
      if (pack.replayed) {
        sessionRefreshed = await refreshSessionState()
        if (!sessionRefreshed) {
          setNotice('Campaign Pack 已恢復，但暫時未能重新載入額度。 Campaign Pack recovered, but allowance could not be reloaded.')
        }
      } else {
        setWorkspaces((current) => current.map((workspace) => workspace.id === session.currentWorkspace.id ? {
          ...workspace,
          availableOutputs: Math.max(0, workspace.availableOutputs - created.length),
          reservedOutputs: workspace.reservedOutputs + created.length
        } : workspace))
        setSession((current) => current ? {
          ...current,
          currentWorkspace: {
            ...current.currentWorkspace,
            availableOutputs: Math.max(0, current.currentWorkspace.availableOutputs - created.length),
            reservedOutputs: current.currentWorkspace.reservedOutputs + created.length
          }
        } : current)
      }
      setServerResults((current) => [...created, ...current.filter((item) => !generationIds.has(item.id))])
      if (created.every((item) => item.status === 'completed' || item.status === 'failed')) {
        const failed = created.find((item) => item.status === 'failed')
        if (!sessionRefreshed && !pack.replayed) sessionRefreshed = await refreshSessionState()
        if (failed) {
          const failureNotice = failed.errorMessage || '部分素材未能完成，可用輸出數已自動退回。'
          setNotice(sessionRefreshed
            ? failureNotice
            : `${failureNotice} 額度暫時未能重新載入。 Allowance could not be reloaded yet.`)
        }
        window.setTimeout(() => document.getElementById('campaign-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
        return
      }
      const pollResult = await pollCampaignPack(
        session.currentWorkspace.id,
        [...generationIds],
        setServerResults
      )
      if (pollResult.outcome === 'terminal') {
        const failed = pollResult.pack.find((item) => item.status === 'failed')
        const allowanceReloaded = await refreshSessionState()
        if (failed) {
          const failureNotice = failed.errorMessage || '部分素材未能完成，可用輸出數已自動退回。'
          setNotice(allowanceReloaded
            ? failureNotice
            : `${failureNotice} 額度暫時未能重新載入。 Allowance could not be reloaded yet.`)
        } else if (!allowanceReloaded) {
          setNotice('Campaign Pack 已完成，但暫時未能重新載入額度。 Campaign Pack completed, but allowance could not be reloaded yet.')
        }
        window.setTimeout(() => document.getElementById('campaign-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
        return
      }
      if (pollResult.outcome === 'unavailable') {
        const allowanceReloaded = await refreshSessionState()
        setNotice(allowanceReloaded
          ? 'Campaign Pack 已排隊，但輸出狀態暫時無法重新載入；請稍後在 Campaign Packs 查看。 Campaign Pack is queued, but output status is temporarily unavailable; check Campaign Packs later.'
          : 'Campaign Pack 已排隊，但輸出狀態及額度暫時無法重新載入；請稍後在 Campaign Packs 查看。 Campaign Pack is queued, but output status and allowance are temporarily unavailable; check Campaign Packs later.')
        return
      }
      setNotice(pollResult.consecutiveFailures > 0
        ? '素材仍在背景處理，而最近一次狀態讀取未成功；請稍後在 Campaign Packs 查看。 Outputs are still processing and the latest status reload did not complete; check Campaign Packs later.'
        : '素材仍在背景處理，可稍後在 Campaign Packs 查看最新狀態。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '未能建立 Campaign Pack。')
      await refreshSessionState()
    } finally {
      campaignPackLock.current = false
      setIsGenerating(false)
    }
  }

  async function logout() {
    if (isLoggingOut) return
    if (demoMode) {
      if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url)
      window.location.assign('/')
      return
    }
    if (platformStatus.authMode === 'access') {
      setIsLoggingOut(true)
      window.location.assign('/cdn-cgi/access/logout')
      return
    }
    setIsLoggingOut(true)
    setNotice('')
    try {
      await logoutPasswordSession()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : passwordLogoutUnavailableMessage)
      setActiveSection('workspace')
      setIsLoggingOut(false)
      return
    }
    setIsLoggingOut(false)
    if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url)
    workspaceHydrationEpoch.current += 1
    generationRefreshEpoch.current += 1
    productAssetRefreshEpoch.current += 1
    productProfileRefreshEpoch.current += 1
    brandPackRefreshEpoch.current += 1
    activityRefreshEpoch.current += 1
    workspaceAccessRefreshEpoch.current += 1
    workspaceAccessMutationEpoch.current += 1
    outputUsageRefreshEpoch.current += 1
    workspaceListRefreshEpoch.current += 1
    generationRefreshLock.current = false
    productAssetRefreshLock.current = false
    productProfileRefreshLock.current = false
    productProfileMutationLock.current = false
    brandPackRefreshLock.current = false
    brandPackMutationLock.current = false
    activityRefreshLock.current = false
    workspaceAccessRefreshLock.current = false
    workspaceAccessMutationLock.current = false
    outputUsageRefreshLock.current = false
    workspaceListRefreshLock.current = false
    workspaceSwitchLock.current = false
    setIsRefreshingResults(false)
    setIsRefreshingProductAssets(false)
    setIsRefreshingProductProfiles(false)
    setIsSavingProductProfile(false)
    setIsRefreshingBrandPacks(false)
    setIsSavingBrandPack(false)
    setIsRefreshingActivity(false)
    setIsRefreshingWorkspaceMembers(false)
    setWorkspaceAccessMutation(null)
    setIsRefreshingOutputUsage(false)
    setIsRefreshingWorkspaceList(false)
    setIsSwitchingWorkspace(false)
    setSession(null)
    setWorkspaces([])
    setWorkspaceListNotice('')
    setReviewingId(null)
    setReviewingDecision(null)
    setServerResults([])
    setProductAssets([])
    setProductAssetNotice('')
    setDeletingProductAssetId(null)
    setProductProfiles([])
    setSelectedProductProfileId(null)
    setProductProfileNotice('')
    setDeletingProductProfileId(null)
    setBrandPacks([])
    setSelectedBrandPackId(null)
    setBrandPackNotice('')
    setDeletingBrandPackId(null)
    setWorkspaceActivity([])
    setActivityNotice('')
    setWorkspaceMembers([])
    setWorkspaceAccessNotice('')
    setOutputUsage(null)
    setOutputUsageNotice('')
    setAgentState(initialCampaignAgentState())
    setBrand(emptyBrand)
    setProduct(emptyProduct)
    setIntent('限時優惠')
    setImage({ name: '尚未選擇圖片', url: '', asset: null, status: 'error', error: '請上傳商品原圖' })
  }

  if (isLoadingSession) return <div className="loading-screen"><Sparkles size={24} /><span>正在載入工作區…</span></div>
  if (!session && platformStatus.authMode === 'access') {
    return <AccessLoginPage reason={accessFailure} returnTo={`${window.location.pathname}${window.location.search}${window.location.hash}`} />
  }
  if (!session) return <AuthPage registrationMode={platformStatus.registrationMode} onAuthenticated={(nextSession) => {
    persistSelectedWorkspaceId(nextSession.currentWorkspace.id)
    setSession(nextSession)
    setWorkspaces([nextSession.currentWorkspace])
    void hydrateWorkspace(nextSession)
  }} />

  const userInitial = session.user.name.trim().charAt(0).toUpperCase() || session.user.email.charAt(0).toUpperCase()
  const workspaceSwitchDisabled = workspaceMutationPending()
  const canReviewOutputs = session.user.id !== 'demo-user' && (session.currentWorkspace.role === 'owner' || session.currentWorkspace.role === 'admin')

  return <div className="app-shell" id="workspace">
    <Sidebar workspace={session.currentWorkspace} active={activeSection} onNavigate={navigateToSection} />
    <div className="app-body">
      <header className="topbar">
        <a className="mobile-brand" href="#workspace" aria-label="AisleStage"><BrandMark /><strong>AisleStage</strong></a>
        <div className="topbar-spacer" />
        <span className="allowance-chip"><Sparkles size={15} />可用輸出 <strong>{session.currentWorkspace.availableOutputs}</strong></span>
        <WorkspaceSwitcher
          currentWorkspace={session.currentWorkspace}
          workspaces={workspaces.length ? workspaces : [session.currentWorkspace]}
          isLoading={isRefreshingWorkspaceList}
          isSwitching={isSwitchingWorkspace}
          disabled={workspaceSwitchDisabled}
          notice={workspaceListNotice}
          onOpen={() => void refreshWorkspaceList()}
          onSelect={(workspaceId) => void switchWorkspace(workspaceId)}
        />
        <span className="user-avatar" title={session.user.name}>{userInitial}</span>
        <button className="icon-button logout-button" type="button" aria-label={isLoggingOut ? '正在登出' : '登出'} onClick={logout} disabled={isLoggingOut}><LogOut size={17} /></button>
      </header>

      <main className="main-content">
        {activeSection === 'workspace' ? <>
          <div className="page-title"><div><h1>建立 Campaign Pack{demoMode ? ' · Demo' : ''}</h1><p>一張商品圖，完成整套推廣素材；Agent 先規劃，你批准後才生成。</p></div><a className="help-link-inline" href="#support"><CircleHelp size={16} />使用指引</a></div>
          {demoMode
            ? <p className="preview-notice" role="status"><strong>公開互動 Demo</strong><span>只在目前瀏覽器記憶體處理合成資料；不會上傳、保存或呼叫外部 AI。</span></p>
            : !platformStatus.generationEnabled ? <p className="preview-notice" role="status"><strong>安全預覽模式</strong><span>商品上傳與 Agent 規劃可正常測試，外部圖片生成仍保持關閉。</span></p> : null}
          <CampaignWorkspace brand={brand} product={product} intent={intent} image={image} imageDeleteBusy={isDeletingProductImage} generationBusy={isGenerating} agentState={agentState} agentBusy={agentBusy} generationAvailable={platformStatus.generationEnabled} onBrandChange={changeBrand} onProductChange={changeProduct} onIntentChange={changeIntent} onImageSelected={(file) => void uploadProductImage(file)} onImageDelete={() => void deleteProductImage()} onPlan={() => void planCampaign()} onApprove={() => void approveCampaign()} onGenerate={() => void generatePack()} />
          {notice ? <p className="workspace-notice" role="alert">{notice}</p> : null}
          {agentState.plan.length ? <ResultsPanel results={serverResults} product={product} cta={brand.cta} ctaEn={brand.ctaEn} agentState={agentState} isGenerating={isGenerating} generationAvailable={platformStatus.generationEnabled} demoMode={session.user.id === 'demo-user'} canReview={canReviewOutputs} reviewingId={reviewingId} reviewingDecision={reviewingDecision} onGenerate={() => void generatePack()} onReview={(result, decision) => void reviewGeneration(result, decision)} /> : null}
          <section className="support-panel" id="support" aria-labelledby="support-title">
            <div><CircleHelp size={20} /><div><h2 id="support-title">使用指引</h2><p>先填妥繁中與英文商業資料，再上傳有權使用的商品原圖。Agent 只會建立計劃；你批准後，系統才會一次建立三個私人輸出。</p></div></div>
            <ol><li>核對價格、優惠、賣點及雙語 CTA。</li><li>檢查三個版型與 Agent 建議。</li><li>建立私人草稿，逐一核准後才下載。</li></ol>
          </section>
        </> : activeSection === 'usage'
          ? <WorkspaceUsageView usage={outputUsage} isRefreshing={isRefreshingOutputUsage} notice={outputUsageNotice} onRefresh={session.user.id === 'demo-user' ? undefined : () => void refreshOutputUsage()} onBack={() => setActiveSection('workspace')} />
          : activeSection === 'activity'
          ? <WorkspaceActivityView activity={workspaceActivity} isRefreshing={isRefreshingActivity} notice={activityNotice} onRefresh={session.user.id === 'demo-user' ? undefined : () => void refreshWorkspaceActivity()} onBack={() => setActiveSection('workspace')} />
          : activeSection === 'access'
          ? (session.currentWorkspace.role === 'owner' || session.currentWorkspace.role === 'admin'
            ? <WorkspaceAccessView
              members={workspaceMembers}
              viewerRole={session.currentWorkspace.role}
              viewerUserId={session.user.id}
              isRefreshing={isRefreshingWorkspaceMembers}
              mutation={workspaceAccessMutation}
              notice={workspaceAccessNotice}
              onRefresh={session.user.id === 'demo-user' ? undefined : () => void refreshWorkspaceMembers()}
              onInvite={inviteMemberFromAccessView}
              onRoleChange={(member, role) => void changeWorkspaceMemberRole(member, role)}
              onRemove={(member) => void removeMemberFromWorkspace(member)}
              onBack={() => setActiveSection('workspace')}
            />
            : <section className="collection-view" aria-labelledby="access-denied-title">
              <div className="collection-heading"><div className="collection-heading-main"><div><h1 id="access-denied-title">無法開啟存取管理</h1><p>Workspace access requires an owner or admin role.</p></div></div></div>
              <button className="outline-button" type="button" onClick={() => setActiveSection('workspace')}>返回工作台</button>
            </section>)
          : <CollectionView
            section={activeSection}
            brand={brand}
            product={product}
            results={serverResults}
            imageUrl={image.url}
            demoMode={session.user.id === 'demo-user'}
            deletingResultId={deletingGenerationId}
            isRefreshingResults={isRefreshingResults}
            refreshDisabled={deletingGenerationId !== null || reviewingId !== null}
            notice={activeSection === 'campaigns' || activeSection === 'assets' || activeSection === 'products' ? notice : ''}
            onRefreshResults={session.user.id === 'demo-user' ? undefined : () => void refreshGenerationResults()}
            canReview={canReviewOutputs}
            reviewingId={reviewingId}
            reviewingDecision={reviewingDecision}
            onReviewResult={session.user.id === 'demo-user' ? undefined : (result, decision) => void reviewGeneration(result, decision)}
            productAssets={productAssets}
            selectedProductAssetId={image.asset?.id || null}
            deletingProductAssetId={deletingProductAssetId}
            isRefreshingProductAssets={isRefreshingProductAssets}
            productAssetNotice={productAssetNotice}
            onRefreshProductAssets={session.user.id === 'demo-user' ? undefined : () => {
              void refreshProductAssets()
              void refreshProductProfiles()
            }}
            onSelectProductAsset={selectProductAssetFromLibrary}
            onDeleteProductAsset={(asset) => void deleteProductAssetFromLibrary(asset)}
            productProfiles={productProfiles}
            selectedProductProfileId={selectedProductProfileId}
            deletingProductProfileId={deletingProductProfileId}
            isRefreshingProductProfiles={isRefreshingProductProfiles}
            isSavingProductProfile={isSavingProductProfile}
            canSaveProductProfile={agentState.stage === 'approved' && Boolean(agentState.brief) && !agentBusy && !isGenerating}
            productInteractionDisabled={agentBusy || isGenerating}
            productProfileNotice={productProfileNotice}
            onSaveProductProfile={() => void saveProductProfileToLibrary()}
            onSelectProductProfile={selectProductProfileFromLibrary}
            onDeleteProductProfile={(savedProduct) => void deleteProductProfileFromLibrary(savedProduct)}
            brandPacks={brandPacks}
            selectedBrandPackId={selectedBrandPackId}
            deletingBrandPackId={deletingBrandPackId}
            isRefreshingBrandPacks={isRefreshingBrandPacks}
            isSavingBrandPack={isSavingBrandPack}
            canSaveBrandPack={agentState.stage === 'approved' && Boolean(agentState.brief) && !agentBusy && !isGenerating}
            brandInteractionDisabled={agentBusy || isGenerating}
            brandPackNotice={brandPackNotice}
            onRefreshBrandPacks={session.user.id === 'demo-user' ? undefined : () => void refreshBrandPacks()}
            onSaveBrandPack={() => void saveBrandPackToLibrary()}
            onSelectBrandPack={selectBrandPackFromLibrary}
            onDeleteBrandPack={(savedBrand) => void deleteBrandPackFromLibrary(savedBrand)}
            onBack={() => setActiveSection('workspace')}
            onDeleteResult={(result) => void deleteGeneration(result)}
          />}
      </main>
    </div>
  </div>
}

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/login') return <AccessLoginPage />
  if (isPublicDemoPath(path)) return <WorkspaceApp demoMode />
  if (path === '/app' || path.startsWith('/app/')) return <WorkspaceApp />
  return <LandingPage />
}
