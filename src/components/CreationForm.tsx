import { ImagePlus, Plus, UploadCloud, X } from 'lucide-react'
import type { BrandPack, Product } from '../lib/types'

type Props = {
  brand: BrandPack
  product: Product
  onBrandChange: (next: BrandPack) => void
  onProductChange: (next: Product) => void
}

export function CreationForm({ brand, product, onBrandChange, onProductChange }: Props) {
  const setProduct = (key: keyof Product, value: string) => onProductChange({ ...product, [key]: value })
  const setBrand = (key: keyof BrandPack, value: string) => onBrandChange({ ...brand, [key]: value })

  return <section className="form-panel" aria-labelledby="product-info-title">
    <div className="section-heading"><h2 id="product-info-title">品牌與產品資料</h2><p>這些內容會控制視覺語氣、文字與素材保真度。</p></div>
    <label>品牌名稱<input value={brand.name} onChange={(event) => setBrand('name', event.target.value)} /></label>
    <label>產品名稱<input value={product.name} onChange={(event) => setProduct('name', event.target.value)} /></label>
    <label>產品類別<select value={product.category} onChange={(event) => setProduct('category', event.target.value)}><option>電腦硬件／DIY 電腦</option><option>美妝／保健</option><option>生活消費品</option><option>服飾／配件</option></select></label>
    <label>產品賣點<div className="tag-field">{product.benefits.map((item) => <span key={item}>{item}<X size={12} /></span>)}<button type="button" aria-label="新增賣點"><Plus size={14} /></button></div></label>
    <label>規格或重點<textarea rows={3} value={product.specifications} onChange={(event) => setProduct('specifications', event.target.value)} /></label>
    <div className="form-row"><label>價格<input value={product.price} onChange={(event) => setProduct('price', event.target.value)} /></label><label>促銷資訊<input value={product.promotion} onChange={(event) => setProduct('promotion', event.target.value)} /></label></div>
    <label>品牌語氣<input value={brand.tone} onChange={(event) => setBrand('tone', event.target.value)} /></label>
    <label>常用 CTA<input value={brand.cta} onChange={(event) => setBrand('cta', event.target.value)} /></label>
  </section>
}

export function ReferenceUploader() {
  return <section className="reference-panel" aria-labelledby="reference-title">
    <div className="section-heading"><h2 id="reference-title">上傳參考圖片</h2><p>上傳乾淨商品照，讓 AI 保留產品結構、材質與品牌細節。</p></div>
    <div className="product-placeholder">
      <ImagePlus size={44} strokeWidth={1.4} />
      <span>你的產品參考圖</span>
      <small>JPG、PNG · 最多 5 張 · 建議 2000px 以上</small>
    </div>
    <button className="upload-dropzone" type="button"><UploadCloud size={21} /><strong>拖曳圖片到這裡</strong><span>或從裝置選取檔案</span></button>
  </section>
}
