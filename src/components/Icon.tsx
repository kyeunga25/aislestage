import { Box, Image, LayoutDashboard, Layers3, MonitorCog, PanelTop, RectangleHorizontal, Square, type LucideProps } from 'lucide-react'
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
  { label: '工作台', icon: LayoutDashboard },
  { label: '品牌包', icon: Layers3 },
  { label: '產品庫', icon: Box },
  { label: '圖庫', icon: Image }
]
