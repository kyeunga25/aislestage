import type { BrandPack, Product, GenerationResult } from './types'

export const starterBrand: BrandPack = {
  name: 'Example Brand',
  tone: '簡潔、有活力、可信',
  colors: ['#0b1933', '#155eef', '#1fb981'],
  forbiddenWords: '最平、無敵、保證升值',
  locale: 'zh-Hant',
  cta: '立即選購'
}

export const starterProduct: Product = {
  name: 'MiniBeat 藍牙喇叭',
  category: '消費電子',
  benefits: ['輕巧隨行', '12 小時播放', '清晰立體聲'],
  specifications: 'Bluetooth 5.3 · USB-C 充電 · IPX5 防水',
  price: 'HK$399',
  promotion: '限時免運費',
  channels: ['Shopify', 'Facebook', 'Instagram']
}

export const demoResults: GenerationResult[] = [
  { id: 'result-1', workflowId: 'promo-poster', aspectRatio: '1:1', status: 'completed', title: '商品主圖 · 1:1', imageUrl: null },
  { id: 'result-2', workflowId: 'promo-poster', aspectRatio: '4:5', status: 'completed', title: '社交廣告 · 4:5', imageUrl: null },
  { id: 'result-3', workflowId: 'promo-poster', aspectRatio: '9:16', status: 'completed', title: '限時動態 · 9:16', imageUrl: null }
]
