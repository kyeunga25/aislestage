import { Image as ImageIcon, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { GenerationResult } from '../lib/types'
import { ApprovedOutputDownloads } from './ApprovedOutputDownloads'

type Props = {
  result: GenerationResult
  demoMode?: boolean
  canReview?: boolean
  reviewingId?: string | null
  reviewingDecision?: 'approve' | 'reject' | null
  deletingResultId?: string | null
  controlsDisabled?: boolean
  onReviewResult?: (result: GenerationResult, decision: 'approve' | 'reject') => void
  onDeleteResult: (result: GenerationResult) => void
}

const generationTime = new Intl.DateTimeFormat('zh-HK', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Hong_Kong'
})

function outputStatus(result: GenerationResult, demoMode: boolean) {
  if (result.status === 'failed') return { label: '生成失敗', className: 'failed' }
  if (result.status === 'processing') return { label: '處理中', className: 'processing' }
  if (result.status === 'queued') return { label: '排隊中', className: 'queued' }
  if (demoMode && result.imageUrl) return { label: '示範預覽', className: 'demo' }
  if (result.reviewStatus === 'approved') return { label: '已核准', className: 'approved' }
  if (result.reviewStatus === 'rejected') return { label: '需要修改', className: 'rejected' }
  return { label: '草稿待審核', className: 'draft' }
}

function outputTime(createdAt?: string) {
  if (!createdAt) return '本機預覽'
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime()) ? '本機預覽' : generationTime.format(date)
}

export function GenerationLibraryCard({
  result,
  demoMode = false,
  canReview = false,
  reviewingId = null,
  reviewingDecision = null,
  deletingResultId = null,
  controlsDisabled = false,
  onReviewResult,
  onDeleteResult
}: Props) {
  const [pngExportBusy, setPngExportBusy] = useState(false)
  const reviewStatus = result.reviewStatus || 'draft'
  const status = outputStatus(result, demoMode)
  const hasPreview = Boolean(result.imageUrl)
  const completedOutput = !demoMode && result.status === 'completed' && hasPreview
  const reviewBusy = reviewingId === result.id
  const deleting = deletingResultId === result.id
  const mutationLocked = controlsDisabled || reviewingId !== null || deletingResultId !== null || pngExportBusy
  const approveBusy = reviewBusy && reviewingDecision === 'approve'
  const rejectBusy = reviewBusy && reviewingDecision === 'reject'

  return <article className="generation-library-card" aria-busy={reviewBusy || deleting || pngExportBusy}>
    <div className="generation-library-preview">
      {result.imageUrl
        ? <a href={result.imageUrl} target="_blank" rel="noreferrer" aria-label={`開啟 ${result.aspectRatio} ${result.title} 預覽`}><img src={result.imageUrl} alt={result.title} loading="lazy" /></a>
        : <div className="generation-library-placeholder"><ImageIcon size={24} /><span>{status.label}</span></div>}
      <span className={`generation-library-status ${status.className}`}>{status.label}</span>
    </div>
    <div className="generation-library-body">
      <div className="generation-library-title"><strong>{result.aspectRatio}</strong><span>{result.title}</span></div>
      <small className="generation-library-time">{outputTime(result.createdAt)}</small>
      {result.provenance ? <small className="result-provenance">{result.provenance.compositionVersion || 'legacy-composition'} · {result.provenance.generationMode || 'mode-unavailable'} · plan v{result.provenance.approvedRevision}</small> : null}
      {completedOutput && reviewStatus === 'draft' && onReviewResult && canReview ? <div className="generation-library-review-actions" aria-label={`${result.aspectRatio} ${result.title} 審核動作`}>
        <button className="approve" type="button" aria-label={`核准 ${result.aspectRatio} ${result.title}`} onClick={() => onReviewResult(result, 'approve')} disabled={mutationLocked}><ShieldCheck size={15} />{approveBusy ? <>處理中…<span className="visually-hidden"> Processing…</span></> : '核准'}</button>
        <button className="reject" type="button" aria-label={`標記 ${result.aspectRatio} ${result.title}需要修改`} onClick={() => onReviewResult(result, 'reject')} disabled={mutationLocked}><RotateCcw size={15} />{rejectBusy ? <>處理中…<span className="visually-hidden"> Processing…</span></> : '需要修改'}</button>
      </div> : null}
      {completedOutput && reviewStatus === 'draft' && onReviewResult && !canReview ? <p className="review-guidance">等待 owner 或 admin 核准</p> : null}
      {completedOutput && reviewStatus === 'rejected' ? <p className="review-guidance rejected">此草稿不會交付；請按已批准計劃重新生成。</p> : null}
      {hasPreview ? <div className="generation-library-footer">
        {completedOutput && reviewStatus === 'approved' && result.downloadUrl ? <ApprovedOutputDownloads result={result} controlsDisabled={controlsDisabled || deleting} onBusyChange={setPngExportBusy} /> : null}
        <button className="generation-delete" type="button" onClick={() => onDeleteResult(result)} aria-label={deleting ? `正在刪除 ${result.title} · Deleting ${result.title}` : `刪除 ${result.title}`} disabled={mutationLocked}><Trash2 size={15} />{deleting ? <>刪除中…<span className="visually-hidden"> Deleting…</span></> : '刪除'}</button>
      </div> : null}
    </div>
  </article>
}
