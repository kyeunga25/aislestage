import { ArrowLeft, Bot, CheckCircle2, CircleSlash2, CreditCard, KeyRound, ListChecks, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { IntegrationReadinessSnapshot } from '../lib/types'

type Props = {
  readiness: IntegrationReadinessSnapshot | null
  isRefreshing: boolean
  notice: string
  onRefresh?: () => void
  onBack: () => void
}

const modeCopy = {
  disabled: '停用 · Disabled',
  deterministic: '確定性 · Deterministic',
  assisted: '受控 AI · Assisted'
} as const

const gateCopy: Array<{
  key: keyof IntegrationReadinessSnapshot['assisted']['gates']
  ready: string
  pending: string
  detail: string
  icon: typeof ShieldCheck
}> = [
  { key: 'providerAllowlisted', ready: 'Provider allowlist 已批准', pending: 'Provider allowlist 待批准', detail: '只核對 server-side allowlist，不顯示 provider identity。', icon: ShieldCheck },
  { key: 'dataPolicyApproved', ready: '資料政策已批准', pending: '資料政策待批准', detail: '須先核對圖片、prompt、response 與 log 處理方式。', icon: ShieldCheck },
  { key: 'evaluationApproved', ready: '固定評估已批准', pending: '固定評估待批准', detail: '合成 fixtures、保真與人工評分必須先完成。', icon: ListChecks },
  { key: 'budgetApproved', ready: '預算控制已批准', pending: '預算控制待批准', detail: '成本上限及 kill switch 維持獨立審批。', icon: CreditCard },
  { key: 'credentialConfigured', ready: 'Server credential 已設定', pending: 'Server credential 待設定', detail: '只回報是否存在；名稱及內容永不返回 browser。', icon: KeyRound }
]

export function IntegrationReadinessView({ readiness, isRefreshing, notice, onRefresh, onBack }: Props) {
  const incompleteGates = readiness
    ? gateCopy.filter(({ key }) => !readiness.assisted.gates[key])
    : []
  const modeDecisionRequired = readiness?.assisted.requested === true
    && readiness.generation.requestedMode !== 'assisted'
  const remainingActionCount = incompleteGates.length + (modeDecisionRequired ? 1 : 0)
  const assistedSummary = readiness?.assisted.executionApproved
    ? 'Assisted execution 的獨立閘門已全部通過。'
    : readiness?.assisted.requested
      ? '目前不會執行 assisted generation；仍有審批或設定未完成。'
      : '目前沒有要求 assisted generation；確定性流程保持獨立。'

  return <section className="collection-view readiness-view" aria-busy={isRefreshing}>
    <div className="collection-heading">
      <div className="collection-heading-main"><span><ListChecks size={21} /></span><div><h1>整合就緒度</h1><p>Integration readiness · 核對部署設定及仍需人工批准的邊界。</p></div></div>
      <div className="collection-actions">
        {onRefresh ? <button className="outline-button" type="button" onClick={onRefresh} disabled={isRefreshing} aria-label={isRefreshing ? '正在重新載入整合就緒度 · Reloading integration readiness' : '重新載入整合就緒度 · Refresh integration readiness'}><RefreshCw className={isRefreshing ? 'spin' : undefined} size={16} />{isRefreshing ? '重新載入中…' : '重新載入'}</button> : null}
        <button className="outline-button" type="button" onClick={onBack}><ArrowLeft size={16} />返回工作台</button>
      </div>
    </div>
    <p className={`readiness-summary ${readiness?.assisted.executionApproved ? 'ready' : 'restricted'}`} role="status">
      {readiness?.assisted.executionApproved ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
      <span><strong>{readiness?.assisted.executionApproved ? '受控 AI 已具執行條件' : '安全閘門仍然生效'}</strong>{assistedSummary}</span>
    </p>
    {notice ? <p className="workspace-notice collection-notice" role="alert">{notice}</p> : null}
    <div className="readiness-stat-grid" aria-label="部署整合狀態摘要 · Deployment integration summary">
      <article><span>存取模式</span><strong>{readiness?.access.authMode === 'access' ? 'Cloudflare Access' : readiness ? '本機密碼' : '—'}</strong><small>{readiness ? `Registration: ${readiness.access.registrationMode}` : 'Authentication mode'}</small></article>
      <article><span>素材生成</span><strong>{readiness ? modeCopy[readiness.generation.effectiveMode] : '—'}</strong><small>{readiness ? `Requested: ${readiness.generation.requestedMode}` : 'Effective generation mode'}</small></article>
      <article><span>Campaign Agent</span><strong>{readiness ? modeCopy[readiness.agent.effectiveMode] : '—'}</strong><small>{readiness ? `Requested: ${readiness.agent.requestedMode}` : 'Effective Agent mode'}</small></article>
      <article><span>工作區併發</span><strong>{readiness?.generation.maxActivePerWorkspace ?? '—'}</strong><small>Max active outputs per workspace</small></article>
    </div>
    <section className="readiness-gates" aria-labelledby="readiness-gates-title">
      <div className="data-head"><div><strong id="readiness-gates-title">Assisted execution 獨立閘門</strong><small>每一項都由 Worker fail closed；browser 不會取得 secret 或 provider mapping</small></div><span>{readiness?.assisted.executionApproved ? '全部通過' : `${incompleteGates.length} 項待完成`}</span></div>
      <div className="readiness-gate-grid">{gateCopy.map((gate) => {
        const ready = readiness?.assisted.gates[gate.key] === true
        const Icon = gate.icon
        return <article className={`readiness-gate ${ready ? 'ready' : 'pending'}`} key={gate.key}>
          <span>{ready ? <CheckCircle2 size={18} /> : <Icon size={18} />}</span>
          <div><strong>{ready ? gate.ready : gate.pending}</strong><small>{gate.detail}</small></div>
        </article>
      })}</div>
    </section>
    {readiness?.assisted.requested && remainingActionCount ? <section className="readiness-actions" aria-labelledby="readiness-actions-title">
      <div className="data-head"><div><strong id="readiness-actions-title">仍需人工完成</strong><small>Remaining operator actions · 本介面不會修改部署設定</small></div><span>{remainingActionCount} 項</span></div>
      <ul>
        {modeDecisionRequired ? <li><CircleSlash2 size={15} /><span>核對並統一 Generation／Agent requested mode</span></li> : null}
        {incompleteGates.map((gate) => <li key={gate.key}><CircleSlash2 size={15} /><span>{gate.pending}</span></li>)}
      </ul>
    </section> : null}
    <p className="readiness-payment-boundary"><CreditCard size={18} /><span><strong>付款、checkout 與 subscription 保持停用</strong>目前沒有付款狀態、價格、交易或自助訂閱流程；任何 provider 接入仍需另行批准。 <small>Payment remains outside the active product path.</small></span></p>
    <p className="readiness-proof-boundary"><Bot size={16} />這是設定快照，不是 live deployment 或 provider connectivity 驗收；正式發佈仍需 fixed-SHA、CI、migration、deployment 及 live-route 證據。</p>
  </section>
}
