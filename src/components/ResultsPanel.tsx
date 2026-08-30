import { CheckCircle2, Copy, PackageCheck, RotateCcw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import campaignScene from '../assets/campaign-speaker-scene.png'
import type { CampaignAgentState, GenerationResult, Product } from '../lib/types'
import { ApprovedOutputDownloads } from './ApprovedOutputDownloads'

type Props = {
  results: GenerationResult[]
  product: Product
  cta: string
  ctaEn: string
  agentState: CampaignAgentState
  isGenerating: boolean
  generationAvailable: boolean
  demoMode: boolean
  canReview: boolean
  reviewingId: string | null
  reviewingDecision: 'approve' | 'reject' | null
  onGenerate: () => void
  onReview: (result: GenerationResult, decision: 'approve' | 'reject') => void
}

const outputs = [
  { ratio: '1:1', label: '商品主圖', className: 'square' },
  { ratio: '4:5', label: '社交廣告', className: 'portrait' },
  { ratio: '9:16', label: '限時動態', className: 'story' }
] as const

export function ResultsPanel({ results, product, cta, ctaEn, agentState, isGenerating, generationAvailable, demoMode, canReview, reviewingId, reviewingDecision, onGenerate, onReview }: Props) {
  const [language, setLanguage] = useState<'zh-Hant' | 'en'>('zh-Hant')
  const [copied, setCopied] = useState(false)
  const latestPackId = results.find((item) => item.campaignPackId)?.campaignPackId
  const visibleResults = latestPackId ? results.filter((item) => item.campaignPackId === latestPackId) : results
  const completedResults = visibleResults.filter((item) => item.imageUrl)
  const allCompletedResultsApproved = completedResults.length > 0 && completedResults.every((item) => item.reviewStatus === 'approved')
  const zhCaption = `${product.name}\n${product.promotion}\n${product.benefits.filter(Boolean).map((item) => `✓ ${item}`).join('\n')}\n${product.price} · ${cta}`
  const enCaption = `${product.nameEn}\n${product.promotionEn}\n${product.benefitsEn.filter(Boolean).map((item) => `✓ ${item}`).join('\n')}\n${product.price} · ${ctaEn}`
  const caption = language === 'zh-Hant' ? zhCaption : enCaption
  const reviewMutationBusy = reviewingId !== null

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return <section className="results-panel" id="campaign-results" aria-labelledby="result-title">
    <div className="results-head">
      <div><span className="result-icon"><PackageCheck size={20} /></span><div><h2 id="result-title">素材包預覽</h2><p>{demoMode ? '本機互動示範，不會當作正式生成素材' : allCompletedResultsApproved ? '已核准的私人素材，可經受控路徑下載' : completedResults.length > 0 ? '已生成的私人草稿，逐項核准後才開放對應下載' : 'Agent 規劃的版面方向，商業文字保持可編輯'}</p></div></div>
      <span className={`plan-state ${agentState.stage}`}>{agentState.stage === 'approved' ? <><CheckCircle2 size={15} />計劃已批准</> : `計劃版本 ${agentState.revision || 1}`}</span>
    </div>

    <div className="result-workspace">
      <div className="result-collection">
        {outputs.map((output) => {
          const result = visibleResults.find((item) => item.aspectRatio === output.ratio)
          const hasGeneratedImage = Boolean(result?.imageUrl) && !demoMode
          const reviewStatus = result?.reviewStatus || 'draft'
          const reviewBusy = reviewingId === result?.id
          const approveBusy = reviewBusy && reviewingDecision === 'approve'
          const rejectBusy = reviewBusy && reviewingDecision === 'reject'
          const statusLabel = result?.status === 'failed' ? '生成失敗' : result?.status === 'processing' ? '處理中' : result?.status === 'queued' ? '排隊中' : demoMode && result ? '示範預覽' : '待生成'
          const reviewLabel = reviewStatus === 'approved' ? '已核准' : reviewStatus === 'rejected' ? '需要修改' : '草稿待審核'
          return <article className="result-card" key={output.ratio}>
            <div className={`result-image ${output.className}`}>
              <img src={result?.imageUrl || campaignScene} alt={`${output.ratio} ${output.label}${hasGeneratedImage ? '' : '版面預覽'}`} />
              {!hasGeneratedImage ? <div className="deterministic-overlay"><span>{product.benefits[0]}</span><strong>{product.name}</strong><small>{product.benefits.slice(1, 3).filter(Boolean).join(' · ')}</small><b>{product.price}</b><em>{product.promotion}</em></div> : null}
              <span className={`preview-label${hasGeneratedImage ? ` review-${reviewStatus}` : ''}`}>{hasGeneratedImage ? reviewLabel : isGenerating ? '正在生成' : demoMode && result ? '互動示範' : '版面預覽'}</span>
            </div>
            <div className="result-meta">
              <span><strong>{output.ratio}</strong>{output.label}</span>
              {hasGeneratedImage ? <span className={`review-state ${reviewStatus}`} role="status">{reviewLabel}</span> : <span className={`result-status ${result?.status || ''}`} title={result?.errorMessage || undefined}>{isGenerating && !result ? '處理中' : statusLabel}</span>}
            </div>
            {hasGeneratedImage && result ? <div className="result-review-panel" aria-busy={reviewBusy}>
              {result.provenance ? <small className="result-provenance">{result.provenance.compositionVersion || 'legacy-composition'} · {result.provenance.generationMode || 'mode-unavailable'} · plan v{result.provenance.approvedRevision}</small> : null}
              {reviewStatus === 'draft' && canReview ? <div className="result-review-actions" aria-label={`${output.ratio} ${output.label} 審核動作`}>
                <button className="approve" type="button" aria-label={`核准 ${output.ratio} ${output.label}`} onClick={() => onReview(result, 'approve')} disabled={reviewMutationBusy}><ShieldCheck size={15} />{approveBusy ? <>處理中…<span className="visually-hidden"> Processing…</span></> : '核准'}</button>
                <button className="reject" type="button" aria-label={`標記 ${output.ratio} ${output.label}需要修改`} onClick={() => onReview(result, 'reject')} disabled={reviewMutationBusy}><RotateCcw size={15} />{rejectBusy ? <>處理中…<span className="visually-hidden"> Processing…</span></> : '需要修改'}</button>
              </div> : null}
              {reviewStatus === 'draft' && !canReview ? <p className="review-guidance">等待 owner 或 admin 核准</p> : null}
              {reviewStatus === 'approved' && result.downloadUrl ? <ApprovedOutputDownloads result={result} /> : null}
              {reviewStatus === 'rejected' ? <p className="review-guidance rejected">此草稿不會交付；請按已批准計劃重新生成。</p> : null}
            </div> : null}
          </article>
        })}
      </div>

      <aside className="copy-panel" aria-label="雙語推廣文案">
        <div className="copy-tabs"><button className={language === 'zh-Hant' ? 'active' : ''} type="button" onClick={() => setLanguage('zh-Hant')}>繁體中文</button><button className={language === 'en' ? 'active' : ''} type="button" onClick={() => setLanguage('en')}>English</button></div>
        <div className="copy-block"><span>{language === 'zh-Hant' ? '商品標題' : 'Product name'}</span><strong>{language === 'zh-Hant' ? product.name : product.nameEn}</strong></div>
        <div className="copy-block"><span>{language === 'zh-Hant' ? '賣點文案' : 'Product copy'}</span><p>{(language === 'zh-Hant' ? product.benefits : product.benefitsEn).filter(Boolean).map((item) => `✓ ${item}`).join('\n')}</p></div>
        <div className="copy-block"><span>{language === 'zh-Hant' ? '優惠與行動呼籲' : 'Promotion and call to action'}</span><p>{language === 'zh-Hant' ? `${product.promotion} · ${cta}` : `${product.promotionEn} · ${ctaEn}`}</p></div>
        <button className="outline-button copy-all" type="button" onClick={() => void copyCaption()}><Copy size={16} />{copied ? '已複製' : '複製全部文案'}</button>
      </aside>
    </div>

    <div className="result-footer"><span><CheckCircle2 size={17} />商品名稱、價格、優惠與 CTA 由程式準確排版；草稿經人工核准後才可下載</span><button className="text-button" type="button" onClick={onGenerate} disabled={isGenerating || !generationAvailable || agentState.stage !== 'approved'}><RotateCcw size={16} />{isGenerating ? '正在建立素材包…' : '按已批准計劃重新生成'}</button></div>
  </section>
}
