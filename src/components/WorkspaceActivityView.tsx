import {
  ArrowLeft,
  BadgeCheck,
  CircleX,
  History,
  PackageCheck,
  RefreshCw,
  Trash2,
  Upload,
  type LucideProps
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { WorkspaceActivityEvent, WorkspaceActivityEventType } from '../lib/types'

type Props = {
  activity: WorkspaceActivityEvent[]
  isRefreshing: boolean
  notice: string
  onRefresh?: () => void
  onBack: () => void
}

const eventCopy: Record<WorkspaceActivityEventType, { title: string; titleEn: string; icon: ComponentType<LucideProps>; tone: string }> = {
  product_asset_uploaded: { title: '商品來源圖已上載', titleEn: 'Product source uploaded', icon: Upload, tone: 'created' },
  product_asset_deleted: { title: '商品來源圖已刪除', titleEn: 'Product source deleted', icon: Trash2, tone: 'deleted' },
  campaign_pack_created: { title: 'Campaign Pack 已建立', titleEn: 'Campaign Pack created', icon: PackageCheck, tone: 'created' },
  generation_approved: { title: '輸出已核准', titleEn: 'Output approved', icon: BadgeCheck, tone: 'approved' },
  generation_rejected: { title: '輸出需要修改', titleEn: 'Output rejected', icon: CircleX, tone: 'rejected' },
  generation_deleted: { title: '私人輸出已刪除', titleEn: 'Private output deleted', icon: Trash2, tone: 'deleted' }
}

const activityTime = new Intl.DateTimeFormat('zh-HK', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Hong_Kong'
})

export function WorkspaceActivityView({ activity, isRefreshing, notice, onRefresh, onBack }: Props) {
  return <section className="collection-view activity-view" aria-busy={isRefreshing}>
    <div className="collection-heading">
      <div className="collection-heading-main"><span><History size={21} /></span><div><h1>工作區活動</h1><p>Workspace activity · 追蹤重要素材與審核操作。</p></div></div>
      <div className="collection-actions">
        {onRefresh ? <button className="outline-button" type="button" onClick={onRefresh} disabled={isRefreshing} aria-label={isRefreshing ? '正在重新載入活動 · Reloading activity' : '重新載入活動 · Refresh activity'}><RefreshCw className={isRefreshing ? 'spin' : undefined} size={16} />{isRefreshing ? '重新載入中…' : '重新載入'}</button> : null}
        <button className="outline-button" type="button" onClick={onBack}><ArrowLeft size={16} />返回工作台</button>
      </div>
    </div>
    <p className="activity-privacy"><BadgeCheck size={18} /><span><strong>私隱安全記錄</strong>只保存操作類型、時間與已知操作者；不記錄圖片、檔案名稱或 Campaign Brief 內容。 <small>Privacy-safe metadata only.</small></span></p>
    {notice ? <p className="workspace-notice collection-notice" role="alert">{notice}</p> : null}
    {activity.length ? <ol className="activity-timeline" aria-label="工作區活動時間線 · Workspace activity timeline">
      {activity.map((event) => {
        const copy = eventCopy[event.type]
        const Icon = copy.icon
        return <li className="activity-event" key={event.id}>
          <span className={`activity-event-icon ${copy.tone}`}><Icon size={18} /></span>
          <div><strong>{copy.title}</strong><small>{copy.titleEn}</small></div>
          <span className="activity-actor">{event.actorName || '系統記錄 · System record'}</span>
          <time dateTime={event.createdAt}>{activityTime.format(new Date(event.createdAt))}</time>
        </li>
      })}
    </ol> : <div className="empty-library"><History size={24} /><strong>{isRefreshing ? '正在載入活動…' : '尚未有活動記錄'}</strong><p>{isRefreshing ? 'Loading workspace activity…' : '新版本會在重要素材及審核操作後建立私隱安全記錄。'}</p></div>}
  </section>
}
