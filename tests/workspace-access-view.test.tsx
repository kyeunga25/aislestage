import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceAccessView } from '../src/components/WorkspaceAccessView'
import type { WorkspaceMember } from '../src/lib/types'

const members: WorkspaceMember[] = [
  {
    id: '123e4567-e89b-42d3-a456-426614174210',
    name: 'Synthetic Owner',
    email: 'owner@example.test',
    role: 'owner',
    accountStatus: 'active',
    authMode: 'access',
    createdAt: '2026-08-30T06:00:00Z'
  },
  {
    id: '123e4567-e89b-42d3-a456-426614174211',
    name: 'Synthetic Member',
    email: 'member@example.test',
    role: 'member',
    accountStatus: 'active',
    authMode: 'access',
    createdAt: '2026-08-30T06:05:00Z'
  }
]

describe('workspace access management view', () => {
  it('renders the owner invitation, role, removal, and Access boundary controls', () => {
    const markup = renderToStaticMarkup(<WorkspaceAccessView
      members={members}
      viewerRole="owner"
      isRefreshing={false}
      mutation={null}
      notice=""
      onRefresh={vi.fn()}
      onInvite={vi.fn()}
      onRoleChange={vi.fn()}
      onRemove={vi.fn()}
      onBack={vi.fn()}
    />)

    expect(markup).toContain('存取管理')
    expect(markup).toContain('Workspace access')
    expect(markup).toContain('Cloudflare Access')
    expect(markup).toContain('不會修改 Access allow policy')
    expect(markup).toContain('邀請 Access 成員')
    expect(markup).toContain('name="member-email"')
    expect(markup).toContain('name="member-name"')
    expect(markup).toContain('name="member-role"')
    expect(markup).toContain('Synthetic Owner')
    expect(markup).toContain('Synthetic Member')
    expect(markup).toContain('owner · 不可變更')
    expect(markup).toContain('移除成員')
  })

  it('keeps admin management member-only and locks every mutation while busy', () => {
    const markup = renderToStaticMarkup(<WorkspaceAccessView
      members={members}
      viewerRole="admin"
      isRefreshing={true}
      mutation={{ kind: 'invite', memberId: null }}
      notice="工作區成員暫時無法讀取。 Workspace members are temporarily unavailable."
      onRefresh={vi.fn()}
      onInvite={vi.fn()}
      onRoleChange={vi.fn()}
      onRemove={vi.fn()}
      onBack={vi.fn()}
    />)

    expect(markup).toContain('一般成員 · Member')
    expect(markup).not.toContain('<option value="admin">')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Workspace members are temporarily unavailable.')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('disabled=""')
  })
})
