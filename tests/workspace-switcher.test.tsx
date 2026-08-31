import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceSwitcher } from '../src/components/WorkspaceSwitcher'
import type { WorkspaceSummary } from '../src/lib/types'

const primary: WorkspaceSummary = {
  id: '123e4567-e89b-42d3-a456-426614174401',
  name: 'Primary Workspace',
  role: 'owner',
  accessStatus: 'active',
  availableOutputs: 4,
  reservedOutputs: 1
}

const shared: WorkspaceSummary = {
  id: '123e4567-e89b-42d3-a456-426614174402',
  name: 'Shared Campaign Team',
  role: 'member',
  accessStatus: 'active',
  availableOutputs: 2,
  reservedOutputs: 0
}

describe('workspace switcher', () => {
  it('renders one labelled current control and only canonical workspace options', () => {
    const markup = renderToStaticMarkup(<WorkspaceSwitcher
      currentWorkspace={primary}
      workspaces={[primary, shared]}
      isLoading={false}
      isSwitching={false}
      onOpen={vi.fn()}
      onSelect={vi.fn()}
    />)

    expect(markup).toContain('aria-label="切換工作區，目前是 Primary Workspace"')
    expect(markup).toContain('可用工作區 · Available workspaces')
    expect(markup).toContain('Primary Workspace')
    expect(markup).toContain('Shared Campaign Team')
    expect(markup).toContain('一般成員 · Member · 可用輸出 2')
    expect(markup).toContain('目前工作區')
    expect(markup).toContain('<ul class="workspace-menu-list">')
    expect(markup).not.toContain('role="listitem"')
  })

  it('announces loading, failure and mutation locking without exposing server detail', () => {
    const markup = renderToStaticMarkup(<WorkspaceSwitcher
      currentWorkspace={primary}
      workspaces={[primary]}
      isLoading
      isSwitching
      disabled
      notice="工作區清單暫時無法讀取。 Workspace list is temporarily unavailable."
      onOpen={vi.fn()}
      onSelect={vi.fn()}
    />)

    expect(markup).toContain('aria-disabled="true"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('正在切換工作區，目前是 Primary Workspace')
    expect(markup).toContain('正在核對其他工作區…')
    expect(markup).toContain('工作區清單暫時無法讀取。 Workspace list is temporarily unavailable.')
  })
})
