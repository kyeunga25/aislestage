import { ArrowLeft, Box, Image as ImageIcon, Layers3, PackageCheck } from 'lucide-react'
import type { NavigationSection } from './Icon'
import type { BrandPack, GenerationResult, Product } from '../lib/types'

type Props = {
  section: Exclude<NavigationSection, 'workspace'>
  brand: BrandPack
  product: Product
  results: GenerationResult[]
  imageUrl: string
  onBack: () => void
}

const sectionCopy = {
  campaigns: { icon: PackageCheck, title: 'Campaign Packs', description: '查看這個工作區已建立及正在處理的素材包。' },
  products: { icon: Box, title: '商品庫', description: '管理已核實的商品資料與私人來源圖片。' },
  brands: { icon: Layers3, title: '品牌庫', description: '維護品牌語氣、顏色、限制字詞與常用 CTA。' },
  assets: { icon: ImageIcon, title: '素材庫', description: '集中查看各個比例的私人生成素材。' }
} as const

export function CollectionView({ section, brand, product, results, imageUrl, onBack }: Props) {
  const meta = sectionCopy[section]
  const Icon = meta.icon
  return <section className="collection-view">
    <div className="collection-heading"><div><span><Icon size={21} /></span><div><h1>{meta.title}</h1><p>{meta.description}</p></div></div><button className="outline-button" type="button" onClick={onBack}><ArrowLeft size={16} />返回工作台</button></div>
    {section === 'campaigns' ? <div className="data-panel"><div className="data-head"><strong>最近素材</strong><span>{results.length} 個輸出</span></div>{results.length ? results.map((item) => <div className="data-row" key={item.id}><span className="row-icon"><PackageCheck size={17} /></span><div><strong>{item.title}</strong><small>{item.createdAt ? new Date(item.createdAt).toLocaleString('zh-HK') : '本機預覽'}</small></div><span className={`status-text ${item.status}`}>{item.status}</span></div>) : <div className="empty-library"><PackageCheck size={24} /><strong>尚未建立 Campaign Pack</strong><p>先在工作台由 Agent 規劃第一套素材。</p></div>}</div> : null}
    {section === 'products' ? <div className="library-grid"><article className="library-card media-card"><img src={imageUrl} alt={product.name} /><div><span>{product.category}</span><h2>{product.name}</h2><p>{product.benefits.filter(Boolean).join(' · ')}</p><strong>{product.price}</strong></div></article><article className="library-note"><h2>私人來源圖</h2><p>商品原圖只透過授權路徑顯示；Agent 與生成流程只引用工作區內的 asset ID。</p></article></div> : null}
    {section === 'brands' ? <div className="library-grid"><article className="library-card"><span>主要品牌</span><h2>{brand.name}</h2><dl><div><dt>品牌語氣</dt><dd>{brand.tone}</dd></div><div><dt>常用 CTA</dt><dd>{brand.cta}</dd></div><div><dt>限制字詞</dt><dd>{brand.forbiddenWords || '未設定'}</dd></div></dl><div className="color-row">{brand.colors.map((color) => <i style={{ background: color }} title={color} key={color} />)}</div></article><article className="library-note"><h2>確定性文字</h2><p>價格、優惠、CTA 及必要聲明保持為可審核資料，不交由圖片模型自由生成。</p></article></div> : null}
    {section === 'assets' ? <div className="asset-library">{results.filter((item) => item.imageUrl).length ? results.filter((item) => item.imageUrl).map((item) => <article key={item.id}><img src={item.imageUrl!} alt={item.title} /><div><strong>{item.aspectRatio}</strong><span>{item.title}</span></div></article>) : <div className="empty-library"><ImageIcon size={24} /><strong>尚未有已生成素材</strong><p>版面預覽不會當作正式素材保存。</p></div>}</div> : null}
  </section>
}
