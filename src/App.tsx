import { Bell, Gift, Languages, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { CreationForm, ReferenceUploader } from './components/CreationForm'
import { ResultsPanel } from './components/ResultsPanel'
import { Sidebar } from './components/Sidebar'
import { WorkflowPicker } from './components/WorkflowPicker'
import { demoResults, starterBrand, starterProduct } from './lib/demo-data'
import { workflowById } from './lib/workflows'
import type { BrandPack, Product, WorkflowId } from './lib/types'

export default function App() {
  const [brand, setBrand] = useState<BrandPack>(starterBrand)
  const [product, setProduct] = useState<Product>(starterProduct)
  const [workflowId, setWorkflowId] = useState<WorkflowId>('store-main')
  const [isGenerating, setIsGenerating] = useState(false)
  const workflow = workflowById(workflowId)

  async function generate() {
    setIsGenerating(true)
    try {
      await fetch('/api/generations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'demo-hk-tech-gear', workflowId, aspectRatio: workflow.defaultRatio, brand, product, referenceImageUrls: [] }) })
    } catch {
      // The local Vite demo keeps the workflow usable before Cloudflare bindings are configured.
    } finally {
      window.setTimeout(() => setIsGenerating(false), 900)
    }
  }

  return <div className="app-shell" id="workspace">
    <Sidebar />
    <main className="main-content">
      <header className="topbar"><div className="crumb"><span>工作台</span><span>/</span><strong>建立電商視覺</strong></div><div className="topbar-actions"><button className="plan-button" type="button"><Gift size={17} /> 升級方案</button><button className="icon-button" type="button" aria-label="通知"><Bell size={19} /><i /></button><button className="user-chip" type="button"><span>HT</span><strong>HK Tech Gear</strong></button></div></header>
      <div className="page-title"><div><h1>建立電商視覺</h1><p>用產品資料與參考圖，快速做出可投放的商業素材。</p></div><div className="credit-meter"><Sparkles size={17} /><span>本月尚餘 <strong>18</strong> 額度</span></div></div>
      <ol className="progress" aria-label="建立流程"><li className="done"><b>1</b><span>填寫產品資料</span></li><li className="done"><b>2</b><span>上傳參考圖片</span></li><li className="current"><b>3</b><span>選擇視覺格式</span></li><li><b>4</b><span>生成結果</span></li></ol>
      <section className="workspace-grid"><CreationForm brand={brand} product={product} onBrandChange={setBrand} onProductChange={setProduct} /><ReferenceUploader /><WorkflowPicker selectedId={workflowId} onChange={setWorkflowId} /></section>
      <div className="create-bar"><div><strong>{workflow.title}</strong><span>{workflow.defaultRatio} · 會預留 2 額度，完成後才結算</span></div><button className="primary-button" type="button" onClick={generate} disabled={isGenerating}>{isGenerating ? '正在建立…' : '生成兩個商用變體'}</button></div>
      <ResultsPanel results={demoResults} activeWorkflow={workflowId} isGenerating={isGenerating} onGenerate={generate} />
    </main>
  </div>
}
