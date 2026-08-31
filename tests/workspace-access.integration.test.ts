import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { Env } from '../src/worker'
import { dispatch, registerAccount, type RegisteredAccount } from './helpers'

const jsonHeaders = (cookie: string) => ({
  cookie,
  origin: 'https://app.test',
  'content-type': 'application/json'
})

async function moveAccountToWorkspace(
  account: RegisteredAccount,
  workspaceId: string,
  role: 'admin' | 'member'
) {
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES (?, ?, ?)
    `).bind(workspaceId, account.user.id, role),
    env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(account.currentWorkspace.id)
  ])
}

async function inviteMember(
  owner: RegisteredAccount,
  input: { email: string; name: string; role: 'admin' | 'member' },
  envOverride: Env = env
) {
  return dispatch('/api/workspace-members', {
    method: 'POST',
    headers: jsonHeaders(owner.cookie),
    body: JSON.stringify(input)
  }, envOverride)
}

describe('workspace access management API', () => {
  it('returns one workspace-scoped canonical member list only to managers', async () => {
    const owner = await registerAccount('Access List Owner')
    const member = await registerAccount('Access List Member')
    const otherOwner = await registerAccount('Other Access Owner')
    await moveAccountToWorkspace(member, owner.currentWorkspace.id, 'member')

    const response = await dispatch('/api/workspace-members', { headers: { cookie: owner.cookie } })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const raw = await response.text()
    const payload = JSON.parse(raw) as { members: Array<Record<string, unknown>> }

    expect(Object.keys(payload)).toEqual(['members'])
    expect(payload.members).toHaveLength(2)
    expect(payload.members.map((item) => item.role)).toEqual(['owner', 'member'])
    expect(payload.members.every((item) => Object.keys(item).sort().join(',') === 'accountStatus,authMode,createdAt,email,id,name,role')).toBe(true)
    expect(payload.members[0]).toMatchObject({
      id: owner.user.id,
      email: owner.user.email,
      name: owner.user.name,
      role: 'owner',
      accountStatus: 'active',
      authMode: 'password'
    })
    expect(payload.members[1]).toMatchObject({
      id: member.user.id,
      email: member.user.email,
      role: 'member'
    })
    expect(raw).not.toContain(owner.currentWorkspace.id)
    expect(raw).not.toContain(otherOwner.user.email)
    expect(raw).not.toContain('password_hash')
    expect(raw).not.toContain('access_subject_hash')

    const denied = await dispatch('/api/workspace-members', { headers: { cookie: member.cookie } })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({
      error: '只有工作區 owner 或 admin 可以管理成員。 Only workspace owners or admins can manage members.'
    })
  })

  it('lets an owner pre-onboard an Access member and safely replay the same invitation', async () => {
    const owner = await registerAccount('Access Invite Owner')
    const email = `invited-${crypto.randomUUID()}@example.test`
    const input = { email, name: 'Invited Manager', role: 'admin' as const }

    const created = await inviteMember(owner, input)
    expect(created.status).toBe(201)
    const createdPayload = await created.json() as { member: Record<string, unknown>; replayed: boolean }
    expect(Object.keys(createdPayload).sort()).toEqual(['member', 'replayed'])
    expect(createdPayload.replayed).toBe(false)
    expect(createdPayload.member).toMatchObject({
      email,
      name: input.name,
      role: 'admin',
      accountStatus: 'active',
      authMode: 'access'
    })

    const repeated = await inviteMember(owner, input)
    expect(repeated.status).toBe(200)
    await expect(repeated.json()).resolves.toEqual({ ...createdPayload, replayed: true })

    const stored = await env.DB.prepare(`
      SELECT u.id, u.auth_mode AS authMode, u.account_type AS accountType,
        u.account_status AS accountStatus, u.access_subject_hash AS accessSubjectHash,
        wm.role
      FROM users u
      JOIN workspace_memberships wm ON wm.user_id = u.id
      WHERE u.email = ? AND wm.workspace_id = ?
    `).bind(email, owner.currentWorkspace.id).first<{
      id: string
      authMode: string
      accountType: string
      accountStatus: string
      accessSubjectHash: string | null
      role: string
    }>()
    expect(stored).toMatchObject({
      id: createdPayload.member.id,
      authMode: 'access',
      accountType: 'beta',
      accountStatus: 'active',
      accessSubjectHash: null,
      role: 'admin'
    })
    expect(await env.DB.prepare(`
      SELECT event_type AS eventType, actor_user_id AS actorUserId, target_user_id AS targetUserId
      FROM workspace_access_events
      WHERE workspace_id = ?
    `).bind(owner.currentWorkspace.id).all()).toMatchObject({
      results: [{ eventType: 'member_invited', actorUserId: owner.user.id, targetUserId: createdPayload.member.id }]
    })

    const conflictingRole = await inviteMember(owner, { ...input, role: 'member' })
    expect(conflictingRole.status).toBe(409)
  })

  it('gives admins a narrow member-only invitation and removal capability', async () => {
    const owner = await registerAccount('Access Admin Owner')
    const admin = await registerAccount('Access Admin')
    await moveAccountToWorkspace(admin, owner.currentWorkspace.id, 'admin')

    const memberEmail = `member-${crypto.randomUUID()}@example.test`
    const created = await inviteMember(admin, { email: memberEmail, name: 'Managed Member', role: 'member' })
    expect(created.status).toBe(201)
    const memberId = ((await created.json()) as { member: { id: string } }).member.id

    const forbiddenAdmin = await inviteMember(admin, {
      email: `admin-${crypto.randomUUID()}@example.test`,
      name: 'Forbidden Admin',
      role: 'admin'
    })
    expect(forbiddenAdmin.status).toBe(403)

    const roleChange = await dispatch(`/api/workspace-members/${memberId}`, {
      method: 'PATCH',
      headers: jsonHeaders(admin.cookie),
      body: JSON.stringify({ role: 'admin' })
    })
    expect(roleChange.status).toBe(403)

    const removed = await dispatch(`/api/workspace-members/${memberId}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie, origin: 'https://app.test' }
    })
    expect(removed.status).toBe(204)
    expect(await env.DB.prepare(`
      SELECT 1 AS present FROM workspace_memberships
      WHERE workspace_id = ? AND user_id = ?
    `).bind(owner.currentWorkspace.id, memberId).first()).toBeNull()
    expect(await env.DB.prepare(`
      SELECT event_type AS eventType, actor_user_id AS actorUserId, target_user_id AS targetUserId
      FROM workspace_access_events
      WHERE workspace_id = ? AND event_type = 'member_removed'
    `).bind(owner.currentWorkspace.id).first()).toEqual({
      eventType: 'member_removed',
      actorUserId: admin.user.id,
      targetUserId: memberId
    })

    const selfRemoval = await dispatch(`/api/workspace-members/${admin.user.id}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie, origin: 'https://app.test' }
    })
    expect(selfRemoval.status).toBe(409)
  })

  it('does not let an admin delete a member promoted before the removal batch', async () => {
    const owner = await registerAccount('Access Promotion Owner')
    const admin = await registerAccount('Access Promotion Admin')
    const member = await registerAccount('Access Promotion Member')
    await moveAccountToWorkspace(admin, owner.currentWorkspace.id, 'admin')
    await moveAccountToWorkspace(member, owner.currentWorkspace.id, 'member')

    let promotionPending = true
    const promotionDb = {
      prepare: env.DB.prepare.bind(env.DB),
      async batch<T = unknown>(statements: D1PreparedStatement[]) {
        if (promotionPending) {
          promotionPending = false
          await env.DB.prepare(`
            UPDATE workspace_memberships SET role = 'admin'
            WHERE workspace_id = ? AND user_id = ?
          `).bind(owner.currentWorkspace.id, member.user.id).run()
        }
        return env.DB.batch<T>(statements)
      }
    } as unknown as typeof env.DB

    const response = await dispatch(`/api/workspace-members/${member.user.id}`, {
      method: 'DELETE',
      headers: { cookie: admin.cookie, origin: 'https://app.test' }
    }, { ...env, DB: promotionDb } as Env)

    expect(response.status).toBe(403)
    expect(await env.DB.prepare(`
      SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?
    `).bind(owner.currentWorkspace.id, member.user.id).first()).toEqual({ role: 'admin' })
  })

  it('lets only an owner change non-owner roles and never mutates the workspace owner', async () => {
    const owner = await registerAccount('Access Role Owner')
    const member = await registerAccount('Access Role Member')
    await moveAccountToWorkspace(member, owner.currentWorkspace.id, 'member')

    const changed = await dispatch(`/api/workspace-members/${member.user.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({ role: 'admin' })
    })
    expect(changed.status).toBe(200)
    const changedPayload = await changed.json()
    expect(changedPayload).toMatchObject({
      replayed: false,
      member: { id: member.user.id, role: 'admin' }
    })

    const replay = await dispatch(`/api/workspace-members/${member.user.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({ role: 'admin' })
    })
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ replayed: true, member: { role: 'admin' } })

    const ownerMutation = await dispatch(`/api/workspace-members/${owner.user.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({ role: 'member' })
    })
    expect(ownerMutation.status).toBe(409)
    expect(await env.DB.prepare(`
      SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?
    `).bind(owner.currentWorkspace.id, owner.user.id).first()).toEqual({ role: 'owner' })
    expect(await env.DB.prepare(`
      SELECT event_type AS eventType, actor_user_id AS actorUserId, target_user_id AS targetUserId
      FROM workspace_access_events
      WHERE workspace_id = ? AND event_type = 'member_role_changed'
    `).bind(owner.currentWorkspace.id).all()).toMatchObject({
      results: [{ eventType: 'member_role_changed', actorUserId: owner.user.id, targetUserId: member.user.id }]
    })
  })

  it('keeps member identities workspace-scoped and reconciles ambiguous D1 commits', async () => {
    const owner = await registerAccount('Access Reconcile Owner')
    const otherOwner = await registerAccount('Access Reconcile Other')
    const email = `reconciled-${crypto.randomUUID()}@example.test`
    let firstBatch = true
    const ambiguousDb = {
      prepare: env.DB.prepare.bind(env.DB),
      async batch<T = unknown>(statements: D1PreparedStatement[]) {
        const result = await env.DB.batch<T>(statements)
        if (firstBatch) {
          firstBatch = false
          throw new TypeError('synthetic response failure after membership commit')
        }
        return result
      }
    } as unknown as typeof env.DB

    const reconciled = await inviteMember(owner, {
      email,
      name: 'Reconciled Member',
      role: 'member'
    }, { ...env, DB: ambiguousDb } as Env)
    expect(reconciled.status).toBe(201)
    const memberId = ((await reconciled.json()) as { member: { id: string } }).member.id

    const hidden = await dispatch(`/api/workspace-members/${memberId}`, {
      method: 'DELETE',
      headers: { cookie: otherOwner.cookie, origin: 'https://app.test' }
    })
    expect(hidden.status).toBe(404)

    let deleteBatch = true
    const ambiguousDeleteDb = {
      prepare: env.DB.prepare.bind(env.DB),
      async batch<T = unknown>(statements: D1PreparedStatement[]) {
        const result = await env.DB.batch<T>(statements)
        if (deleteBatch) {
          deleteBatch = false
          throw new TypeError('synthetic response failure after membership removal')
        }
        return result
      }
    } as unknown as typeof env.DB
    const deleted = await dispatch(`/api/workspace-members/${memberId}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    }, { ...env, DB: ambiguousDeleteDb } as Env)
    expect(deleted.status).toBe(204)
  })

  it('rejects malformed, expanded, oversized, and non-JSON mutations before writing', async () => {
    const owner = await registerAccount('Access Validation Owner')
    const email = `validation-${crypto.randomUUID()}@example.test`
    const invalidBodies = [
      { email: 'invalid', name: 'Member', role: 'member' },
      { email, name: '', role: 'member' },
      { email, name: 'Member', role: 'owner' },
      { email, name: 'Member', role: 'member', workspaceId: owner.currentWorkspace.id }
    ]
    for (const body of invalidBodies) {
      const response = await inviteMember(owner, body as { email: string; name: string; role: 'member' })
      expect(response.status).toBe(400)
    }

    const wrongMedia = await dispatch('/api/workspace-members', {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: 'https://app.test', 'content-type': 'text/plain' },
      body: JSON.stringify({ email, name: 'Member', role: 'member' })
    })
    expect(wrongMedia.status).toBe(415)

    const oversized = await inviteMember(owner, {
      email,
      name: 'x'.repeat(3_000),
      role: 'member'
    })
    expect(oversized.status).toBe(413)

    const deleteWithBody = await dispatch(`/api/workspace-members/${crypto.randomUUID()}`, {
      method: 'DELETE',
      headers: jsonHeaders(owner.cookie),
      body: '{}'
    })
    expect(deleteWithBody.status).toBe(413)
    expect(await env.DB.prepare('SELECT 1 AS present FROM users WHERE email = ?').bind(email).first()).toBeNull()
  })

  it('enforces the 50-member capacity in D1 as well as the API preflight', async () => {
    const owner = await registerAccount('Access Capacity Owner')
    for (let offset = 0; offset < 49; offset += 10) {
      const statements: D1PreparedStatement[] = []
      for (let index = offset; index < Math.min(offset + 10, 49); index += 1) {
        const userId = crypto.randomUUID()
        statements.push(
          env.DB.prepare(`
            INSERT INTO users (id, email, name, password_hash, password_salt)
            VALUES (?, ?, ?, 'synthetic-hash', 'synthetic-salt')
          `).bind(userId, `capacity-${index}-${crypto.randomUUID()}@example.test`, `Capacity Member ${index}`),
          env.DB.prepare(`
            INSERT INTO workspace_memberships (workspace_id, user_id, role)
            VALUES (?, ?, 'member')
          `).bind(owner.currentWorkspace.id, userId)
        )
      }
      await env.DB.batch(statements)
    }

    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM workspace_memberships WHERE workspace_id = ?
    `).bind(owner.currentWorkspace.id).first()).toEqual({ count: 50 })

    const overflowUserId = crypto.randomUUID()
    await env.DB.prepare(`
      INSERT INTO users (id, email, name, password_hash, password_salt)
      VALUES (?, ?, 'Overflow Member', 'synthetic-hash', 'synthetic-salt')
    `).bind(overflowUserId, `overflow-${crypto.randomUUID()}@example.test`).run()
    await expect(env.DB.prepare(`
      INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES (?, ?, 'member')
    `).bind(owner.currentWorkspace.id, overflowUserId).run()).rejects.toThrow()

    const full = await inviteMember(owner, {
      email: `full-${crypto.randomUUID()}@example.test`,
      name: 'Full Workspace Member',
      role: 'member'
    })
    expect(full.status).toBe(409)
  })

  it('keeps access audit triggers compatible with an authorized workspace cascade', async () => {
    const owner = await registerAccount('Access Cascade Owner')
    await inviteMember(owner, {
      email: `cascade-${crypto.randomUUID()}@example.test`,
      name: 'Cascade Member',
      role: 'member'
    })
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM workspace_access_events WHERE workspace_id = ?
    `).bind(owner.currentWorkspace.id).first()).toEqual({ count: 1 })

    await expect(env.DB.prepare('DELETE FROM workspaces WHERE id = ?')
      .bind(owner.currentWorkspace.id)
      .run()).resolves.toBeDefined()
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM workspace_access_events WHERE workspace_id = ?
    `).bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it('fails the whole list closed on stored schema drift and rejects unsupported methods', async () => {
    const owner = await registerAccount('Access Drift Owner')
    await env.DB.prepare(`
      UPDATE workspace_memberships SET created_at = 'not-a-time'
      WHERE workspace_id = ? AND user_id = ?
    `).bind(owner.currentWorkspace.id, owner.user.id).run()

    const drifted = await dispatch('/api/workspace-members', { headers: { cookie: owner.cookie } })
    expect(drifted.status).toBe(503)
    expect(await drifted.json()).toEqual({
      code: 'unavailable',
      error: '工作區成員暫時無法讀取。 Workspace members are temporarily unavailable.'
    })

    const method = await dispatch('/api/workspace-members', {
      method: 'PUT',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    })
    expect(method.status).toBe(405)
    expect(method.headers.get('allow')).toBe('GET, POST')
  })
})
