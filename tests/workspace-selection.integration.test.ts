import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { cookieFrom, dispatch, registerAccount, type RegisteredAccount } from './helpers'

async function addMembership(account: RegisteredAccount, workspaceId: string, role: 'admin' | 'member' = 'member') {
  await env.DB.prepare(`
    INSERT INTO workspace_memberships (workspace_id, user_id, role)
    VALUES (?, ?, ?)
  `).bind(workspaceId, account.user.id, role).run()
}

function selectionRequest(account: RegisteredAccount, workspaceId: string, init: RequestInit = {}) {
  const { headers, body, ...rest } = init
  return dispatch('/api/workspaces/current', {
    ...rest,
    method: 'PUT',
    headers: {
      cookie: account.cookie,
      origin: 'https://app.test',
      'content-type': 'application/json',
      ...headers
    },
    body: body ?? JSON.stringify({ workspaceId })
  })
}

describe('browser-scoped workspace selection', () => {
  it('switches an active multi-workspace member without changing D1 membership roles', async () => {
    const member = await registerAccount('Workspace Switch Member')
    const secondOwner = await registerAccount('Workspace Switch Second Owner')
    await addMembership(member, secondOwner.currentWorkspace.id)

    const before = await dispatch('/api/workspaces', { headers: { cookie: member.cookie } })
    expect(before.status).toBe(200)
    expect(await before.json()).toMatchObject({
      currentWorkspace: { id: member.currentWorkspace.id, role: 'owner' },
      workspaces: [
        { id: member.currentWorkspace.id, role: 'owner' },
        { id: secondOwner.currentWorkspace.id, role: 'member' }
      ]
    })

    const switched = await selectionRequest(member, secondOwner.currentWorkspace.id)
    expect(switched.status).toBe(200)
    expect(switched.headers.get('cache-control')).toBe('no-store')
    expect(switched.headers.get('set-cookie')).toContain('aislestage_workspace=')
    expect(switched.headers.get('set-cookie')).toContain('HttpOnly')
    expect(switched.headers.get('set-cookie')).toContain('SameSite=Lax')
    expect(await switched.json()).toEqual({
      currentWorkspace: {
        ...secondOwner.currentWorkspace,
        role: 'member'
      }
    })

    const selectedCookie = cookieFrom(switched)
    const headerSelectedSession = await dispatch('/api/session', {
      headers: {
        cookie: member.cookie,
        'x-aislestage-workspace-id': secondOwner.currentWorkspace.id
      }
    })
    expect(await headerSelectedSession.json()).toMatchObject({
      authenticated: true,
      currentWorkspace: { id: secondOwner.currentWorkspace.id, role: 'member' }
    })

    const selectedSession = await dispatch('/api/session', {
      headers: { cookie: `${member.cookie}; ${selectedCookie}` }
    })
    expect(selectedSession.status).toBe(200)
    expect(await selectedSession.json()).toMatchObject({
      authenticated: true,
      user: { id: member.user.id },
      currentWorkspace: { id: secondOwner.currentWorkspace.id, role: 'member' }
    })

    const selectedList = await dispatch('/api/workspaces', {
      headers: { cookie: `${member.cookie}; ${selectedCookie}` }
    })
    expect(await selectedList.json()).toMatchObject({
      currentWorkspace: { id: secondOwner.currentWorkspace.id, role: 'member' },
      workspaces: [
        { id: secondOwner.currentWorkspace.id, role: 'member' },
        { id: member.currentWorkspace.id, role: 'owner' }
      ]
    })

    expect(await env.DB.prepare(`
      SELECT role
      FROM workspace_memberships
      WHERE workspace_id = ? AND user_id = ?
    `).bind(secondOwner.currentWorkspace.id, member.user.id).first()).toEqual({ role: 'member' })
  })

  it('caps the canonical workspace list at 50 while keeping an explicitly selected membership reachable', async () => {
    const account = await registerAccount('Workspace List Limit')
    const sharedWorkspaceIds = Array.from({ length: 50 }, (_, index) =>
      `123e4567-e89b-42d3-a456-${String(426614175000 + index).padStart(12, '0')}`)
    for (let offset = 0; offset < sharedWorkspaceIds.length; offset += 25) {
      const chunk = sharedWorkspaceIds.slice(offset, offset + 25)
      const workspaceValues = chunk.map(() => '(?, ?, ?)').join(', ')
      const membershipValues = chunk.map(() => "(?, ?, 'member')").join(', ')
      await env.DB.prepare(`
        INSERT INTO workspaces (id, owner_user_id, name)
        VALUES ${workspaceValues}
      `).bind(...chunk.flatMap((id, index) => [id, account.user.id, `Shared Workspace ${offset + index + 1}`])).run()
      await env.DB.prepare(`
        INSERT INTO workspace_memberships (workspace_id, user_id, role)
        VALUES ${membershipValues}
      `).bind(...chunk.flatMap((id) => [id, account.user.id])).run()
    }

    const initial = await dispatch('/api/workspaces', { headers: { cookie: account.cookie } })
    const initialBody = await initial.json() as { workspaces: Array<{ id: string }> }
    expect(initial.status).toBe(200)
    expect(initialBody.workspaces).toHaveLength(50)
    expect(initialBody.workspaces[0].id).toBe(account.currentWorkspace.id)
    expect(initialBody.workspaces.some((workspace) => workspace.id === sharedWorkspaceIds[49])).toBe(false)

    const switched = await selectionRequest(account, sharedWorkspaceIds[49])
    expect(switched.status).toBe(200)
    const selected = await dispatch('/api/workspaces', {
      headers: { cookie: `${account.cookie}; ${cookieFrom(switched)}` }
    })
    const selectedBody = await selected.json() as { workspaces: Array<{ id: string }>; currentWorkspace: { id: string } }
    expect(selectedBody.workspaces).toHaveLength(50)
    expect(selectedBody.workspaces[0].id).toBe(sharedWorkspaceIds[49])
    expect(selectedBody.currentWorkspace.id).toBe(sharedWorkspaceIds[49])
  })

  it('ignores a forged selection cookie and keeps authorization on an active membership', async () => {
    const account = await registerAccount('Forged Workspace Cookie')
    const unrelated = await registerAccount('Unrelated Workspace Cookie')

    const response = await dispatch('/api/session', {
      headers: {
        cookie: `${account.cookie}; aislestage_workspace=${unrelated.currentWorkspace.id}`
      }
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      authenticated: true,
      currentWorkspace: { id: account.currentWorkspace.id }
    })

    const forgedHeader = await dispatch('/api/session', {
      headers: {
        cookie: account.cookie,
        'x-aislestage-workspace-id': unrelated.currentWorkspace.id
      }
    })
    expect(await forgedHeader.json()).toMatchObject({
      authenticated: true,
      currentWorkspace: { id: account.currentWorkspace.id }
    })
  })

  it('prefers the per-tab API header over the browser-wide resource cookie', async () => {
    const account = await registerAccount('Workspace Header Priority')
    const sharedOwner = await registerAccount('Workspace Header Priority Shared')
    await addMembership(account, sharedOwner.currentWorkspace.id)
    const switched = await selectionRequest(account, sharedOwner.currentWorkspace.id)

    const response = await dispatch('/api/session', {
      headers: {
        cookie: `${account.cookie}; ${cookieFrom(switched)}`,
        'x-aislestage-workspace-id': account.currentWorkspace.id
      }
    })

    expect(await response.json()).toMatchObject({
      authenticated: true,
      currentWorkspace: { id: account.currentWorkspace.id, role: 'owner' }
    })
  })

  it('does not set a cookie for a workspace outside the current user memberships', async () => {
    const account = await registerAccount('Workspace Selection Scope')
    const unrelated = await registerAccount('Workspace Selection Outside Scope')

    const response = await selectionRequest(account, unrelated.currentWorkspace.id)

    expect(response.status).toBe(404)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.json()).toEqual({
      error: 'Workspace not found.'
    })
  })

  it.each([
    {
      label: 'extra key',
      init: { body: JSON.stringify({ workspaceId: crypto.randomUUID(), internal: true }) },
      status: 400
    },
    {
      label: 'invalid UUID',
      init: { body: JSON.stringify({ workspaceId: 'not-a-workspace' }) },
      status: 400
    },
    {
      label: 'wrong media type',
      init: { headers: { 'content-type': 'text/plain' } },
      status: 415
    },
    {
      label: 'oversized body',
      init: { body: JSON.stringify({ workspaceId: crypto.randomUUID(), padding: 'x'.repeat(2_048) }) },
      status: 413
    },
    {
      label: 'cross origin',
      init: { headers: { origin: 'https://outside.example' } },
      status: 403
    }
  ])('rejects $label workspace selection requests', async ({ init, status }) => {
    const account = await registerAccount(`Workspace Selection ${status}`)
    const response = await selectionRequest(account, crypto.randomUUID(), init as RequestInit)
    expect(response.status).toBe(status)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('returns a fixed unavailable response when membership selection cannot be read', async () => {
    const account = await registerAccount('Workspace Selection Read Failure')
    const target = await registerAccount('Workspace Selection Read Failure Target')
    await addMembership(account, target.currentWorkspace.id)
    const unreadableDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('FROM workspace_memberships wm')) return statement
        return {
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values)
            return {
              all: async () => {
                if (values.includes(target.currentWorkspace.id)) {
                  throw new TypeError('synthetic workspace selection read failure')
                }
                return bound.all()
              }
            }
          }
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const response = await dispatch('/api/workspaces/current', {
      method: 'PUT',
      headers: {
        cookie: account.cookie,
        origin: 'https://app.test',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ workspaceId: target.currentWorkspace.id })
    }, { ...env, DB: unreadableDb })

    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.json()).toEqual({
      code: 'unavailable',
      error: '工作區暫時無法切換。 Workspace switch is temporarily unavailable.'
    })
  })
})
