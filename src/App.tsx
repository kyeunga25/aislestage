import { ChevronDown, CircleHelp, LogOut, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import demoSpeaker from './assets/demo-speaker.png'
import { AuthPage } from './components/AuthPage'
import { BrandMark } from './components/BrandMark'
import { CampaignWizard, type WizardStep } from './components/CampaignWizard'
import { ResultsPanel } from './components/ResultsPanel'
import { demoResults, starterBrand, starterProduct } from './lib/demo-data'
import { workflowById } from './lib/workflows'
import type { AuthUser, BrandPack, GenerationResult, PlatformStatus, Product, SessionPayload, WorkflowId, WorkspaceSummary } from './lib/types'

type AuthedSession = {
  user: AuthUser
  currentWorkspace: WorkspaceSummary
}

const demoSession: AuthedSession = {
  user: { id: 'demo-user', email: 'demo@aislepack.app', name: 'Ken Chan' },
  currentWorkspace: { id: 'demo-workspace', name: 'HK Tech Gear', role: 'owner', planStatus: 'trial', availableCredits: 20, reservedCredits: 0 }
}

const localDemoResults = demoResults.map((result) => ({ ...result, imageUrl: demoSpeaker }))
const closedPlatformStatus: PlatformStatus = { status: 'ok', service: 'aislepack-worker', releaseMode: 'closed-beta-preview', registrationOpen: false, generationEnabled: false }
const localPlatformStatus: PlatformStatus = { ...closedPlatformStatus, registrationOpen: true, generationEnabled: true }

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
  return (data.generations || []).map((item) => ({
    ...item,
    title: `${item.aspectRatio} · ${workflowById(item.workflowId).title} · ${item.status}`
  }))
}

export default function App() {
  const [session, setSession] = useState<AuthedSession | null>(null)
  const [isLoadingSession, setIsLoadingSession] = useState(true)
  const [platformStatus, setPlatformStatus] = useState<PlatformStatus>(import.meta.env.DEV ? localPlatformStatus : closedPlatformStatus)
  const [brand, setBrand] = useState<BrandPack>(starterBrand)
  const [product, setProduct] = useState<Product>(starterProduct)
  const [step, setStep] = useState<WizardStep>(1)
  const [isGenerating, setIsGenerating] = useState(false)
  const [hasRequestedPack, setHasRequestedPack] = useState(false)
  const [serverResults, setServerResults] = useState<GenerationResult[]>([])
  const [notice, setNotice] = useState('')
  const workflowId: WorkflowId = 'promo-poster'
  const workflow = workflowById(workflowId)

  useEffect(() => {
    Promise.all([loadSession(), loadPlatformStatus()]).then(([nextSession, nextPlatformStatus]) => {
      setSession(nextSession)
      setPlatformStatus(nextPlatformStatus)
      if (nextSession) void loadGenerations(nextSession.currentWorkspace.id).then(setServerResults)
    }).catch(() => {
      setSession(import.meta.env.DEV ? demoSession : null)
      setPlatformStatus(import.meta.env.DEV ? localPlatformStatus : closedPlatformStatus)
    }).finally(() => setIsLoadingSession(false))
  }, [])

  async function generate() {
    if (!session) return
    if (!platformStatus.generationEnabled) {
      setNotice('目前是封閉測試預覽；AI Campaign Pack 生成會在商品保真與三尺寸流程完成驗證後開放。')
      return
    }
    setIsGenerating(true)
    setHasRequestedPack(true)
    setNotice('')
    if (import.meta.env.DEV && session.user.id === 'demo-user') {
      window.setTimeout(() => {
        setServerResults(localDemoResults)
        setIsGenerating(false)
        window.setTimeout(() => document.getElementById('campaign-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
      }, 800)
      return
    }
    try {
      const response = await fetch('/api/generations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: session.currentWorkspace.id, workflowId, aspectRatio: workflow.defaultRatio, brand, product, referenceImageUrls: [] }) })
      const data = await response.json().catch(() => ({})) as { id?: string; status?: GenerationResult['status']; error?: string }
      if (!response.ok || !data.id) throw new Error(data.error || '未能建立生成任務。')
      setServerResults((current) => [{ id: data.id!, workflowId, aspectRatio: workflow.defaultRatio, imageUrl: null, title: `${workflow.defaultRatio} · Campaign Pack · queued`, status: data.status || 'queued' }, ...current])
      window.setTimeout(() => void loadGenerations(session.currentWorkspace.id).then(setServerResults), 1200)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '未能建立生成任務。')
    } finally {
      window.setTimeout(() => setIsGenerating(false), 900)
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
    setSession(null)
    setServerResults([])
  }

  if (isLoadingSession) return <div className="loading-screen"><Sparkles size={24} /><span>正在載入工作區…</span></div>
  if (!session) return <AuthPage registrationOpen={platformStatus.registrationOpen} onAuthenticated={(nextSession) => {
    setSession(nextSession)
    void loadGenerations(nextSession.currentWorkspace.id).then(setServerResults)
  }} />

  const userInitial = session.user.name.trim().charAt(0).toUpperCase() || session.user.email.charAt(0).toUpperCase()

  return <div className="app-shell" id="workspace">
    <header className="app-header">
      <a className="app-brand" href="#workspace" aria-label="AislePack AI 電商素材工作台"><BrandMark /><span><strong>AislePack</strong><small>AI 電商素材工作台</small></span></a>
      <div className="header-actions">
        <button className="workspace-chip" type="button"><span className="workspace-dot">{session.currentWorkspace.name.charAt(0)}</span><strong>{session.currentWorkspace.name}</strong><ChevronDown size={16} /></button>
        <button className="icon-button help-button" type="button" aria-label="幫助中心"><CircleHelp size={20} /></button>
        <button className="user-avatar" type="button" title={session.user.name}>{userInitial}</button>
        <button className="icon-button logout-button" type="button" aria-label="登出" onClick={logout}><LogOut size={18} /></button>
      </div>
    </header>
    <main className="main-content">
      <section className="page-intro">
        <span className="eyebrow">建立新的 Campaign Pack</span>
        <h1>一張商品圖，完成整套推廣素材</h1>
        <p>上傳商品、確認推廣內容，再生成 1:1、4:5、9:16 素材與中英文字文案。</p>
      </section>
      {!platformStatus.generationEnabled ? <p className="preview-notice" role="status"><strong>封閉測試預覽</strong><span>登入、工作區及部署已啟用；AI 生成仍保持關閉，避免未完成的商品保真流程誤用真實圖片或額度。</span></p> : null}
      <CampaignWizard brand={brand} product={product} step={step} isGenerating={isGenerating} generationAvailable={platformStatus.generationEnabled} availableCredits={session.currentWorkspace.availableCredits} onBrandChange={setBrand} onProductChange={setProduct} onStepChange={setStep} onGenerate={generate} />
      {notice ? <p className="workspace-notice" role="alert">{notice}</p> : null}
      {hasRequestedPack || serverResults.length ? <ResultsPanel results={serverResults} product={product} cta={brand.cta} isGenerating={isGenerating} generationAvailable={platformStatus.generationEnabled} onGenerate={generate} onStartNew={() => { setStep(1); setHasRequestedPack(false); setServerResults([]); window.scrollTo({ top: 0, behavior: 'smooth' }) }} /> : null}
    </main>
  </div>
}
