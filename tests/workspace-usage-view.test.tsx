import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceUsageView } from '../src/components/WorkspaceUsageView'
import type { OutputUsageSnapshot } from '../src/lib/types'

const usage: OutputUsageSnapshot = {
  allowance: {
    availableOutputs: 6,
    reservedOutputs: 1,
    updatedAt: '2026-08-30T05:10:00Z'
  },
  summary: {
    completedOutputs: 4,
    releasedOutputs: 1
  },
  events: [{
    type: 'release',
    amount: 1,
    createdAt: '2026-08-30T05:06:00Z'
  }, {
    type: 'settlement',
    amount: 0,
    createdAt: '2026-08-30T05:05:00Z'
  }, {
    type: 'reservation',
    amount: -1,
    createdAt: '2026-08-30T05:00:00Z'
  }]
}

describe('workspace output usage management view', () => {
  it('renders allowance, completed and returned totals, event meanings, and disabled billing guidance', () => {
    const markup = renderToStaticMarkup(<WorkspaceUsageView
      usage={usage}
      isRefreshing
      notice=""
      onRefresh={vi.fn()}
      onBack={vi.fn()}
    />)

    expect(markup).toContain('工作區用量')
    expect(markup).toContain('Workspace usage')
    expect(markup).toContain('可用輸出')
    expect(markup).toContain('預留中')
    expect(markup).toContain('已完成')
    expect(markup).toContain('已退回')
    expect(markup).toContain('輸出已預留')
    expect(markup).toContain('Output reserved')
    expect(markup).toContain('生成已完成')
    expect(markup).toContain('Output completed')
    expect(markup).toContain('可用輸出已退回')
    expect(markup).toContain('Output returned')
    expect(markup).toContain('付款與訂閱未啟用')
    expect(markup).toContain('技術用量，不是付款帳單')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('正在重新載入用量 · Reloading usage')
    expect(markup).toContain('disabled=""')
  })

  it('keeps prior trusted usage visible when refresh is unavailable', () => {
    const markup = renderToStaticMarkup(<WorkspaceUsageView
      usage={usage}
      isRefreshing={false}
      notice="工作區用量暫時無法讀取。 Workspace usage is temporarily unavailable."
      onRefresh={vi.fn()}
      onBack={vi.fn()}
    />)

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Workspace usage is temporarily unavailable.')
    expect(markup).toContain('輸出已預留')
    expect(markup).toContain('可用輸出已退回')
  })
})
