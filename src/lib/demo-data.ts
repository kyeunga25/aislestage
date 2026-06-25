import type { BrandPack, Product, GenerationResult } from './types'

export const starterBrand: BrandPack = {
  name: 'HK Tech Gear',
  tone: '專業、直接、懂行',
  colors: ['#111827', '#155eef', '#f97066'],
  forbiddenWords: '最平、無敵、保證升值',
  locale: 'zh-Hant',
  cta: '立即選購，升級你的電競裝備'
}

export const starterProduct: Product = {
  name: 'DIY 遊戲電腦組裝服務',
  category: '電腦硬件／DIY 電腦',
  benefits: ['度身配置', '專人裝機測試', '香港本地保養'],
  specifications: 'Intel / AMD 平台可選 · RTX 顯示卡 · DDR5 記憶體 · 專業理線',
  price: '由 HK$6,999 起',
  promotion: '免費升級 RGB 機箱風扇',
  channels: ['Shopify', 'Facebook', 'Instagram']
}

export const demoResults: GenerationResult[] = [
  { id: 'result-1', workflowId: 'store-main', status: 'completed', title: '商店主圖 · 1:1', imageUrl: 'https://images.unsplash.com/photo-1587202372775-e229f172b9d7?auto=format&fit=crop&w=1100&q=85' },
  { id: 'result-2', workflowId: 'meta-ad', status: 'completed', title: 'Meta 廣告 · 4:5', imageUrl: 'https://images.unsplash.com/photo-1593640408182-31c70c8268f5?auto=format&fit=crop&w=900&q=85' }
]
