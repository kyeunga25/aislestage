import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock3, FileImage, ImagePlus, ShieldCheck, UploadCloud } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import demoSpeaker from '../assets/demo-speaker.png'
import type { BrandPack, Product } from '../lib/types'

export type WizardStep = 1 | 2 | 3

type Props = {
  brand: BrandPack
  product: Product
  step: WizardStep
  isGenerating: boolean
  generationAvailable: boolean
  availableCredits: number
  onBrandChange: (next: BrandPack) => void
  onProductChange: (next: Product) => void
  onStepChange: (next: WizardStep) => void
  onGenerate: () => void
}

const steps: Array<{ id: WizardStep; short: string; label: string }> = [
  { id: 1, short: '商品', label: '商品圖片' },
  { id: 2, short: '內容', label: '推廣內容' },
  { id: 3, short: '生成', label: '確認並生成' }
]

const formats = [
  { ratio: '1:1', label: '商品主圖', className: 'square' },
  { ratio: '4:5', label: '社交廣告', className: 'portrait' },
  { ratio: '9:16', label: '限時動態', className: 'story' }
]

function StepProgress({ current, onChange }: { current: WizardStep; onChange: (step: WizardStep) => void }) {
  return <ol className="wizard-progress" aria-label="Campaign Pack 建立流程">
    {steps.map((item) => <li className={item.id === current ? 'current' : item.id < current ? 'complete' : ''} key={item.id}>
      <button type="button" onClick={() => onChange(item.id)} aria-current={item.id === current ? 'step' : undefined}>
        <span>{item.id < current ? <Check size={16} /> : item.id}</span>
        <strong><i>{item.short}</i><b>{item.label}</b></strong>
      </button>
    </li>)}
  </ol>
}

function PackSummary({ availableCredits, generationAvailable }: { availableCredits: number; generationAvailable: boolean }) {
  return <aside className="pack-summary" aria-labelledby="pack-summary-title">
    <div className="summary-heading"><span>固定輸出</span><h2 id="pack-summary-title">這次會生成</h2></div>
    <div className="format-preview" aria-label="輸出尺寸">
      {formats.map((format) => <div key={format.ratio}><span className={`ratio-frame ${format.className}`} /><strong>{format.ratio}</strong><small>{format.label}</small></div>)}
    </div>
    <ul className="quality-list">
      <li><CheckCircle2 size={18} /><span><strong>商品外觀保持一致</strong><small>以原圖合成，不重新繪製產品</small></span></li>
      <li><CheckCircle2 size={18} /><span><strong>促銷文字準確呈現</strong><small>價格、優惠與 CTA 由程式排版</small></span></li>
      <li><CheckCircle2 size={18} /><span><strong>繁中及英文文案</strong><small>同一套資料，不用重複輸入</small></span></li>
    </ul>
    <div className="summary-meta"><span><Clock3 size={17} />{generationAvailable ? '約 2–4 分鐘' : '封閉測試中'}</span><span>可用額度 <strong>{availableCredits}</strong></span></div>
  </aside>
}

export function CampaignWizard({ brand, product, step, isGenerating, generationAvailable, availableCredits, onBrandChange, onProductChange, onStepChange, onGenerate }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState({ name: 'minibeat_speaker_black.png', url: demoSpeaker })
  const [campaignIntent, setCampaignIntent] = useState('限時優惠')
  const [hasRights, setHasRights] = useState(true)

  useEffect(() => () => {
    if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url)
  }, [image.url])

  const setProduct = (key: keyof Product, value: string | string[]) => onProductChange({ ...product, [key]: value })
  const setBrand = (key: keyof BrandPack, value: string) => onBrandChange({ ...brand, [key]: value })

  function updateBenefit(index: number, value: string) {
    const next = [...product.benefits]
    next[index] = value
    setProduct('benefits', next)
  }

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setImage({ name: file.name, url: URL.createObjectURL(file) })
  }

  return <>
    <StepProgress current={step} onChange={onStepChange} />
    <div className="wizard-layout">
      <section className="wizard-card" aria-live="polite">
        {step === 1 ? <>
          <div className="step-heading"><span>步驟 1 / 3</span><h2>上傳已確認的商品圖片</h2><p>使用清晰、沒有促銷文字的產品圖；系統會保留商品外觀。</p></div>
          <div className="upload-preview">
            <img src={image.url} alt={`${product.name} 商品參考圖`} />
            <div><span><FileImage size={18} /><strong>{image.name}</strong><small>原圖只會用於這個工作區</small></span><button className="outline-button" type="button" onClick={() => inputRef.current?.click()}><ImagePlus size={17} />更換圖片</button></div>
            <input ref={inputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} />
          </div>
          <div className="field-grid two-columns">
            <label><span>商品名稱</span><input value={product.name} onChange={(event) => setProduct('name', event.target.value)} /></label>
            <label><span>商品類別</span><select value={product.category} onChange={(event) => setProduct('category', event.target.value)}><option>消費電子</option><option>美妝／保健</option><option>生活消費品</option><option>服飾／配件</option><option>食品／飲品</option></select></label>
          </div>
          <div className="rights-note"><ShieldCheck size={18} /><span>請只上傳你有權用於商業宣傳的圖片。</span></div>
          <div className="wizard-actions single"><button className="primary-button" type="button" onClick={() => onStepChange(2)}>下一步：填寫推廣內容<ArrowRight size={18} /></button></div>
        </> : null}

        {step === 2 ? <>
          <div className="step-heading"><span>步驟 2 / 3</span><h2>確認今次推廣內容</h2><p>只填會出現在素材上的資料；所有商業文字都會依照這裡準確排版。</p></div>
          <div className="field-grid two-columns">
            <label><span>品牌名稱</span><input value={brand.name} onChange={(event) => setBrand('name', event.target.value)} /></label>
            <label><span>推廣目的</span><select value={campaignIntent} onChange={(event) => setCampaignIntent(event.target.value)}><option>限時優惠</option><option>新品推廣</option><option>日常銷售</option><option>節日活動</option></select></label>
            <label><span>價格</span><input value={product.price} onChange={(event) => setProduct('price', event.target.value)} /></label>
            <label><span>優惠內容</span><input value={product.promotion} onChange={(event) => setProduct('promotion', event.target.value)} /></label>
          </div>
          <fieldset className="benefit-fields"><legend>三個主要賣點</legend><div>{[0, 1, 2].map((index) => <label key={index}><span>{index + 1}</span><input value={product.benefits[index] || ''} onChange={(event) => updateBenefit(index, event.target.value)} placeholder={`賣點 ${index + 1}`} /></label>)}</div></fieldset>
          <div className="field-grid two-columns">
            <label><span>品牌語氣</span><input value={brand.tone} onChange={(event) => setBrand('tone', event.target.value)} /></label>
            <label><span>行動呼籲 CTA</span><input value={brand.cta} onChange={(event) => setBrand('cta', event.target.value)} /></label>
          </div>
          <div className="wizard-actions"><button className="text-button" type="button" onClick={() => onStepChange(1)}><ArrowLeft size={17} />返回商品圖片</button><button className="primary-button" type="button" onClick={() => onStepChange(3)}>下一步：確認素材包<ArrowRight size={18} /></button></div>
        </> : null}

        {step === 3 ? <>
          <div className="step-heading"><span>步驟 3 / 3</span><h2>確認後建立 Campaign Pack</h2><p>三個尺寸會使用同一套商品、促銷內容與品牌語氣。</p></div>
          <div className="review-product"><img src={image.url} alt="商品縮圖" /><div><span>{brand.name}</span><h3>{product.name}</h3><p>{product.price} · {product.promotion}</p></div><button className="text-link" type="button" onClick={() => onStepChange(1)}>修改商品</button></div>
          <div className="review-section"><div className="review-title"><span>推廣內容</span><button className="text-link" type="button" onClick={() => onStepChange(2)}>修改內容</button></div><dl><div><dt>目的</dt><dd>{campaignIntent}</dd></div><div><dt>賣點</dt><dd>{product.benefits.filter(Boolean).join(' · ')}</dd></div><div><dt>CTA</dt><dd>{brand.cta}</dd></div></dl></div>
          <div className="included-strip"><strong>素材包包括</strong>{formats.map((format) => <span key={format.ratio}>{format.ratio} {format.label}</span>)}<span>繁中＋英文文案</span></div>
          <label className="confirm-check"><input type="checkbox" checked={hasRights} onChange={(event) => setHasRights(event.target.checked)} /><span><strong>我已確認圖片使用權及以上商業資料</strong><small>生成後的文字會按照這些資料準確呈現。</small></span></label>
          <div className="wizard-actions"><button className="text-button" type="button" onClick={() => onStepChange(2)}><ArrowLeft size={17} />返回推廣內容</button><button className="primary-button generate-button" type="button" onClick={onGenerate} disabled={!hasRights || isGenerating || !generationAvailable}>{isGenerating ? <><UploadCloud size={18} />正在建立素材包…</> : generationAvailable ? <>建立 Campaign Pack<ArrowRight size={18} /></> : <>AI 生成尚未開放</>}</button></div>
        </> : null}
      </section>
      <PackSummary availableCredits={availableCredits} generationAvailable={generationAvailable} />
    </div>
    <div className="flow-note"><strong>固定流程</strong><span>上傳商品</span><ArrowRight size={14} /><span>確認內容</span><ArrowRight size={14} /><span>生成素材包</span></div>
  </>
}
