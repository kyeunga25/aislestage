import { ArrowDownToLine, Copy, MoreHorizontal, Sparkles } from 'lucide-react'
import type { GenerationResult, WorkflowId } from '../lib/types'

type Props = { results: GenerationResult[]; activeWorkflow: WorkflowId; isGenerating: boolean; onGenerate: () => void }

export function ResultsPanel({ results, activeWorkflow, isGenerating, onGenerate }: Props) {
  const visibleResults = results.filter((result) => result.workflowId === activeWorkflow)
  const rows = visibleResults.length ? visibleResults : results
  return <section className="results-panel" aria-labelledby="result-title">
    <div className="results-head"><div><span className="spark"><Sparkles size={17} /></span><h2 id="result-title">生成結果</h2><span className="result-context">{activeWorkflow === 'store-main' ? '商店主圖' : '商用素材'}</span></div><button className="secondary-button" type="button" onClick={onGenerate} disabled={isGenerating}>{isGenerating ? '正在生成…' : '建立新變體'}</button></div>
    <div className="results-grid">
      <div className="result-collection">
        {rows.map((result, index) => <article className="result-card" key={result.id}>
          <div className="result-image">{result.imageUrl ? <img src={result.imageUrl} alt={result.title} /> : <div className="result-placeholder"><Sparkles size={24} /><strong>{result.status === 'failed' ? '生成失敗' : '等待生成'}</strong><span>{result.errorMessage || result.status}</span></div>}<span className="selection-mark">{index === 0 && result.status === 'completed' ? '✓' : ''}</span></div>
          <div className="result-meta"><span>{result.title}</span><div><button title="下載" type="button"><ArrowDownToLine size={16} /></button><button title="更多" type="button"><MoreHorizontal size={16} /></button></div></div>
        </article>)}
      </div>
      <aside className="copy-panel"><div className="copy-tabs"><strong>文案建議</strong><span>商品描述</span></div><div className="copy-block"><span>推薦標題</span><strong>高效裝機，為你的遊戲而生</strong><button type="button"><Copy size={15} /></button></div><div className="copy-block"><span>賣點</span><p>度身配置、專人裝機測試，從規格到效能都照顧周到。</p><button type="button"><Copy size={15} /></button></div><div className="copy-block"><span>行動呼籲</span><p>立即選購，升級你的電競裝備。</p><button type="button"><Copy size={15} /></button></div><button className="copy-all" type="button"><Copy size={16} /> 複製全部文案</button></aside>
    </div>
  </section>
}
