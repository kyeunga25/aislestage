import { ArrowLeft, Box, Check, Image as ImageIcon, Layers3, PackageCheck, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react'
import type { NavigationSection } from './Icon'
import type { BrandPack, GenerationResult, Product, ProductAssetListItem, SavedBrandPack } from '../lib/types'

type Props = {
  section: Exclude<NavigationSection, 'workspace' | 'usage' | 'activity'>
  brand: BrandPack
  product: Product
  results: GenerationResult[]
  imageUrl: string
  deletingResultId?: string | null
  isRefreshingResults?: boolean
  refreshDisabled?: boolean
  notice?: string
  onRefreshResults?: () => void
  productAssets?: ProductAssetListItem[]
  selectedProductAssetId?: string | null
  deletingProductAssetId?: string | null
  isRefreshingProductAssets?: boolean
  productAssetNotice?: string
  onRefreshProductAssets?: () => void
  onSelectProductAsset?: (asset: ProductAssetListItem) => void
  onDeleteProductAsset?: (asset: ProductAssetListItem) => void
  brandPacks?: SavedBrandPack[]
  selectedBrandPackId?: string | null
  deletingBrandPackId?: string | null
  isRefreshingBrandPacks?: boolean
  isSavingBrandPack?: boolean
  canSaveBrandPack?: boolean
  brandInteractionDisabled?: boolean
  brandPackNotice?: string
  onRefreshBrandPacks?: () => void
  onSaveBrandPack?: () => void
  onSelectBrandPack?: (brandPack: SavedBrandPack) => void
  onDeleteBrandPack?: (brandPack: SavedBrandPack) => void
  onBack: () => void
  onDeleteResult: (result: GenerationResult) => void
}

const sectionCopy = {
  campaigns: { icon: PackageCheck, title: 'Campaign Packs', description: '查看這個工作區已建立及正在處理的素材包。' },
  products: { icon: Box, title: '商品庫', description: '管理已核實的商品資料與私人來源圖片。' },
  brands: { icon: Layers3, title: '品牌庫', description: '維護品牌語氣、顏色、限制字詞與常用 CTA。' },
  assets: { icon: ImageIcon, title: '素材庫', description: '集中查看各個比例的私人生成素材。' }
} as const

const productAssetTime = new Intl.DateTimeFormat('zh-HK', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Hong_Kong'
})

const productAssetFormats: Record<ProductAssetListItem['contentType'], string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP'
}
const productAssetNumber = new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 1 })

function productAssetSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${productAssetNumber.format(bytes / 1024)} KB`
  return `${productAssetNumber.format(bytes / (1024 * 1024))} MB`
}

export function CollectionView({
  section,
  brand,
  product,
  results,
  imageUrl,
  deletingResultId = null,
  isRefreshingResults = false,
  refreshDisabled = false,
  notice = '',
  onRefreshResults,
  productAssets = [],
  selectedProductAssetId = null,
  deletingProductAssetId = null,
  isRefreshingProductAssets = false,
  productAssetNotice = '',
  onRefreshProductAssets,
  onSelectProductAsset,
  onDeleteProductAsset,
  brandPacks = [],
  selectedBrandPackId = null,
  deletingBrandPackId = null,
  isRefreshingBrandPacks = false,
  isSavingBrandPack = false,
  canSaveBrandPack = false,
  brandInteractionDisabled = false,
  brandPackNotice = '',
  onRefreshBrandPacks,
  onSaveBrandPack,
  onSelectBrandPack,
  onDeleteBrandPack,
  onBack,
  onDeleteResult
}: Props) {
  const meta = sectionCopy[section]
  const Icon = meta.icon
  const resultCollection = section === 'campaigns' || section === 'assets'
  const campaignPacks = Array.from(results.reduce((groups, item) => {
    const key = item.campaignPackId || `legacy-${item.id}`
    const group = groups.get(key) || []
    group.push(item)
    groups.set(key, group)
    return groups
  }, new Map<string, GenerationResult[]>()).entries())
  const collectionBusy = resultCollection
    ? isRefreshingResults
    : section === 'products'
      ? isRefreshingProductAssets
      : section === 'brands' ? isRefreshingBrandPacks || isSavingBrandPack : undefined
  return <section className="collection-view" aria-busy={collectionBusy}>
    <div className="collection-heading">
      <div className="collection-heading-main"><span><Icon size={21} /></span><div><h1>{meta.title}</h1><p>{meta.description}</p></div></div>
      <div className="collection-actions">
        {resultCollection && onRefreshResults ? <button className="outline-button" type="button" onClick={onRefreshResults} disabled={isRefreshingResults || refreshDisabled} aria-label={isRefreshingResults ? '正在重新載入私人輸出 · Reloading private outputs' : '重新載入私人輸出 · Refresh private outputs'}><RefreshCw className={isRefreshingResults ? 'spin' : undefined} size={16} />{isRefreshingResults ? '重新載入中…' : '重新載入'}</button> : null}
        {section === 'products' && onRefreshProductAssets ? <button className="outline-button" type="button" onClick={onRefreshProductAssets} disabled={isRefreshingProductAssets || deletingProductAssetId !== null} aria-label={isRefreshingProductAssets ? '正在重新載入私人商品來源圖 · Reloading private product sources' : '重新載入私人商品來源圖 · Refresh private product sources'}><RefreshCw className={isRefreshingProductAssets ? 'spin' : undefined} size={16} />{isRefreshingProductAssets ? '重新載入中…' : '重新載入'}</button> : null}
        {section === 'brands' && onSaveBrandPack ? <button className="primary-button" type="button" onClick={onSaveBrandPack} disabled={!canSaveBrandPack || brandInteractionDisabled || isSavingBrandPack || isRefreshingBrandPacks || deletingBrandPackId !== null} aria-label={isSavingBrandPack ? '正在儲存已核准品牌 · Saving approved brand' : '儲存已核准品牌 · Save approved brand'}><Save size={16} />{isSavingBrandPack ? '儲存中…' : '儲存已核准品牌'}</button> : null}
        {section === 'brands' && onRefreshBrandPacks ? <button className="outline-button" type="button" onClick={onRefreshBrandPacks} disabled={isRefreshingBrandPacks || isSavingBrandPack || deletingBrandPackId !== null} aria-label={isRefreshingBrandPacks ? '正在重新載入私人品牌快照 · Reloading private brand snapshots' : '重新載入私人品牌快照 · Refresh private brand snapshots'}><RefreshCw className={isRefreshingBrandPacks ? 'spin' : undefined} size={16} />{isRefreshingBrandPacks ? '重新載入中…' : '重新載入'}</button> : null}
        <button className="outline-button" type="button" onClick={onBack}><ArrowLeft size={16} />返回工作台</button>
      </div>
    </div>
    {notice ? <p className="workspace-notice collection-notice" role="alert">{notice}</p> : null}
    {section === 'campaigns' ? <div className="data-panel"><div className="data-head"><strong>最近素材包</strong><span>{campaignPacks.length} 套</span></div>{campaignPacks.length ? campaignPacks.map(([packId, items]) => {
      const failed = items.some((item) => item.status === 'failed')
      const completed = items.every((item) => item.status === 'completed')
      const rejected = completed && items.some((item) => item.reviewStatus === 'rejected')
      const approved = completed && items.every((item) => item.reviewStatus === 'approved')
      const status = failed ? 'failed' : rejected ? 'rejected' : approved ? 'completed' : completed ? 'review' : 'processing'
      const date = items[0]?.createdAt ? new Date(items[0].createdAt).toLocaleString('zh-HK') : '本機預覽'
      return <div className="data-row" key={packId}><span className="row-icon"><PackageCheck size={17} /></span><div><strong>Campaign Pack · {items.length} 個輸出</strong><small>{items.map((item) => item.aspectRatio).join(' · ')} · {date}</small></div><span className={`status-text ${status}`}>{status === 'completed' ? '已核准' : status === 'review' ? '待審核' : status === 'rejected' ? '需要修改' : status === 'failed' ? '部分失敗' : '處理中'}</span></div>
    }) : <div className="empty-library"><PackageCheck size={24} /><strong>尚未建立 Campaign Pack</strong><p>先在工作台由 Agent 規劃第一套素材。</p></div>}</div> : null}
    {section === 'products' ? <>
      {product.name && imageUrl ? <div className="library-grid"><article className="library-card media-card"><img src={imageUrl} alt={product.name} /><div><span>{product.category}</span><h2>{product.name}</h2><p>{product.benefits.filter(Boolean).join(' · ')}</p><strong>{product.price}</strong></div></article><article className="library-note"><h2>已核實商品快照</h2><p>Agent 計劃保存的商品資料會在此顯示；選用另一張來源圖後必須重新規劃及批准。</p></article></div> : <div className="empty-library compact"><Box size={24} /><strong>尚未保存商品資料</strong><p>可先從下方選用已保存來源圖，再回工作台完成商業資料。</p></div>}
      <section className="product-source-library" aria-labelledby="product-source-library-title">
        <div className="data-head"><div><strong id="product-source-library-title">已保存來源圖</strong><small>Private source images · 只經授權 Worker route 顯示</small></div><span>{productAssets.length} 張</span></div>
        <p className="product-source-privacy"><ShieldCheck size={17} /><span>原始本機檔名及儲存位置不會顯示；重用圖片仍會令舊 Agent 批准失效。</span></p>
        {productAssetNotice ? <p className="workspace-notice collection-notice" role="alert">{productAssetNotice}</p> : null}
        {productAssets.length ? <div className="product-source-grid">{productAssets.map((asset, index) => {
          const itemNumber = index + 1
          const selected = asset.id === selectedProductAssetId
          const deleting = asset.id === deletingProductAssetId
          const controlsLocked = deletingProductAssetId !== null || isRefreshingProductAssets
          return <article className={`product-source-card ${selected ? 'selected' : ''}`} aria-busy={deleting} key={asset.id}>
            <div className="product-source-preview"><img src={asset.previewUrl} alt={`私人商品來源圖 ${itemNumber}`} loading="lazy" />{selected ? <span><Check size={13} />使用中</span> : null}</div>
            <div className="product-source-meta"><strong>{productAssetFormats[asset.contentType]}</strong><small>{productAssetSize(asset.sizeBytes)} · {productAssetTime.format(new Date(asset.createdAt))}</small></div>
            <div className="product-source-actions">
              {onSelectProductAsset ? <button type="button" onClick={() => onSelectProductAsset(asset)} disabled={selected || controlsLocked} aria-label={selected ? `目前使用第 ${itemNumber} 張私人商品圖` : `使用第 ${itemNumber} 張私人商品圖`}>{selected ? '目前使用' : '使用此圖片'}</button> : null}
              {onDeleteProductAsset ? <button className="danger" type="button" onClick={() => onDeleteProductAsset(asset)} disabled={controlsLocked} aria-label={deleting ? `正在刪除第 ${itemNumber} 張私人商品圖 · Deleting private product source ${itemNumber}` : `刪除第 ${itemNumber} 張私人商品圖`}><Trash2 size={14} />{deleting ? '刪除中…' : '刪除'}</button> : null}
            </div>
          </article>
        })}</div> : <div className="empty-library compact"><ImageIcon size={24} /><strong>{isRefreshingProductAssets ? '正在載入來源圖…' : '尚未保存來源圖'}</strong><p>{isRefreshingProductAssets ? 'Loading private product sources…' : '回工作台上載第一張已獲授權的 PNG、JPEG 或靜態 WebP。'}</p></div>}
      </section>
    </> : null}
    {section === 'brands' ? <>
      {brand.name ? <div className="library-grid"><article className="library-card"><span>目前工作品牌</span><h2>{brand.name}</h2><dl><div><dt>品牌語氣</dt><dd>{brand.tone}</dd></div><div><dt>繁中 CTA</dt><dd>{brand.cta}</dd></div><div><dt>English CTA</dt><dd>{brand.ctaEn}</dd></div><div><dt>限制字詞</dt><dd>{brand.forbiddenWords || '未設定'}</dd></div></dl><div className="color-row">{brand.colors.map((color) => <i style={{ background: color }} title={color} key={color} />)}</div></article><article className="library-note"><h2>{canSaveBrandPack ? '已可保存核准快照' : '先完成 Agent 批准'}</h2><p>{canSaveBrandPack ? '只保存目前已核准 revision 的品牌欄位；相同內容會安全重用同一快照。' : '品牌資料須先連同商品及來源圖完成規劃與批准，才可寫入工作區品牌庫。'}</p></article></div> : <div className="empty-library compact"><Layers3 size={24} /><strong>尚未準備品牌資料</strong><p>回工作台填寫雙語品牌資料並完成 Agent 規劃。</p></div>}
      <section className="brand-pack-library" aria-labelledby="brand-pack-library-title">
        <div className="data-head"><div><strong id="brand-pack-library-title">已保存品牌快照</strong><small>Approved brand snapshots · 只保存已核准的確定性品牌欄位</small></div><span>{brandPacks.length} 個</span></div>
        <p className="brand-pack-privacy"><ShieldCheck size={17} /><span>選用快照只會帶回品牌欄位；現有 Agent 批准會失效，必須配合目前商品重新規劃。</span></p>
        {brandPackNotice ? <p className="workspace-notice collection-notice" role="alert">{brandPackNotice}</p> : null}
        {brandPacks.length ? <div className="brand-pack-grid">{brandPacks.map((savedBrand, index) => {
          const itemNumber = index + 1
          const selected = savedBrand.id === selectedBrandPackId
          const deleting = savedBrand.id === deletingBrandPackId
          const controlsLocked = brandInteractionDisabled || deletingBrandPackId !== null || isRefreshingBrandPacks || isSavingBrandPack
          return <article className={`brand-pack-card ${selected ? 'selected' : ''}`} aria-busy={deleting} key={savedBrand.id}>
            <div className="brand-pack-card-head"><span>Revision {savedBrand.approvedRevision}</span>{selected ? <strong><Check size={13} />使用中</strong> : null}</div>
            <h2>{savedBrand.name}</h2>
            <p>{savedBrand.tone || '未設定品牌語氣'}</p>
            <dl><div><dt>CTA</dt><dd>{savedBrand.cta}</dd></div><div><dt>English</dt><dd>{savedBrand.ctaEn}</dd></div></dl>
            <div className="color-row">{savedBrand.colors.map((color) => <i style={{ background: color }} title={color} key={color} />)}</div>
            <small>{productAssetTime.format(new Date(savedBrand.createdAt))}</small>
            <div className="brand-pack-actions">
              {onSelectBrandPack ? <button type="button" onClick={() => onSelectBrandPack(savedBrand)} disabled={selected || controlsLocked} aria-label={selected ? `目前使用第 ${itemNumber} 個品牌快照` : `使用第 ${itemNumber} 個品牌快照`}>{selected ? '目前使用' : '使用此品牌'}</button> : null}
              {onDeleteBrandPack ? <button className="danger" type="button" onClick={() => onDeleteBrandPack(savedBrand)} disabled={controlsLocked} aria-label={deleting ? `正在刪除第 ${itemNumber} 個品牌快照 · Deleting brand snapshot ${itemNumber}` : `刪除第 ${itemNumber} 個品牌快照`}><Trash2 size={14} />{deleting ? '刪除中…' : '刪除'}</button> : null}
            </div>
          </article>
        })}</div> : <div className="empty-library compact"><Layers3 size={24} /><strong>{isRefreshingBrandPacks ? '正在載入品牌快照…' : '尚未保存品牌快照'}</strong><p>{isRefreshingBrandPacks ? 'Loading approved brand snapshots…' : '批准目前 Campaign 計劃後，可在此保存第一個可重用品牌快照。'}</p></div>}
      </section>
    </> : null}
    {section === 'assets' ? <div className="asset-library">{results.filter((item) => item.imageUrl).length ? results.filter((item) => item.imageUrl).map((item) => {
      const deleting = deletingResultId === item.id
      return <article key={item.id} aria-busy={deleting}><img src={item.imageUrl!} alt={item.title} /><div><strong>{item.aspectRatio}</strong><span>{item.title}</span><button type="button" onClick={() => onDeleteResult(item)} aria-label={deleting ? `正在刪除 ${item.title} · Deleting ${item.title}` : `刪除 ${item.title}`} disabled={deletingResultId !== null}><Trash2 size={15} />{deleting ? <>刪除中…<span className="visually-hidden"> Deleting…</span></> : '刪除'}</button></div></article>
    }) : <div className="empty-library"><ImageIcon size={24} /><strong>尚未有已生成素材</strong><p>版面預覽不會當作正式素材保存。</p></div>}</div> : null}
  </section>
}
