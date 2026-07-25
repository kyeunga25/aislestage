import { ArrowDownToLine, CheckCircle2, Copy, PackageCheck, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import campaignScene from '../assets/campaign-speaker-scene.png'
import type { CampaignAgentState, GenerationResult, Product } from '../lib/types'

type Props = {
  results: GenerationResult[]
  product: Product
  cta: string
  ctaEn: string
  agentState: CampaignAgentState
  isGenerating: boolean
  generationAvailable: boolean
  demoMode: boolean
  onGenerate: () => void
}

const outputs = [
  { ratio: '1:1', label: '商品主圖', className: 'square' },
  { ratio: '4:5', label: '社交廣告', className: 'portrait' },
  { ratio: '9:16', label: '限時動態', className: 'story' }
] as const

export function ResultsPanel({ results, product, cta, ctaEn, agentState, isGenerating, generationAvailable, demoMode, onGenerate }: Props) {
  const [language, setLanguage] = useState<'zh-Hant' | 'en'>('zh-Hant')
  const [copied, setCopied] = useState(false)
  const latestPackId = results.find((item) => item.campaignPackId)?.campaignPackId
  const visibleResults = latestPackId ? results.filter((item) => item.campaignPackId === latestPackId) : results
  const zhCaption = `${product.name}\n${product.promotion}\n${product.benefits.filter(Boolean).map((item) => `✓ ${item}`).join('\n')}\n${product.price} · ${cta}`
  const enCaption = `${product.nameEn}\n${product.promotionEn}\n${product.benefitsEn.filter(Boolean).map((item) => `✓ ${item}`).join('\n')}\n${product.price} · ${ctaEn}`
  const caption = language === 'zh-Hant' ? zhCaption : enCaption

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
      <div><span className="result-icon"><PackageCheck size={20} /></span><div><h2 id="result-title">素材包預覽</h2><p>{demoMode ? '本機互動示範，不會當作正式生成素材' : results.some((item) => item.imageUrl) ? '已生成的私人素材' : 'Agent 規劃的版面方向，商業文字保持可編輯'}</p></div></div>
      <span className={`plan-state ${agentState.stage}`}>{agentState.stage === 'approved' ? <><CheckCircle2 size={15} />計劃已批准</> : `計劃版本 ${agentState.revision || 1}`}</span>
    </div>

    <div className="result-workspace">
      <div className="result-collection">
        {outputs.map((output) => {
          const result = visibleResults.find((item) => item.aspectRatio === output.ratio)
          const hasGeneratedImage = Boolean(result?.imageUrl) && !demoMode
          const statusLabel = result?.status === 'failed' ? '生成失敗' : result?.status === 'processing' ? '處理中' : result?.status === 'queued' ? '排隊中' : demoMode && result ? '示範預覽' : '待生成'
          const extension = result?.contentType === 'image/svg+xml' ? 'svg' : 'png'
          return <article className="result-card" key={output.ratio}>
            <div className={`result-image ${output.className}`}>
              <img src={result?.imageUrl || campaignScene} alt={`${output.ratio} ${output.label}${hasGeneratedImage ? '' : '版面預覽'}`} />
              {!hasGeneratedImage ? <div className="deterministic-overlay"><span>{product.benefits[0]}</span><strong>{product.name}</strong><small>{product.benefits.slice(1, 3).filter(Boolean).join(' · ')}</small><b>{product.price}</b><em>{product.promotion}</em></div> : null}
              <span className="preview-label">{hasGeneratedImage ? '已生成' : isGenerating ? '正在生成' : demoMode && result ? '互動示範' : '版面預覽'}</span>
            </div>
            <div className="result-meta">
              <span><strong>{output.ratio}</strong>{output.label}</span>
              {hasGeneratedImage
                ? <a href={result!.imageUrl!} download={`aislepack-${output.ratio.replace(':', 'x')}.${extension}`}><ArrowDownToLine size={16} />下載</a>
                : <span className={`result-status ${result?.status || ''}`} title={result?.errorMessage || undefined}>{isGenerating && !result ? '處理中' : statusLabel}</span>}
            </div>
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

    <div className="result-footer"><span><CheckCircle2 size={17} />商品名稱、價格、優惠與 CTA 由程式準確排版</span><button className="text-button" type="button" onClick={onGenerate} disabled={isGenerating || !generationAvailable || agentState.stage !== 'approved'}><RotateCcw size={16} />{isGenerating ? '正在建立素材包…' : '按已批准計劃重新生成'}</button></div>
  </section>
}
