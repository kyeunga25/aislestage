import type { Workflow } from './types'

export const workflows: Workflow[] = [
  { id: 'store-main', icon: 'square', title: '商店主圖', titleEn: 'Store main image', description: '白底或品牌場景的商品主視覺', defaultRatio: '1:1', ratios: ['1:1', '4:5'] },
  { id: 'detail-banner', icon: 'panel', title: '詳情頁橫幅', titleEn: 'Detail page banner', description: '突出規格與關鍵賣點的橫幅', defaultRatio: '16:5', ratios: ['16:5', '1:1'] },
  { id: 'promo-poster', icon: 'poster', title: '活動海報', titleEn: 'Promotion poster', description: '檔期、上新與限時優惠素材', defaultRatio: '4:5', ratios: ['4:5', '9:16', '1:1'] },
  { id: 'meta-ad', icon: 'ad', title: 'Meta 圖文廣告', titleEn: 'Meta ad creative', description: 'Facebook 與 Instagram 廣告視覺', defaultRatio: '4:5', ratios: ['1:1', '4:5', '9:16'] },
  { id: 'package-showcase', icon: 'box', title: '包裝展示圖', titleEn: 'Package showcase', description: '呈現包裝質感與送禮情境', defaultRatio: '1:1', ratios: ['1:1', '4:5'] }
]

export const workflowById = (id: string) => workflows.find((workflow) => workflow.id === id) ?? workflows[0]
