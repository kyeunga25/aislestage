import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  inviteWorkspaceMember,
  loadWorkspaceMembers,
  loadWorkspaceMembersSnapshot,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  workspaceMembersUnavailableMessage
} from '../src/lib/workspace-access-client'

const canonicalMember = {
  id: '123e4567-e89b-42d3-a456-426614174200',
  name: 'Synthetic Owner',
  email: 'owner@example.test',
  role: 'owner',
  accountStatus: 'active',
  authMode: 'access',
  createdAt: '2026-08-30T06:00:00Z'
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('workspace access client', () => {
  it('loads only an exact canonical member envelope', async () => {
    const fetchMock = vi.fn(async () => Response.json({ members: [canonicalMember] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadWorkspaceMembers()).resolves.toEqual([canonicalMember])
    expect(fetchMock).toHaveBeenCalledWith('/api/workspace-members', expect.objectContaining({
      credentials: 'same-origin',
      signal: expect.any(AbortSignal)
    }))
  })

  it.each([
    { members: [{ ...canonicalMember, workspaceId: 'private-workspace' }] },
    { members: [{ ...canonicalMember, role: 'super-admin' }] },
    { members: [{ ...canonicalMember, email: 'not-an-email' }] },
    { members: [{ ...canonicalMember, createdAt: 'not-a-time' }] },
    { members: [canonicalMember, canonicalMember] },
    { members: Array.from({ length: 51 }, (_, index) => ({ ...canonicalMember, id: `123e4567-e89b-42d3-a456-${String(426614174200 + index).padStart(12, '0')}` })) },
    { members: [], cursor: 'private-cursor' }
  ])('rejects malformed or expanded member data %#', async (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)))
    await expect(loadWorkspaceMembers()).rejects.toThrow(workspaceMembersUnavailableMessage)
  })

  it('keeps the prior trusted snapshot when refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'private D1 detail' }, { status: 503 })))
    await expect(loadWorkspaceMembersSnapshot()).resolves.toEqual({
      members: null,
      error: workspaceMembersUnavailableMessage
    })
  })

  it('creates an Access member with one exact bounded mutation', async () => {
    const invited = { ...canonicalMember, role: 'admin', name: 'Invited Admin', email: 'admin@example.test' }
    const fetchMock = vi.fn(async () => Response.json({ member: invited, replayed: false }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(inviteWorkspaceMember({
      email: invited.email,
      name: invited.name,
      role: 'admin'
    })).resolves.toEqual(invited)
    expect(fetchMock).toHaveBeenCalledWith('/api/workspace-members', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: invited.email, name: invited.name, role: 'admin' }),
      signal: expect.any(AbortSignal)
    }))
  })

  it('retries one safe natural-key invitation after a temporary failure', async () => {
    const invited = { ...canonicalMember, role: 'member', name: 'Invited Member', email: 'member@example.test' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'private failure' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ member: invited, replayed: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(inviteWorkspaceMember({ email: invited.email, name: invited.name, role: 'member' })).resolves.toEqual(invited)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1]?.body).toBe(fetchMock.mock.calls[1][1]?.body)
  })

  it('updates one role and rejects a malformed success acknowledgement', async () => {
    const admin = { ...canonicalMember, role: 'admin' }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ member: admin, replayed: false })))
    await expect(updateWorkspaceMemberRole(admin.id, 'admin')).resolves.toEqual(admin)

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ member: admin, replayed: false, internal: true })))
    await expect(updateWorkspaceMemberRole(admin.id, 'admin')).rejects.toThrow('成員角色更新暫時無法使用。')
  })

  it('treats 204 and workspace-scoped 404 removal as absent but rejects other success statuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    await expect(removeWorkspaceMember(canonicalMember.id)).resolves.toBeUndefined()

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'not found' }, { status: 404 })))
    await expect(removeWorkspaceMember(canonicalMember.id)).resolves.toBeUndefined()

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true }, { status: 200 })))
    await expect(removeWorkspaceMember(canonicalMember.id)).rejects.toThrow('未能確認成員移除結果。')
  })
})
