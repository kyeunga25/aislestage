import { ArrowLeft, CheckCircle2, Clock3, Gauge, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react'
import type { OutputUsageEventType, OutputUsageSnapshot } from '../lib/types'

type Props = {
  usage: OutputUsageSnapshot | null
  isRefreshing: boolean
  notice: string
  onRefresh?: () => void
  onBack: () => void
}

const eventCopy: Record<OutputUsageEventType, {
  title: string
  titleEn: string
  amount: string
  tone: string
  icon: typeof Gauge
}> = {
  reservation: { title: '輸出已預留', titleEn: 'Output reserved', amount: '−1 可用', tone: 'reserved', icon: Clock3 },
  settlement: { title: '生成已完成', titleEn: 'Output completed', amount: '已扣用', tone: 'completed', icon: CheckCircle2 },
  release: { title: '可用輸出已退回', titleEn: 'Output returned', amount: '+1 可用', tone: 'released', icon: RotateCcw }
}

const usageTime = new Intl.DateTimeFormat('zh-HK', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Hong_Kong'
})

export function WorkspaceUsageView({ usage, isRefreshing, notice, onRefresh, onBack }: Props) {
  const statValue = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString('zh-HK')
  return <section className="collection-view usage-view" aria-busy={isRefreshing}>
    <div className="collection-heading">
      <div className="collection-heading-main"><span><Gauge size={21} /></span><div><h1>工作區用量</h1><p>Workspace usage · 核對輸出額度與近期變動。</p></div></div>
      <div className="collection-actions">
        {onRefresh ? <button className="outline-button" type="button" onClick={onRefresh} disabled={isRefreshing} aria-label={isRefreshing ? '正在重新載入用量 · Reloading usage' : '重新載入用量 · Refresh usage'}><RefreshCw className={isRefreshing ? 'spin' : undefined} size={16} />{isRefreshing ? '重新載入中…' : '重新載入'}</button> : null}
        <button className="outline-button" type="button" onClick={onBack}><ArrowLeft size={16} />返回工作台</button>
      </div>
    </div>
    <p className="usage-boundary"><ShieldCheck size={18} /><span><strong>付款與訂閱未啟用</strong>這是 Campaign Pack 的技術用量，不是付款帳單；不包含價格、交易、付款方式或 provider 資料。 <small>Technical usage, not billing.</small></span></p>
    {notice ? <p className="workspace-notice collection-notice" role="alert">{notice}</p> : null}
    <div className="usage-stat-grid" aria-label="工作區輸出用量摘要 · Workspace output usage summary">
      <article><span>可用輸出</span><strong>{statValue(usage?.allowance.availableOutputs)}</strong><small>Available outputs</small></article>
      <article><span>預留中</span><strong>{statValue(usage?.allowance.reservedOutputs)}</strong><small>Reserved while processing</small></article>
      <article><span>已完成</span><strong>{statValue(usage?.summary.completedOutputs)}</strong><small>Completed outputs</small></article>
      <article><span>已退回</span><strong>{statValue(usage?.summary.releasedOutputs)}</strong><small>Returned after failure</small></article>
    </div>
    <section className="usage-events" aria-labelledby="usage-events-title">
      <div className="data-head"><div><strong id="usage-events-title">近期用量變動</strong><small>Recent usage events · 不顯示 generation、provider 或 ledger identity</small></div><span>{usage?.events.length || 0} 項</span></div>
      {usage?.events.length ? <ol className="usage-event-list">
        {usage.events.map((event, index) => {
          const copy = eventCopy[event.type]
          const Icon = copy.icon
          return <li className="usage-event" key={`${event.createdAt}-${event.type}-${index}`}>
            <span className={`usage-event-icon ${copy.tone}`}><Icon size={18} /></span>
            <div><strong>{copy.title}</strong><small>{copy.titleEn}</small></div>
            <span className={`usage-event-amount ${copy.tone}`}>{copy.amount}</span>
            <time dateTime={event.createdAt}>{usageTime.format(new Date(event.createdAt))}</time>
          </li>
        })}
      </ol> : <div className="empty-library compact"><Gauge size={24} /><strong>{isRefreshing ? '正在載入用量…' : '尚未有用量記錄'}</strong><p>{isRefreshing ? 'Loading workspace usage…' : '建立第一套 Campaign Pack 後，預留、完成或退回事件會在此顯示。'}</p></div>}
    </section>
    {usage ? <p className="usage-updated"><Clock3 size={14} />額度最後更新：<time dateTime={usage.allowance.updatedAt}>{usageTime.format(new Date(usage.allowance.updatedAt))}</time></p> : null}
  </section>
}
