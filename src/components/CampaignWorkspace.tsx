import { Check, Download, FileImage, FileUp, ImagePlus, LoaderCircle, Plus, ShieldCheck, Trash2, UploadCloud, X } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { campaignBriefLimits } from '../lib/campaign-agent'
import { commercialUseRightsAttestation, type CommercialUseRightsAttestation } from '../lib/product-asset-client'
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
  imageDeleteBusy?: boolean
  generationBusy?: boolean
  agentState: CampaignAgentState
  agentBusy: boolean
  generationAvailable: boolean
  briefFileBusy?: boolean
  briefFileNotice?: string
  onBrandChange: (next: BrandPack) => void
  onProductChange: (next: Product) => void
  onIntentChange: (next: string) => void
  onBriefFileImport?: (file: File) => void
  onBriefFileExport?: () => void
  onImageSelected: (file: File, rightsAttestation: CommercialUseRightsAttestation) => void
  onImageDelete: () => void
  onPlan: () => void
  onApprove: () => void
  onGenerate: () => void
}

export type { ImageState }

export function CampaignWorkspace(props: Props) {
  const { brand, product, intent, image, imageDeleteBusy = false, generationBusy = false, agentState, agentBusy, generationAvailable, briefFileBusy = false, briefFileNotice = '', onBrandChange, onProductChange, onIntentChange, onBriefFileImport, onBriefFileExport, onImageSelected, onImageDelete, onPlan, onApprove, onGenerate } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const briefFileRef = useRef<HTMLInputElement>(null)
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const englishReady = Boolean(
    product.nameEn
    && product.promotionEn
    && product.benefitsEn.filter(Boolean).length >= 2
    && brand.ctaEn
  )
  const factsReady = Boolean(
    brand.name
    && product.name
    && product.category
    && product.price
    && product.promotion
    && product.benefits.filter(Boolean).length >= 2
    && englishReady
  )
  const imageReady = image.status === 'demo'
    || (image.status === 'ready' && image.asset?.rightsStatus === 'confirmed')
  const campaignIdentityBusy = agentBusy || generationBusy || briefFileBusy
  const imageMutationBusy = image.status === 'uploading' || imageDeleteBusy || campaignIdentityBusy
  const imageSelectionDisabled = imageMutationBusy || !rightsConfirmed
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
    if (imageSelectionDisabled) {
      event.target.value = ''
      return
    }
    const file = event.target.files?.[0]
    if (file) {
      onImageSelected(file, commercialUseRightsAttestation)
      setRightsConfirmed(false)
    }
    event.target.value = ''
  }

  function chooseBriefFile(event: ChangeEvent<HTMLInputElement>) {
    if (campaignIdentityBusy) {
      event.target.value = ''
      return
    }
    const file = event.target.files?.[0]
    if (file) onBriefFileImport?.(file)
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
      <section className="brief-panel" aria-labelledby="brief-title" aria-busy={campaignIdentityBusy}>
        <div className="panel-heading"><h2 id="brief-title">品牌與商品資料</h2><p>只使用已核實、可以公開宣傳的資料。</p></div>
        {onBriefFileImport && onBriefFileExport ? <div className="brief-file-tools" aria-label="Campaign Brief 檔案">
          <div><strong>Campaign Brief 檔案</strong><small>JSON v1 · 本機匯入／匯出，不含圖片或工作區識別</small></div>
          <div className="brief-file-actions">
            <button type="button" className="outline-button" aria-label="匯入 Campaign Brief JSON" onClick={() => briefFileRef.current?.click()} disabled={campaignIdentityBusy}>{briefFileBusy ? <LoaderCircle className="spin" size={15} /> : <FileUp size={15} />}{briefFileBusy ? '匯入中…' : '匯入 JSON'}</button>
            <button type="button" className="outline-button" aria-label="匯出 Campaign Brief JSON" onClick={onBriefFileExport} disabled={campaignIdentityBusy}><Download size={15} />匯出 JSON</button>
            <input ref={briefFileRef} className="visually-hidden" type="file" accept=".json,application/json,text/json" onChange={chooseBriefFile} disabled={campaignIdentityBusy} />
          </div>
          {briefFileNotice ? <p className="brief-file-notice" role="status">{briefFileNotice}</p> : null}
        </div> : null}
        <fieldset className="compact-fields" disabled={campaignIdentityBusy}>
          <label><span>品牌名稱</span><input value={brand.name} maxLength={campaignBriefLimits.brand.name} onChange={(event) => setBrand('name', event.target.value)} /></label>
          <label><span>商品名稱</span><input value={product.name} maxLength={campaignBriefLimits.product.name} onChange={(event) => setProduct('name', event.target.value)} /></label>
          <label><span>商品類別</span><input value={product.category} maxLength={campaignBriefLimits.product.category} onChange={(event) => setProduct('category', event.target.value)} /></label>
          <div className="field-row"><label><span>價格（HKD）</span><input value={product.price} maxLength={campaignBriefLimits.product.price} onChange={(event) => setProduct('price', event.target.value)} /></label><label><span>推廣目的</span><select value={intent} onChange={(event) => onIntentChange(event.target.value)}><option>限時優惠</option><option>新品推廣</option><option>日常銷售</option><option>節日活動</option></select></label></div>
          <label><span>促銷資訊</span><input value={product.promotion} maxLength={campaignBriefLimits.product.promotion} onChange={(event) => setProduct('promotion', event.target.value)} /></label>
          <fieldset className="selling-points"><legend>產品賣點（最多 3 點）</legend>{[0, 1, 2].map((index) => <label key={index}><b>{index + 1}</b><input value={product.benefits[index] || ''} maxLength={campaignBriefLimits.product.benefits.itemLength} onChange={(event) => updateBenefit(index, event.target.value)} placeholder={`賣點 ${index + 1}`} />{product.benefits[index] ? <X size={13} /> : <Plus size={13} />}</label>)}</fieldset>
          <label><span>商品規格（選填）</span><textarea value={product.specifications} maxLength={campaignBriefLimits.product.specifications} onChange={(event) => setProduct('specifications', event.target.value)} placeholder="例如：尺寸、物料、連接方式或相容型號" /></label>
          <label><span>品牌語氣</span><input value={brand.tone} maxLength={campaignBriefLimits.brand.tone} onChange={(event) => setBrand('tone', event.target.value)} /></label>
          <label><span>行動呼籲 CTA</span><input value={brand.cta} maxLength={campaignBriefLimits.brand.cta} onChange={(event) => setBrand('cta', event.target.value)} /></label>
          <details className="bilingual-fields">
            <summary>{englishReady ? '英文文案資料已填寫' : '填寫英文文案資料'} <small>English copy</small></summary>
            <div>
              <label><span>Product name</span><input lang="en" value={product.nameEn} maxLength={campaignBriefLimits.product.nameEn} onChange={(event) => setProduct('nameEn', event.target.value)} /></label>
              <label><span>Promotion</span><input lang="en" value={product.promotionEn} maxLength={campaignBriefLimits.product.promotionEn} onChange={(event) => setProduct('promotionEn', event.target.value)} /></label>
              <fieldset className="selling-points"><legend>Product benefits (up to 3)</legend>{[0, 1, 2].map((index) => <label key={index}><b>{index + 1}</b><input lang="en" value={product.benefitsEn[index] || ''} maxLength={campaignBriefLimits.product.benefitsEn.itemLength} onChange={(event) => updateBenefitEn(index, event.target.value)} placeholder={`Benefit ${index + 1}`} />{product.benefitsEn[index] ? <X size={13} /> : <Plus size={13} />}</label>)}</fieldset>
              <label><span>Call to action</span><input lang="en" value={brand.ctaEn} maxLength={campaignBriefLimits.brand.ctaEn} onChange={(event) => setBrand('ctaEn', event.target.value)} /></label>
            </div>
          </details>
        </fieldset>
        <div className={`facts-status ${factsReady ? 'ready' : ''}`}><ShieldCheck size={17} /><span><strong>{factsReady ? '資料已就緒' : '仍需補充資料'}</strong><small>{factsReady ? '所有必填欄位已完成' : 'Agent 會指出仍欠缺的項目'}</small></span></div>
      </section>

      <section className="product-panel" aria-labelledby="product-image-title" aria-busy={imageDeleteBusy || campaignIdentityBusy}>
        <div className="panel-heading split"><div><h2 id="product-image-title">商品圖片</h2><p>建議正面 1:1、解析度 2000px 以上。</p></div>{image.status === 'ready' ? <span className="private-label"><ShieldCheck size={13} />私人保存</span> : null}</div>
        <div className={`product-canvas${image.url ? '' : ' empty'}`}>{image.url
          ? <img src={image.url} alt={`${product.name || '商品'} 商品原圖`} />
          : <div><ImagePlus size={28} /><strong>加入商品原圖</strong><span>圖片只會透過已授權的工作區路徑顯示</span></div>}
        </div>
        <label className="product-rights-confirmation">
          <input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} disabled={imageMutationBusy} />
          <span><strong>我確認擁有或已取得必要權利，可將此圖片用於預計的商業素材。</strong><small>I have the necessary rights to use this image in the intended commercial assets.</small></span>
        </label>
        <button className="upload-zone" type="button" onClick={() => inputRef.current?.click()} disabled={imageSelectionDisabled}>
          {image.status === 'uploading' || imageDeleteBusy || campaignIdentityBusy ? <LoaderCircle className="spin" size={20} /> : <UploadCloud size={20} />}
          <span><strong>{image.status === 'uploading' ? '正在檢查並安全上載… · Checking and uploading securely…' : imageDeleteBusy ? '正在安全刪除… Deleting securely…' : generationBusy ? '素材包建立中… Pack creation in progress…' : agentBusy ? 'Agent 正在處理… Agent action in progress…' : !rightsConfirmed ? '先確認圖片使用權 · Confirm image rights' : '更換商品圖片'}</strong><small>JPG、PNG、靜態 WebP；先在本機預檢 · Local preflight first；最大 4 MB／8192 px／32 MP</small></span>
        </button>
        <input ref={inputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} disabled={imageSelectionDisabled} />
        <div className={`asset-row ${image.status}`}><FileImage size={17} /><span><strong>{image.name}</strong><small>{imageDeleteBusy ? '正在刪除這張私人商品圖片 · Deleting this private product image' : generationBusy ? '商品圖片已鎖定至正在建立的素材包 · Product image locked to the Campaign Pack in progress' : agentBusy ? '商品圖片已鎖定至 Agent 動作 · Product image locked to the Agent action' : image.status === 'ready' ? image.asset?.rightsStatus === 'confirmed' ? '已私人保存 · 商業使用權已確認' : '已私人保存 · 使用權未確認' : image.status === 'error' ? image.error : image.status === 'uploading' ? '正在處理檔案' : '本機示範素材'}</small></span><div className="asset-actions"><button type="button" onClick={() => inputRef.current?.click()} aria-label="更換圖片" disabled={imageSelectionDisabled}><ImagePlus size={16} /></button>{image.url ? <button type="button" onClick={onImageDelete} aria-label={imageDeleteBusy ? '正在刪除圖片 · Deleting image' : '刪除圖片'} disabled={imageMutationBusy}><Trash2 size={15} /></button> : null}</div></div>
      </section>

      <CampaignAgentPanel state={agentState} busy={agentBusy} generationBusy={generationBusy} generationAvailable={generationAvailable} onPlan={onPlan} onApprove={onApprove} onGenerate={onGenerate} />
    </div>
  </>
}
