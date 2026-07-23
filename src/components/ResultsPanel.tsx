import { ArrowDownToLine, CheckCircle2, Copy, PackageCheck, Plus, RotateCcw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { GenerationResult, Product } from '../lib/types'

type Props = { results: GenerationResult[]; product: Product; cta: string; isGenerating: boolean; generationAvailable: boolean; onGenerate: () => void; onStartNew: () => void }

const outputs = [
  { ratio: '1:1', label: '商品主圖', className: 'square' },
  { ratio: '4:5', label: '社交廣告', className: 'portrait' },
  { ratio: '9:16', label: '限時動態', className: 'story' }
]

export function ResultsPanel({ results, product, cta, isGenerating, generationAvailable, onGenerate, onStartNew }: Props) {
  const [copied, setCopied] = useState(false)
  const caption = `細機身，大聲勢。${product.name} ${product.promotion} 現正開始。\n\n${product.benefits.filter(Boolean).join('、')}，無論在家還是出門都能自在享受。${product.price}，${cta}。`

  async function copyCaption() {
    await navigator.clipboard.writeText(caption)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return <section className="results-panel" id="campaign-results" aria-labelledby="result-title">
    <div className="results-head"><div><span className="result-icon"><PackageCheck size={20} /></span><div><span>Campaign Pack</span><h2 id="result-title">你的推廣素材包</h2></div></div><button className="outline-button" type="button" onClick={onStartNew}><Plus size={17} />建立另一套</button></div>
    <div className="result-collection">
      {outputs.map((output) => {
        const result = results.find((item) => item.aspectRatio === output.ratio)
        return <article className="result-card" key={output.ratio}>
          <div className={`result-image ${output.className}`}>{result?.imageUrl ? <img src={result.imageUrl} alt={`${output.ratio} ${output.label}`} /> : <div className="result-placeholder"><Sparkles size={24} /><strong>{result?.status === 'failed' ? '生成失敗' : isGenerating ? '正在生成' : '等待生成'}</strong><span>{result?.errorMessage || (isGenerating ? '正在準備版面與文案…' : '素材完成後會顯示在這裡')}</span></div>}</div>
          <div className="result-meta"><span><strong>{output.ratio}</strong>{output.label}</span>{result?.imageUrl ? <a title={`下載 ${output.ratio}`} href={result.imageUrl} download={`aislepack-${output.ratio.replace(':', 'x')}.png`}><ArrowDownToLine size={17} />下載</a> : <button title={`下載 ${output.ratio}`} type="button" disabled><ArrowDownToLine size={17} />下載</button>}</div>
        </article>
      })}
    </div>
    <div className="result-copy-grid">
      <div className="copy-language"><span className="active">繁體中文</span><span>English</span></div>
      <div className="copy-content"><div><span>推廣文案</span><h3>細機身，大聲勢。{product.name} {product.promotion} 現正開始。</h3><p>{product.benefits.filter(Boolean).join('、')}，無論在家還是出門都能自在享受。{product.price}，{cta}。</p></div><button className="outline-button" type="button" onClick={() => void copyCaption()}><Copy size={16} />{copied ? '已複製' : '複製文案'}</button></div>
      <div className="result-quality"><CheckCircle2 size={19} /><span><strong>文字已按確認資料排版</strong><small>商品名稱、價格、優惠與 CTA 沒有交由圖片模型生成。</small></span></div>
    </div>
    <div className="result-actions"><button className="text-button" type="button" onClick={onGenerate} disabled={isGenerating || !generationAvailable}><RotateCcw size={17} />重新生成這套素材</button><button className="primary-button" type="button" disabled={!outputs.every((output) => results.some((result) => result.aspectRatio === output.ratio && result.imageUrl))}><ArrowDownToLine size={18} />下載完整素材包</button></div>
  </section>
}
