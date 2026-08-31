import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceActivityView } from '../src/components/WorkspaceActivityView'
import type { WorkspaceActivityEvent } from '../src/lib/types'

const activity: WorkspaceActivityEvent[] = [
  {
    id: '0123456789abcdef0123456789abcdef',
    type: 'product_asset_uploaded',
    actorName: 'Synthetic Owner',
    createdAt: '2026-08-30T05:00:00Z'
  },
  {
    id: 'abcdef0123456789abcdef0123456789',
    type: 'generation_approved',
    actorName: null,
    createdAt: '2026-08-30T05:05:00Z'
  }
]

describe('workspace activity management view', () => {
  it('renders bilingual operation labels, privacy guidance, known actors, and refresh state', () => {
    const markup = renderToStaticMarkup(<WorkspaceActivityView
      activity={activity}
      isRefreshing
      notice=""
      onRefresh={vi.fn()}
      onBack={vi.fn()}
    />)

    expect(markup).toContain('工作區活動')
    expect(markup).toContain('Workspace activity')
    expect(markup).toContain('商品來源圖已上載')
    expect(markup).toContain('Product source uploaded')
    expect(markup).toContain('輸出已核准')
    expect(markup).toContain('Output approved')
    expect(markup).toContain('Synthetic Owner')
    expect(markup).toContain('系統記錄 · System record')
    expect(markup).toContain('不記錄圖片、檔案名稱或 Campaign Brief 內容')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('正在重新載入活動 · Reloading activity')
    expect(markup).toContain('disabled=""')
  })

  it('keeps a prior trusted timeline visible when refresh is unavailable', () => {
    const markup = renderToStaticMarkup(<WorkspaceActivityView
      activity={activity}
      isRefreshing={false}
      notice="工作區活動暫時無法讀取。 Workspace activity is temporarily unavailable."
      onRefresh={vi.fn()}
      onBack={vi.fn()}
    />)

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Workspace activity is temporarily unavailable.')
    expect(markup).toContain('商品來源圖已上載')
    expect(markup).toContain('輸出已核准')
  })
})
