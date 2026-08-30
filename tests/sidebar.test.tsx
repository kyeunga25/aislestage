import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../src/components/Sidebar'
import type { WorkspaceSummary } from '../src/lib/types'

const workspace = (role: WorkspaceSummary['role']): WorkspaceSummary => ({
  id: `workspace-${role}`,
  name: 'Synthetic Workspace',
  role,
  accessStatus: 'active',
  availableOutputs: 3,
  reservedOutputs: 0
})

describe('workspace sidebar role and mobile accessibility', () => {
  it('keeps every icon-only mobile navigation control labelled for managers', () => {
    const markup = renderToStaticMarkup(<Sidebar workspace={workspace('owner')} active="activity" onNavigate={vi.fn()} />)

    expect(markup).toContain('aria-label="工作台"')
    expect(markup).toContain('aria-label="Campaign Packs"')
    expect(markup).toContain('aria-label="商品庫"')
    expect(markup).toContain('aria-label="品牌庫"')
    expect(markup).toContain('aria-label="素材庫"')
    expect(markup).toContain('aria-label="用量"')
    expect(markup).toContain('aria-label="活動記錄"')
    expect(markup).toContain('aria-label="存取管理"')
    expect(markup).toContain('aria-current="page"')
  })

  it('does not expose the manager activity navigation to ordinary members', () => {
    const markup = renderToStaticMarkup(<Sidebar workspace={workspace('member')} active="workspace" onNavigate={vi.fn()} />)

    expect(markup).not.toContain('aria-label="活動記錄"')
    expect(markup).not.toContain('>活動記錄<')
    expect(markup).not.toContain('aria-label="存取管理"')
    expect(markup).not.toContain('>存取管理<')
    expect(markup).toContain('aria-label="用量"')
  })
})
