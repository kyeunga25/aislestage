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
import { buildCampaignPlan, campaignStateAfterAssetDeletion, initialCampaignAgentState } from './lib/campaign-agent'
import { submitCampaignAgentAction } from './lib/campaign-agent-client'
import { loadCampaignAgentSnapshot, loadCampaignAgentState } from './lib/campaign-agent-loader'
import { createCampaignPack } from './lib/campaign-pack-client'
import { demoResults, emptyBrand, emptyProduct, starterBrand, starterProduct } from './lib/demo-data'
import { isPublicDemoPath } from './lib/demo-mode'
import type { AccessFailureReason } from './lib/access-login'
import { loadGenerations, loadGenerationSnapshot } from './lib/generation-loader'
import { generationReviewSourceInvalidMessage, submitGenerationReview } from './lib/generation-review-client'
import {
  productAssetSizeMessage,
  productAssetTypeMessage,
  productAssetUploadUnavailableMessage,
  uploadProductAsset
} from './lib/product-asset-client'
import { deletePrivateResource } from './lib/private-delete-client'
import { logoutPasswordSession, passwordLogoutUnavailableMessage } from './lib/password-logout-client'
import type { BrandPack, CampaignAgentState, GenerationResult, PlatformStatus, Product } from './lib/types'
import { loadPlatformStatus, loadSession, type AuthedSession } from './lib/workspace-bootstrap-loader'

const demoSession: AuthedSession = {
  user: { id: 'demo-user', email: 'demo@example.test', name: 'Demo User', accountStatus: 'active', accountType: 'test' },
  currentWorkspace: { id: 'demo-workspace', name: 'Example Store', role: 'owner', accessStatus: 'active', availableOutputs: 6, reservedOutputs: 0 }
}

const restrictedPlatformStatus: PlatformStatus = { status: 'ok', service: 'campaign-asset-worker', releaseMode: 'restricted', authMode: 'access', registrationMode: 'closed', registrationOpen: false, generationEnabled: false, generationMode: 'disabled', agentMode: 'deterministic' }
const localPlatformStatus: PlatformStatus = { ...restrictedPlatformStatus, authMode: 'password', registrationMode: 'open', registrationOpen: true, generationEnabled: true, generationMode: 'deterministic' }
const demoPlatformStatus: PlatformStatus = { ...restrictedPlatformStatus, authMode: 'password', generationEnabled: true, generationMode: 'deterministic' }

function WorkspaceApp({ demoMode = false }: { demoMode?: boolean }) {
  const previewMode = import.meta.env.DEV || demoMode
  const [session, setSession] = useState<AuthedSession | null>(demoMode ? demoSession : null)
  const [accessFailure, setAccessFailure] = useState<AccessFailureReason>('authentication-required')
  const [isLoadingSession, setIsLoadingSession] = useState(!demoMode)
  const [platformStatus, setPlatformStatus] = useState<PlatformStatus>(demoMode ? demoPlatformStatus : import.meta.env.DEV ? localPlatformStatus : restrictedPlatformStatus)
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
  const [serverResults, setServerResults] = useState<GenerationResult[]>([])
  const [notice, setNotice] = useState('')
  const generationRequestKey = useRef<string | null>(null)
  const productImageDeleteLock = useRef(false)
  const generationDeleteLock = useRef(false)

  function applyCampaignState(nextState: CampaignAgentState) {
    setAgentState(nextState)
    if (!nextState.brief) {
      setBrand(emptyBrand)
      setProduct(emptyProduct)
      setIntent('限時優惠')
      setImage({ name: '尚未選擇圖片', url: '', asset: null, status: 'error', error: '請上傳商品原圖' })
      return
    }
    setBrand(nextState.brief.brand)
    setProduct(nextState.brief.product)
    setIntent(nextState.brief.intent || '限時優惠')
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

  async function hydrateWorkspace(nextSession: AuthedSession) {
    const [generationSnapshot, campaignAgentSnapshot] = await Promise.all([
      loadGenerationSnapshot(nextSession.currentWorkspace.id),
      loadCampaignAgentSnapshot()
    ])
    if (generationSnapshot.results !== null) setServerResults(generationSnapshot.results)
    if (campaignAgentSnapshot.state !== null) applyCampaignState(campaignAgentSnapshot.state)
    const availabilityErrors = [generationSnapshot.error, campaignAgentSnapshot.error].filter(Boolean)
    if (availabilityErrors.length) setNotice(availabilityErrors.join(' '))
  }

  useEffect(() => {
    if (demoMode) return

    Promise.all([loadSession(), loadPlatformStatus()]).then(async ([sessionResult, nextPlatformStatus]) => {
      const nextSession = sessionResult.session
      setSession(nextSession)
      if (sessionResult.failure) setAccessFailure(sessionResult.failure)
      setPlatformStatus(nextPlatformStatus)
      if (nextSession) await hydrateWorkspace(nextSession)
    }).catch(() => {
      setSession(import.meta.env.DEV ? demoSession : null)
      setPlatformStatus(import.meta.env.DEV ? localPlatformStatus : restrictedPlatformStatus)
      if (!import.meta.env.DEV) setAccessFailure('unavailable')
    }).finally(() => setIsLoadingSession(false))
  }, [demoMode])

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

  function changeBrand(next: BrandPack) {
    setBrand(next)
    invalidatePlan()
  }

  function changeProduct(next: Product) {
    setProduct(next)
    invalidatePlan()
  }

  function changeIntent(next: string) {
    setIntent(next)
    invalidatePlan()
  }

  async function planCampaign() {
    generationRequestKey.current = null
    setAgentBusy(true)
    setNotice('')
    try {
      if (session?.user.id === 'demo-user') {
        await new Promise((resolve) => window.setTimeout(resolve, 620))
        setAgentState(buildCampaignPlan(campaignBrief(), agentState.revision + 1, 'deterministic'))
      } else {
        setAgentState(await submitCampaignAgentAction({ action: 'plan', brief: campaignBrief() }))
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Campaign Agent 暫時未能完成規劃。')
    } finally {
      setAgentBusy(false)
    }
  }

  async function approveCampaign() {
    setAgentBusy(true)
    setNotice('')
    try {
      if (session?.user.id === 'demo-user') {
        await new Promise((resolve) => window.setTimeout(resolve, 420))
        setAgentState((current) => ({ ...current, stage: 'approved', approvedAt: new Date().toISOString(), messages: [...current.messages, { id: `approved-${current.revision}`, role: 'user', text: '已批准這個輸出計劃。' }] }))
      } else {
        setAgentState(await submitCampaignAgentAction({ action: 'approve', revision: agentState.revision }))
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '未能批准計劃。')
    } finally {
      setAgentBusy(false)
    }
  }

  async function uploadProductImage(file: File) {
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

  async function deleteProductImage() {
    if (productImageDeleteLock.current) return
    const confirmation = demoMode
      ? '移除這張本機 Demo 圖片？引用此圖的 Agent 計劃亦會重設。 Remove this local demo image? A plan using it will also reset.'
      : '刪除這張私人商品圖片？只有引用此圖的 Agent 計劃會重設。 Delete this private product image? Only a plan using it will reset.'
    if (!window.confirm(confirmation)) return
    productImageDeleteLock.current = true
    setIsDeletingProductImage(true)
    setNotice('')
    try {
      const deletedAssetId = image.asset?.id || null
      if (image.asset) {
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
      if (planReloadFailed) {
        setNotice('圖片已刪除，但暫時未能重新載入 Agent 計劃。 Image deleted, but the Agent plan could not be reloaded.')
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '未能刪除商品圖片。')
    } finally {
      productImageDeleteLock.current = false
      setIsDeletingProductImage(false)
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
    if (!result.approvedRevision) {
      setNotice(generationReviewSourceInvalidMessage)
      return
    }
    const confirmed = window.confirm(decision === 'approve'
      ? `核准 ${result.aspectRatio} 私人草稿並開放正式下載？審核決定不可變更。`
      : `標記 ${result.aspectRatio} 私人草稿需要修改？審核決定不可變更。`)
    if (!confirmed) return
    setReviewingId(result.id)
    setNotice('')
    try {
      const reviewed = await submitGenerationReview(result, decision)
      setServerResults((current) => current.map((item) => item.id === reviewed.id ? reviewed : item))
      setNotice(decision === 'approve' ? '草稿已核准，正式下載現已開放。' : '草稿已標記為需要修改，不會開放正式下載。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '未能保存審核決定。')
    } finally {
      setReviewingId(null)
    }
  }

  async function generatePack() {
    if (!session || agentState.stage !== 'approved') return
    if (!platformStatus.generationEnabled) {
      setNotice('計劃已保存；這個部署目前不接受外部 AI 生成請求。')
      return
    }
    setIsGenerating(true)
    setNotice('')
    if (session.user.id === 'demo-user') {
      window.setTimeout(() => {
        setServerResults(demoResults.map((result) => ({ ...result, imageUrl: campaignScene, status: 'completed' })))
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
      setSession((current) => current ? {
        ...current,
        currentWorkspace: {
          ...current.currentWorkspace,
          availableOutputs: Math.max(0, current.currentWorkspace.availableOutputs - created.length),
          reservedOutputs: current.currentWorkspace.reservedOutputs + created.length
        }
      } : current)
      setServerResults((current) => [...created, ...current])
      const generationIds = new Set(created.map((item) => item.id))
      for (let attempt = 0; attempt < 16; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_250))
        const latest = await loadGenerations(session.currentWorkspace.id)
        setServerResults(latest)
        const pack = latest.filter((item) => generationIds.has(item.id))
        if (pack.length === generationIds.size && pack.every((item) => item.status === 'completed' || item.status === 'failed')) {
          const failed = pack.find((item) => item.status === 'failed')
          if (failed) setNotice(failed.errorMessage || '部分素材未能完成，可用輸出數已自動退回。')
          const refreshedSession = await loadSession().catch(() => null)
          if (refreshedSession?.session) setSession(refreshedSession.session)
          window.setTimeout(() => document.getElementById('campaign-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
          return
        }
      }
      setNotice('素材仍在背景處理，可稍後在 Campaign Packs 查看最新狀態。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '未能建立 Campaign Pack。')
      const refreshedSession = await loadSession().catch(() => null)
      if (refreshedSession?.session) setSession(refreshedSession.session)
    } finally {
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
    setSession(null)
    setReviewingId(null)
    setServerResults([])
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
    setSession(nextSession)
    void hydrateWorkspace(nextSession)
  }} />

  const userInitial = session.user.name.trim().charAt(0).toUpperCase() || session.user.email.charAt(0).toUpperCase()

  return <div className="app-shell" id="workspace">
    <Sidebar workspace={session.currentWorkspace} active={activeSection} onNavigate={setActiveSection} />
    <div className="app-body">
      <header className="topbar">
        <a className="mobile-brand" href="#workspace" aria-label="AisleStage"><BrandMark /><strong>AisleStage</strong></a>
        <div className="topbar-spacer" />
        <span className="allowance-chip"><Sparkles size={15} />可用輸出 <strong>{session.currentWorkspace.availableOutputs}</strong></span>
        <span className="workspace-chip"><span>{session.currentWorkspace.name.charAt(0)}</span><strong>{session.currentWorkspace.name}</strong></span>
        <span className="user-avatar" title={session.user.name}>{userInitial}</span>
        <button className="icon-button logout-button" type="button" aria-label={isLoggingOut ? '正在登出' : '登出'} onClick={logout} disabled={isLoggingOut}><LogOut size={17} /></button>
      </header>

      <main className="main-content">
        {activeSection === 'workspace' ? <>
          <div className="page-title"><div><h1>建立 Campaign Pack{demoMode ? ' · Demo' : ''}</h1><p>一張商品圖，完成整套推廣素材；Agent 先規劃，你批准後才生成。</p></div><a className="help-link-inline" href="#support"><CircleHelp size={16} />使用指引</a></div>
          {demoMode
            ? <p className="preview-notice" role="status"><strong>公開互動 Demo</strong><span>只在目前瀏覽器記憶體處理合成資料；不會上傳、保存或呼叫外部 AI。</span></p>
            : !platformStatus.generationEnabled ? <p className="preview-notice" role="status"><strong>安全預覽模式</strong><span>商品上傳與 Agent 規劃可正常測試，外部圖片生成仍保持關閉。</span></p> : null}
          <CampaignWorkspace brand={brand} product={product} intent={intent} image={image} imageDeleteBusy={isDeletingProductImage} agentState={agentState} agentBusy={agentBusy} generationAvailable={platformStatus.generationEnabled} onBrandChange={changeBrand} onProductChange={changeProduct} onIntentChange={changeIntent} onImageSelected={(file) => void uploadProductImage(file)} onImageDelete={() => void deleteProductImage()} onPlan={() => void planCampaign()} onApprove={() => void approveCampaign()} onGenerate={() => void generatePack()} />
          {notice ? <p className="workspace-notice" role="alert">{notice}</p> : null}
          {agentState.plan.length ? <ResultsPanel results={serverResults} product={product} cta={brand.cta} ctaEn={brand.ctaEn} agentState={agentState} isGenerating={isGenerating} generationAvailable={platformStatus.generationEnabled} demoMode={session.user.id === 'demo-user'} canReview={session.currentWorkspace.role === 'owner' || session.currentWorkspace.role === 'admin'} reviewingId={reviewingId} onGenerate={() => void generatePack()} onReview={(result, decision) => void reviewGeneration(result, decision)} /> : null}
          <section className="support-panel" id="support" aria-labelledby="support-title">
            <div><CircleHelp size={20} /><div><h2 id="support-title">使用指引</h2><p>先填妥繁中與英文商業資料，再上傳有權使用的商品原圖。Agent 只會建立計劃；你批准後，系統才會一次建立三個私人輸出。</p></div></div>
            <ol><li>核對價格、優惠、賣點及雙語 CTA。</li><li>檢查三個版型與 Agent 建議。</li><li>建立私人草稿，逐一核准後才下載。</li></ol>
          </section>
        </> : <CollectionView section={activeSection} brand={agentState.brief?.brand || emptyBrand} product={agentState.brief?.product || emptyProduct} results={serverResults} imageUrl={session.user.id === 'demo-user' ? image.url : agentState.brief?.assetId ? `/api/assets/${agentState.brief.assetId}` : ''} deletingResultId={deletingGenerationId} onBack={() => setActiveSection('workspace')} onDeleteResult={(result) => void deleteGeneration(result)} />}
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
