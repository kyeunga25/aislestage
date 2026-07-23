import { Bell, Gift, LogOut, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AuthPage } from './components/AuthPage'
import { CreationForm, ReferenceUploader } from './components/CreationForm'
import { ResultsPanel } from './components/ResultsPanel'
import { Sidebar } from './components/Sidebar'
import { WorkflowPicker } from './components/WorkflowPicker'
import { demoResults, starterBrand, starterProduct } from './lib/demo-data'
import { workflowById } from './lib/workflows'
import type { AuthUser, BrandPack, GenerationResult, Product, SessionPayload, WorkflowId, WorkspaceSummary } from './lib/types'

type AuthedSession = {
  user: AuthUser
  currentWorkspace: WorkspaceSummary
}

async function loadSession() {
  const response = await fetch('/api/session')
  const data = await response.json() as SessionPayload
  if (!response.ok || !data.authenticated || !data.user || !data.currentWorkspace) return null
  return { user: data.user, currentWorkspace: data.currentWorkspace }
}

async function loadGenerations(workspaceId: string) {
  const response = await fetch(`/api/generations?workspaceId=${encodeURIComponent(workspaceId)}`)
  if (!response.ok) return []
  const data = await response.json() as { generations?: Array<Omit<GenerationResult, 'title'> & { workflowId: WorkflowId }> }
  return (data.generations || []).map((item) => ({
    ...item,
    title: `${workflowById(item.workflowId).title} · ${item.status}`
  }))
}

export default function App() {
  const [session, setSession] = useState<AuthedSession | null>(null)
  const [isLoadingSession, setIsLoadingSession] = useState(true)
  const [brand, setBrand] = useState<BrandPack>(starterBrand)
  const [product, setProduct] = useState<Product>(starterProduct)
  const [workflowId, setWorkflowId] = useState<WorkflowId>('store-main')
  const [isGenerating, setIsGenerating] = useState(false)
  const [serverResults, setServerResults] = useState<GenerationResult[]>([])
  const [notice, setNotice] = useState('')
  const workflow = workflowById(workflowId)
  const visibleResults = useMemo(() => serverResults.length ? serverResults : demoResults, [serverResults])

  useEffect(() => {
    loadSession().then((nextSession) => {
      setSession(nextSession)
      if (nextSession) {
        void loadGenerations(nextSession.currentWorkspace.id).then(setServerResults)
      }
    }).catch(() => setSession(null)).finally(() => setIsLoadingSession(false))
  }, [])

  async function generate() {
    if (!session) return
    setIsGenerating(true)
    setNotice('')
    try {
      const response = await fetch('/api/generations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: session.currentWorkspace.id, workflowId, aspectRatio: workflow.defaultRatio, brand, product, referenceImageUrls: [] }) })
      const data = await response.json().catch(() => ({})) as { id?: string; status?: GenerationResult['status']; error?: string }
      if (!response.ok || !data.id) throw new Error(data.error || '未能建立生成任務。')
      setServerResults((current) => [{ id: data.id!, workflowId, imageUrl: null, title: `${workflow.title} · queued`, status: data.status || 'queued' }, ...current])
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
  if (!session) return <AuthPage onAuthenticated={(nextSession) => {
    setSession(nextSession)
    void loadGenerations(nextSession.currentWorkspace.id).then(setServerResults)
  }} />

  const userInitial = session.user.name.trim().charAt(0).toUpperCase() || session.user.email.charAt(0).toUpperCase()

  return <div className="app-shell" id="workspace">
    <Sidebar workspace={session.currentWorkspace} />
    <main className="main-content">
      <header className="topbar"><div className="crumb"><span>{session.currentWorkspace.name}</span><span>/</span><strong>建立電商視覺</strong></div><div className="topbar-actions"><button className="plan-button" type="button"><Gift size={17} /> 升級方案</button><button className="icon-button" type="button" aria-label="通知"><Bell size={19} /><i /></button><button className="user-chip" type="button"><span>{userInitial}</span><strong>{session.user.name}</strong></button><button className="icon-button" type="button" aria-label="登出" onClick={logout}><LogOut size={18} /></button></div></header>
      <div className="page-title"><div><h1>建立電商視覺</h1><p>用產品資料與參考圖，快速做出可投放的商業素材。</p></div><div className="credit-meter"><Sparkles size={17} /><span>可用 <strong>{session.currentWorkspace.availableCredits}</strong> 額度</span></div></div>
      <ol className="progress" aria-label="建立流程"><li className="done"><b>1</b><span>填寫產品資料</span></li><li className="done"><b>2</b><span>上傳參考圖片</span></li><li className="current"><b>3</b><span>選擇視覺格式</span></li><li><b>4</b><span>生成結果</span></li></ol>
      <section className="workspace-grid"><CreationForm brand={brand} product={product} onBrandChange={setBrand} onProductChange={setProduct} /><ReferenceUploader /><WorkflowPicker selectedId={workflowId} onChange={setWorkflowId} /></section>
      {notice && <p className="workspace-notice" role="alert">{notice}</p>}
      <div className="create-bar"><div><strong>{workflow.title}</strong><span>{workflow.defaultRatio} · 會預留 2 額度，完成後才結算</span></div><button className="primary-button" type="button" onClick={generate} disabled={isGenerating}>{isGenerating ? '正在建立…' : '生成兩個商用變體'}</button></div>
      <ResultsPanel results={visibleResults} activeWorkflow={workflowId} isGenerating={isGenerating} onGenerate={generate} />
    </main>
  </div>
}
