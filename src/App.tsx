import { Bell, ChevronDown, CircleHelp, LogOut, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import demoSpeaker from './assets/demo-speaker.png'
import campaignScene from './assets/campaign-speaker-scene.png'
import { AuthPage } from './components/AuthPage'
import { BrandMark } from './components/BrandMark'
import { CampaignWorkspace, type ImageState } from './components/CampaignWorkspace'
import { CollectionView } from './components/CollectionView'
import type { NavigationSection } from './components/Icon'
import { ResultsPanel } from './components/ResultsPanel'
import { Sidebar } from './components/Sidebar'
import { buildCampaignPlan, initialCampaignAgentState } from './lib/campaign-agent'
import { demoResults, starterBrand, starterProduct } from './lib/demo-data'
import { workflowById } from './lib/workflows'
import type { AuthUser, BrandPack, CampaignAgentState, GenerationResult, PlatformStatus, Product, ProductAsset, SessionPayload, WorkflowId, WorkspaceSummary } from './lib/types'

type AuthedSession = {
  user: AuthUser
  currentWorkspace: WorkspaceSummary
}

const demoSession: AuthedSession = {
  user: { id: 'demo-user', email: 'demo@example.test', name: 'Demo User', accountStatus: 'active', accountType: 'test' },
  currentWorkspace: { id: 'demo-workspace', name: 'Example Store', role: 'owner', planStatus: 'trial', availableCredits: 6, reservedCredits: 0 }
}

const restrictedPlatformStatus: PlatformStatus = { status: 'ok', service: 'campaign-asset-worker', releaseMode: 'restricted', registrationMode: 'closed', registrationOpen: false, generationEnabled: false, agentMode: 'deterministic' }
const localPlatformStatus: PlatformStatus = { ...restrictedPlatformStatus, registrationMode: 'open', registrationOpen: true, generationEnabled: true }

async function loadSession() {
  const response = await fetch('/api/session')
  const data = await response.json() as SessionPayload
  if (!response.ok || !data.authenticated || !data.user || !data.currentWorkspace) return null
  return { user: data.user, currentWorkspace: data.currentWorkspace }
}

async function loadPlatformStatus() {
  const response = await fetch('/api/health')
  if (!response.ok) throw new Error('Platform status is unavailable.')
  return response.json() as Promise<PlatformStatus>
}

async function loadGenerations(workspaceId: string) {
  const response = await fetch(`/api/generations?workspaceId=${encodeURIComponent(workspaceId)}`)
  if (!response.ok) return []
  const data = await response.json() as { generations?: Array<Omit<GenerationResult, 'title'> & { workflowId: WorkflowId }> }
  return (data.generations || []).map((item) => ({ ...item, title: `${item.aspectRatio} · ${workflowById(item.workflowId).title}` }))
}

async function agentAction(path: string, body?: unknown) {
  const response = await fetch(`/api/campaign-agent${path}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await response.json().catch(() => ({})) as { state?: CampaignAgentState; error?: string }
  if (!response.ok || !data.state) throw new Error(data.error || 'Campaign Agent 暫時未能完成這個動作。')
  return data.state
}

export default function App() {
  const [session, setSession] = useState<AuthedSession | null>(null)
  const [isLoadingSession, setIsLoadingSession] = useState(true)
  const [platformStatus, setPlatformStatus] = useState<PlatformStatus>(import.meta.env.DEV ? localPlatformStatus : restrictedPlatformStatus)
  const [activeSection, setActiveSection] = useState<NavigationSection>('workspace')
  const [brand, setBrand] = useState<BrandPack>(starterBrand)
  const [product, setProduct] = useState<Product>(starterProduct)
  const [intent, setIntent] = useState('限時優惠')
  const [image, setImage] = useState<ImageState>({ name: 'minibeat_speaker_black.png', url: demoSpeaker, asset: null, status: import.meta.env.DEV ? 'demo' : 'error', error: import.meta.env.DEV ? '' : '請上傳商品原圖' })
  const [agentState, setAgentState] = useState<CampaignAgentState>(initialCampaignAgentState())
  const [agentBusy, setAgentBusy] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [serverResults, setServerResults] = useState<GenerationResult[]>([])
  const [notice, setNotice] = useState('')

  useEffect(() => {
    Promise.all([loadSession(), loadPlatformStatus()]).then(async ([nextSession, nextPlatformStatus]) => {
      setSession(nextSession)
      setPlatformStatus(nextPlatformStatus)
      if (nextSession) {
        const [generations, campaignAgent] = await Promise.all([
          loadGenerations(nextSession.currentWorkspace.id),
          agentAction('').catch(() => initialCampaignAgentState())
        ])
        setServerResults(generations)
        setAgentState(campaignAgent)
      }
    }).catch(() => {
      setSession(import.meta.env.DEV ? demoSession : null)
      setPlatformStatus(import.meta.env.DEV ? localPlatformStatus : restrictedPlatformStatus)
    }).finally(() => setIsLoadingSession(false))
  }, [])

  function campaignBrief() {
    return {
      brand,
      product,
      intent,
      assetId: image.asset?.id || (image.status === 'demo' ? 'demo-product-source' : null)
    }
  }

  async function planCampaign() {
    setAgentBusy(true)
    setNotice('')
    try {
      if (session?.user.id === 'demo-user') {
        await new Promise((resolve) => window.setTimeout(resolve, 620))
        setAgentState(buildCampaignPlan(campaignBrief(), agentState.revision + 1, 'deterministic'))
      } else {
        setAgentState(await agentAction('/plan', { brief: campaignBrief() }))
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
        setAgentState(await agentAction('/approve', { revision: agentState.revision }))
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '未能批准計劃。')
    } finally {
      setAgentBusy(false)
    }
  }

  async function reviseCampaign(note: string) {
    setAgentBusy(true)
    setNotice('')
    try {
      if (session?.user.id === 'demo-user') {
        setAgentState((current) => ({ ...current, stage: 'awaiting-approval', revision: current.revision + 1, approvedAt: null, summary: `已記錄調整要求：${note.slice(0, 500)}`, messages: [...current.messages, { id: `revision-${current.revision + 1}`, role: 'user', text: note.slice(0, 500) }] }))
      } else {
        setAgentState(await agentAction('/revise', { note }))
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '未能送出調整。')
    } finally {
      setAgentBusy(false)
    }
  }

  async function uploadProductImage(file: File) {
    const localUrl = URL.createObjectURL(file)
    setImage((current) => {
      if (current.url.startsWith('blob:')) URL.revokeObjectURL(current.url)
      return { name: file.name, url: localUrl, asset: null, status: 'uploading', error: '' }
    })
    const form = new FormData()
    form.set('file', file)
    try {
      const response = await fetch('/api/assets/product', { method: 'POST', body: form })
      const data = await response.json().catch(() => ({})) as { asset?: ProductAsset; error?: string }
      if (!response.ok || !data.asset) throw new Error(data.error || '未能上傳商品圖片。')
      setImage({ name: data.asset.name, url: data.asset.previewUrl, asset: data.asset, status: 'ready', error: '' })
      setAgentState(initialCampaignAgentState())
      URL.revokeObjectURL(localUrl)
    } catch (error) {
      if (session?.user.id === 'demo-user') {
        setImage({ name: file.name, url: localUrl, asset: null, status: 'demo', error: '' })
        setAgentState(initialCampaignAgentState())
      } else {
        setImage({ name: file.name, url: localUrl, asset: null, status: 'error', error: error instanceof Error ? error.message : '未能上傳商品圖片。' })
      }
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
      const created: GenerationResult[] = []
      for (const item of selectedPlan) {
        const response = await fetch('/api/generations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspaceId: session.currentWorkspace.id,
            workflowId: item.workflowId,
            aspectRatio: item.ratio,
            brand,
            product,
            referenceImageUrls: [],
            referenceAssetIds: image.asset ? [image.asset.id] : []
          })
        })
        const data = await response.json().catch(() => ({})) as { id?: string; status?: GenerationResult['status']; error?: string }
        if (!response.ok || !data.id) throw new Error(data.error || `未能建立 ${item.ratio} 生成任務。`)
        created.push({ id: data.id, workflowId: item.workflowId, aspectRatio: item.ratio, imageUrl: null, title: `${item.ratio} · ${item.label}`, status: data.status || 'queued' })
      }
      setServerResults((current) => [...created, ...current])
      window.setTimeout(() => void loadGenerations(session.currentWorkspace.id).then(setServerResults), 1600)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '未能建立 Campaign Pack。')
    } finally {
      setIsGenerating(false)
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
    setSession(null)
    setServerResults([])
    setAgentState(initialCampaignAgentState())
  }

  if (isLoadingSession) return <div className="loading-screen"><Sparkles size={24} /><span>正在載入工作區…</span></div>
  if (!session) return <AuthPage registrationMode={platformStatus.registrationMode} onAuthenticated={(nextSession) => {
    setSession(nextSession)
    void Promise.all([loadGenerations(nextSession.currentWorkspace.id), agentAction('').catch(() => initialCampaignAgentState())]).then(([results, campaignAgent]) => { setServerResults(results); setAgentState(campaignAgent) })
  }} />

  const userInitial = session.user.name.trim().charAt(0).toUpperCase() || session.user.email.charAt(0).toUpperCase()

  return <div className="app-shell" id="workspace">
    <Sidebar workspace={session.currentWorkspace} active={activeSection} onNavigate={setActiveSection} />
    <div className="app-body">
      <header className="topbar">
        <a className="mobile-brand" href="#workspace" aria-label="AislePack"><BrandMark /><strong>AislePack</strong></a>
        <div className="topbar-spacer" />
        <span className="credit-chip"><Sparkles size={15} />可用額度 <strong>{session.currentWorkspace.availableCredits}</strong></span>
        <button className="icon-button" type="button" aria-label="通知"><Bell size={18} /></button>
        <button className="workspace-chip" type="button"><span>{session.currentWorkspace.name.charAt(0)}</span><strong>{session.currentWorkspace.name}</strong><ChevronDown size={15} /></button>
        <button className="user-avatar" type="button" title={session.user.name}>{userInitial}</button>
        <button className="icon-button logout-button" type="button" aria-label="登出" onClick={logout}><LogOut size={17} /></button>
      </header>

      <main className="main-content">
        {activeSection === 'workspace' ? <>
          <div className="page-title"><div><h1>建立 Campaign Pack</h1><p>一張商品圖，完成整套推廣素材；Agent 先規劃，你批准後才生成。</p></div><a className="help-link-inline" href="#support"><CircleHelp size={16} />使用指引</a></div>
          {!platformStatus.generationEnabled ? <p className="preview-notice" role="status"><strong>安全預覽模式</strong><span>商品上傳與 Agent 規劃可正常測試，外部圖片生成仍保持關閉。</span></p> : null}
          <CampaignWorkspace brand={brand} product={product} intent={intent} image={image} agentState={agentState} agentBusy={agentBusy} generationAvailable={platformStatus.generationEnabled} onBrandChange={setBrand} onProductChange={setProduct} onIntentChange={setIntent} onImageSelected={(file) => void uploadProductImage(file)} onPlan={() => void planCampaign()} onApprove={() => void approveCampaign()} onGenerate={() => void generatePack()} onRevise={(note) => void reviseCampaign(note)} />
          {notice ? <p className="workspace-notice" role="alert">{notice}</p> : null}
          {agentState.plan.length ? <ResultsPanel results={serverResults} product={product} cta={brand.cta} agentState={agentState} isGenerating={isGenerating} generationAvailable={platformStatus.generationEnabled} demoMode={session.user.id === 'demo-user'} onGenerate={() => void generatePack()} /> : null}
        </> : <CollectionView section={activeSection} brand={brand} product={product} results={serverResults} imageUrl={image.url} onBack={() => setActiveSection('workspace')} />}
      </main>
    </div>
  </div>
}
