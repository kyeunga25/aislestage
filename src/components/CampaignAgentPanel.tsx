import { ArrowRight, Bot, Check, CheckCircle2, CircleAlert, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { CampaignAgentState } from '../lib/types'

type Props = {
  state: CampaignAgentState
  busy: boolean
  generationAvailable: boolean
  onPlan: () => void
  onApprove: () => void
  onGenerate: () => void
  onRevise: (note: string) => void
}

export function CampaignAgentPanel({ state, busy, generationAvailable, onPlan, onApprove, onGenerate, onRevise }: Props) {
  const [showRevision, setShowRevision] = useState(false)
  const [revisionNote, setRevisionNote] = useState('')
  const canApprove = state.stage === 'awaiting-approval'

  function submitRevision() {
    if (!revisionNote.trim()) return
    onRevise(revisionNote)
    setRevisionNote('')
    setShowRevision(false)
  }

  return <section className="agent-panel" aria-labelledby="campaign-agent-title">
    <div className="agent-heading">
      <span className="agent-mark"><Bot size={19} /></span>
      <div><h2 id="campaign-agent-title">Campaign Agent</h2><p>先核對資料，再等待你批准</p></div>
    </div>

    <div className="agent-summary" aria-live="polite">
      <strong>{state.stage === 'approved' ? '輸出計劃已批准' : state.stage === 'awaiting-approval' ? '等待你批准' : state.stage === 'needs-input' ? '需要補充資料' : '準備分析 Campaign Brief'}</strong>
      <p>{state.summary}</p>
    </div>

    {state.checks.length ? <ol className="agent-checks">
      {state.checks.slice(0, 3).map((check) => <li className={check.status} key={check.id}>
        <span>{check.status === 'complete' ? <Check size={14} /> : <CircleAlert size={14} />}</span>
        <div><strong>{check.label}</strong><small>{check.detail}</small></div>
      </li>)}
    </ol> : <div className="agent-empty"><ShieldCheck size={23} /><p>Agent 不會自行發佈廣告或消耗生成額度。</p></div>}

    {state.plan.length ? <div className="agent-output-list">
      <div className="agent-section-title"><strong>建議輸出格式</strong><span>已選擇 {state.plan.filter((item) => item.selected).length} 項</span></div>
      {state.plan.map((item) => <div className="agent-output" key={item.id}>
        <span className={`mini-ratio ratio-${item.ratio.replace(':', '-')}`} />
        <div><strong>{item.ratio} {item.label}</strong><small>{item.dimensions}</small></div>
        <CheckCircle2 size={17} />
      </div>)}
    </div> : null}

    <div className="agent-actions">
      {state.stage === 'idle' || state.stage === 'needs-input' ? <button className="primary-button wide" type="button" onClick={onPlan} disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17} />正在檢查…</> : <><Bot size={17} />{state.stage === 'needs-input' ? '重新檢查資料' : '由 Agent 建立計劃'}</>}</button> : null}
      {canApprove ? <>
        <button className="primary-button wide" type="button" onClick={onApprove} disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17} />正在批准…</> : <><ShieldCheck size={17} />批准輸出計劃<ArrowRight size={17} /></>}</button>
        <button className="text-button wide" type="button" onClick={() => setShowRevision((value) => !value)}>提出調整</button>
      </> : null}
      {state.stage === 'approved' ? <button className="primary-button wide" type="button" onClick={onGenerate} disabled={busy || !generationAvailable}>{generationAvailable ? <><Bot size={17} />建立 Campaign Pack<ArrowRight size={17} /></> : <><CheckCircle2 size={17} />計劃已批准，生成未開放</>}</button> : null}
      {state.stage !== 'idle' ? <button className="agent-refresh" type="button" onClick={onPlan} disabled={busy}><RefreshCw size={14} />依目前資料重新規劃</button> : null}
    </div>

    {showRevision ? <div className="revision-box"><label htmlFor="revision-note">想調整甚麼？</label><textarea id="revision-note" rows={3} value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} placeholder="例如：主圖減少促銷感，突出產品質感" /><button className="outline-button" type="button" onClick={submitRevision} disabled={!revisionNote.trim()}>送出調整</button></div> : null}
    <p className="approval-note"><ShieldCheck size={13} />只有你批准後才會進入生成步驟</p>
  </section>
}
