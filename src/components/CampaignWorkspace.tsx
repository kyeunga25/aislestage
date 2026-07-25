import { Check, FileImage, ImagePlus, LoaderCircle, Plus, ShieldCheck, Trash2, UploadCloud, X } from 'lucide-react'
import { useRef, type ChangeEvent } from 'react'
import type { BrandPack, CampaignAgentState, Product, ProductAsset } from '../lib/types'
import { CampaignAgentPanel } from './CampaignAgentPanel'

type ImageState = {
  name: string
  url: string
  asset: ProductAsset | null
  status: 'demo' | 'uploading' | 'ready' | 'error'
  error: string
}

type Props = {
  brand: BrandPack
  product: Product
  intent: string
  image: ImageState
  agentState: CampaignAgentState
  agentBusy: boolean
  generationAvailable: boolean
  onBrandChange: (next: BrandPack) => void
  onProductChange: (next: Product) => void
  onIntentChange: (next: string) => void
  onImageSelected: (file: File) => void
  onImageDelete: () => void
  onPlan: () => void
  onApprove: () => void
  onGenerate: () => void
}

export type { ImageState }

export function CampaignWorkspace(props: Props) {
  const { brand, product, intent, image, agentState, agentBusy, generationAvailable, onBrandChange, onProductChange, onIntentChange, onImageSelected, onImageDelete, onPlan, onApprove, onGenerate } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const englishReady = Boolean(
    product.nameEn
    && product.promotionEn
    && product.benefitsEn.filter(Boolean).length >= 2
    && brand.ctaEn
  )
  const factsReady = Boolean(
    brand.name
    && product.name
    && product.price
    && product.promotion
    && product.benefits.filter(Boolean).length >= 2
    && englishReady
  )
  const imageReady = image.status === 'ready' || image.status === 'demo'
  const agentReady = agentState.stage === 'awaiting-approval' || agentState.stage === 'approved'

  const setProduct = (key: keyof Product, value: string | string[]) => onProductChange({ ...product, [key]: value })
  const setBrand = (key: keyof BrandPack, value: string) => onBrandChange({ ...brand, [key]: value })

  function updateBenefit(index: number, value: string) {
    const next = [...product.benefits]
    next[index] = value
    setProduct('benefits', next)
  }

  function updateBenefitEn(index: number, value: string) {
    const next = [...product.benefitsEn]
    next[index] = value
    setProduct('benefitsEn', next)
  }

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) onImageSelected(file)
    event.target.value = ''
  }

  const progress = [
    { label: '商品資料', complete: factsReady, current: !factsReady },
    { label: '商品圖片', complete: imageReady, current: factsReady && !imageReady },
    { label: 'Agent 規劃', complete: agentReady, current: factsReady && imageReady && !agentReady },
    { label: '確認輸出', complete: agentState.stage === 'approved', current: agentState.stage === 'awaiting-approval' }
  ]

  return <>
    <ol className="campaign-progress" aria-label="Campaign Pack 建立流程">
      {progress.map((item, index) => <li className={item.complete ? 'complete' : item.current ? 'current' : ''} key={item.label}><span>{item.complete ? <Check size={14} /> : index + 1}</span><strong>{item.label}</strong></li>)}
    </ol>

    <div className="studio-grid">
      <section className="brief-panel" aria-labelledby="brief-title">
        <div className="panel-heading"><h2 id="brief-title">品牌與商品資料</h2><p>只使用已核實、可以公開宣傳的資料。</p></div>
        <div className="compact-fields">
          <label><span>品牌名稱</span><input value={brand.name} onChange={(event) => setBrand('name', event.target.value)} /></label>
          <label><span>商品名稱</span><input value={product.name} onChange={(event) => setProduct('name', event.target.value)} /></label>
          <div className="field-row"><label><span>價格（HKD）</span><input value={product.price} onChange={(event) => setProduct('price', event.target.value)} /></label><label><span>推廣目的</span><select value={intent} onChange={(event) => onIntentChange(event.target.value)}><option>限時優惠</option><option>新品推廣</option><option>日常銷售</option><option>節日活動</option></select></label></div>
          <label><span>促銷資訊</span><input value={product.promotion} maxLength={240} onChange={(event) => setProduct('promotion', event.target.value)} /></label>
          <fieldset className="selling-points"><legend>產品賣點（最多 3 點）</legend>{[0, 1, 2].map((index) => <label key={index}><b>{index + 1}</b><input value={product.benefits[index] || ''} onChange={(event) => updateBenefit(index, event.target.value)} placeholder={`賣點 ${index + 1}`} />{product.benefits[index] ? <X size={13} /> : <Plus size={13} />}</label>)}</fieldset>
          <label><span>品牌語氣</span><input value={brand.tone} onChange={(event) => setBrand('tone', event.target.value)} /></label>
          <label><span>行動呼籲 CTA</span><input value={brand.cta} onChange={(event) => setBrand('cta', event.target.value)} /></label>
          <details className="bilingual-fields">
            <summary>{englishReady ? '英文文案資料已填寫' : '填寫英文文案資料'} <small>English copy</small></summary>
            <div>
              <label><span>Product name</span><input lang="en" value={product.nameEn} onChange={(event) => setProduct('nameEn', event.target.value)} /></label>
              <label><span>Promotion</span><input lang="en" value={product.promotionEn} maxLength={240} onChange={(event) => setProduct('promotionEn', event.target.value)} /></label>
              <fieldset className="selling-points"><legend>Product benefits (up to 3)</legend>{[0, 1, 2].map((index) => <label key={index}><b>{index + 1}</b><input lang="en" value={product.benefitsEn[index] || ''} onChange={(event) => updateBenefitEn(index, event.target.value)} placeholder={`Benefit ${index + 1}`} />{product.benefitsEn[index] ? <X size={13} /> : <Plus size={13} />}</label>)}</fieldset>
              <label><span>Call to action</span><input lang="en" value={brand.ctaEn} onChange={(event) => setBrand('ctaEn', event.target.value)} /></label>
            </div>
          </details>
        </div>
        <div className={`facts-status ${factsReady ? 'ready' : ''}`}><ShieldCheck size={17} /><span><strong>{factsReady ? '資料已就緒' : '仍需補充資料'}</strong><small>{factsReady ? '所有必填欄位已完成' : 'Agent 會指出仍欠缺的項目'}</small></span></div>
      </section>

      <section className="product-panel" aria-labelledby="product-image-title">
        <div className="panel-heading split"><div><h2 id="product-image-title">商品圖片</h2><p>建議正面 1:1、解析度 2000px 以上。</p></div>{image.status === 'ready' ? <span className="private-label"><ShieldCheck size={13} />私人保存</span> : null}</div>
        <div className={`product-canvas${image.url ? '' : ' empty'}`}>{image.url
          ? <img src={image.url} alt={`${product.name || '商品'} 商品原圖`} />
          : <div><ImagePlus size={28} /><strong>加入商品原圖</strong><span>圖片只會透過已授權的工作區路徑顯示</span></div>}
        </div>
        <button className="upload-zone" type="button" onClick={() => inputRef.current?.click()} disabled={image.status === 'uploading'}>
          {image.status === 'uploading' ? <LoaderCircle className="spin" size={20} /> : <UploadCloud size={20} />}
          <span><strong>{image.status === 'uploading' ? '正在安全上傳…' : '更換商品圖片'}</strong><small>支援 JPG、PNG、WebP，最大 4 MB</small></span>
        </button>
        <input ref={inputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} />
        <div className={`asset-row ${image.status}`}><FileImage size={17} /><span><strong>{image.name}</strong><small>{image.status === 'ready' ? '已儲存在此工作區的私人素材庫' : image.status === 'error' ? image.error : image.status === 'uploading' ? '正在處理檔案' : '本機示範素材'}</small></span><div className="asset-actions"><button type="button" onClick={() => inputRef.current?.click()} aria-label="更換圖片"><ImagePlus size={16} /></button>{image.url ? <button type="button" onClick={onImageDelete} aria-label="刪除圖片"><Trash2 size={15} /></button> : null}</div></div>
      </section>

      <CampaignAgentPanel state={agentState} busy={agentBusy} generationAvailable={generationAvailable} onPlan={onPlan} onApprove={onApprove} onGenerate={onGenerate} />
    </div>
  </>
}
