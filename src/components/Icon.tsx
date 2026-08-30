import { Box, Gauge, History, Images, LayoutDashboard, Layers3, MonitorCog, PackageCheck, PanelTop, RectangleHorizontal, ShieldCheck, Square, type LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import type { Workflow } from '../lib/types'

const workflowIcons: Record<Workflow['icon'], ComponentType<LucideProps>> = {
  square: Square,
  panel: PanelTop,
  poster: RectangleHorizontal,
  ad: MonitorCog,
  box: Box
}

export function WorkflowIcon({ name, ...props }: { name: Workflow['icon'] } & LucideProps) {
  const Icon = workflowIcons[name]
  return <Icon {...props} />
}

export const navItems = [
  { id: 'workspace', label: '工作台', icon: LayoutDashboard },
  { id: 'campaigns', label: 'Campaign Packs', icon: PackageCheck },
  { id: 'products', label: '商品庫', icon: Box },
  { id: 'brands', label: '品牌庫', icon: Layers3 },
  { id: 'assets', label: '素材庫', icon: Images },
  { id: 'usage', label: '用量', icon: Gauge },
  { id: 'activity', label: '活動記錄', icon: History },
  { id: 'access', label: '存取管理', icon: ShieldCheck }
] as const

export type NavigationSection = typeof navItems[number]['id']
