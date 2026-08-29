import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { Env } from '../src/worker'
import { dispatch, registerAccount } from './helpers'

const activityHeaders = (cookie: string) => ({ cookie })

async function seedAuditedOperations(account: Awaited<ReturnType<typeof registerAccount>>) {
  const assetId = crypto.randomUUID()
  const packId = crypto.randomUUID()
  const generationId = crypto.randomUUID()

  await env.DB.prepare(`
    INSERT INTO media_assets (
      id, workspace_id, created_by_user_id, kind, object_key,
      original_filename, content_type, size_bytes, content_sha256
    ) VALUES (?, ?, ?, 'product-source', ?, 'product-image.png', 'image/png', 1, ?)
  `).bind(
    assetId,
    account.currentWorkspace.id,
    account.user.id,
    `workspaces/${account.currentWorkspace.id}/assets/${assetId}.png`,
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  ).run()

  await env.DB.prepare(`
    INSERT INTO campaign_packs (
      id, workspace_id, idempotency_key, approved_revision, created_by_user_id
    ) VALUES (?, ?, ?, 1, ?)
  `).bind(packId, account.currentWorkspace.id, crypto.randomUUID(), account.user.id).run()

  await env.DB.prepare(`
    INSERT INTO generations (
      id, workspace_id, workflow_id, aspect_ratio, status, credit_cost,
      input_json, approved_revision, output_cost, campaign_pack_id,
      review_status, output_content_type, composition_version, generation_mode
    ) VALUES (?, ?, 'store-main', '1:1', 'completed', 1, '{}', 1, 1, ?,
      'draft', 'image/svg+xml', 'campaign-svg-v1', 'deterministic')
  `).bind(generationId, account.currentWorkspace.id, packId).run()

  await env.DB.prepare(`
    UPDATE generations
    SET review_status = 'approved', reviewed_at = CURRENT_TIMESTAMP,
      reviewed_by_user_id = ?
    WHERE id = ? AND workspace_id = ?
  `).bind(account.user.id, generationId, account.currentWorkspace.id).run()

  await env.DB.prepare('DELETE FROM generations WHERE id = ? AND workspace_id = ?')
    .bind(generationId, account.currentWorkspace.id)
    .run()
  await env.DB.prepare('DELETE FROM media_assets WHERE id = ? AND workspace_id = ?')
    .bind(assetId, account.currentWorkspace.id)
    .run()

  return { assetId, packId, generationId }
}

describe('workspace activity audit trail', () => {
  it('records core workspace mutations and returns only bounded public-safe metadata to managers', async () => {
    const owner = await registerAccount('Activity Owner')
    const subjects = await seedAuditedOperations(owner)

    const response = await dispatch('/api/workspace-activity', {
      headers: activityHeaders(owner.cookie)
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toContain('application/json')
    const raw = await response.text()
    const payload = JSON.parse(raw) as {
      activity: Array<{ id: string; type: string; actorName: string | null; createdAt: string }>
    }

    expect(Object.keys(payload)).toEqual(['activity'])
    expect(payload.activity.map((event) => event.type)).toEqual(expect.arrayContaining([
      'product_asset_uploaded',
      'product_asset_deleted',
      'campaign_pack_created',
      'generation_approved',
      'generation_deleted'
    ]))
    expect(payload.activity).toHaveLength(5)
    expect(payload.activity.every((event) => Object.keys(event).sort().join(',') === 'actorName,createdAt,id,type')).toBe(true)
    expect(payload.activity.find((event) => event.type === 'product_asset_uploaded')?.actorName).toBe(owner.user.name)
    expect(payload.activity.find((event) => event.type === 'campaign_pack_created')?.actorName).toBe(owner.user.name)
    expect(payload.activity.find((event) => event.type === 'generation_approved')?.actorName).toBe(owner.user.name)
    expect(payload.activity.find((event) => event.type === 'product_asset_deleted')?.actorName).toBeNull()
    expect(payload.activity.every((event) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(event.createdAt))).toBe(true)
    expect(raw).not.toContain(subjects.assetId)
    expect(raw).not.toContain(subjects.packId)
    expect(raw).not.toContain(subjects.generationId)
    expect(raw).not.toContain('product-image.png')
    expect(raw).not.toContain('input_json')
  })

  it('keeps activity workspace-scoped and denies ordinary members', async () => {
    const ownerA = await registerAccount('Activity Workspace A')
    const ownerB = await registerAccount('Activity Workspace B')
    await env.DB.prepare(`
      INSERT INTO workspace_activity_events (id, workspace_id, actor_user_id, event_type, subject_id)
      VALUES (?, ?, ?, 'campaign_pack_created', ?)
    `).bind(crypto.randomUUID(), ownerA.currentWorkspace.id, ownerA.user.id, crypto.randomUUID()).run()
    await env.DB.prepare(`
      INSERT INTO workspace_activity_events (id, workspace_id, actor_user_id, event_type, subject_id)
      VALUES (?, ?, ?, 'generation_rejected', ?)
    `).bind(crypto.randomUUID(), ownerB.currentWorkspace.id, ownerB.user.id, crypto.randomUUID()).run()

    const scoped = await dispatch('/api/workspace-activity', { headers: activityHeaders(ownerA.cookie) })
    expect(scoped.status).toBe(200)
    expect(await scoped.json()).toMatchObject({
      activity: [{ type: 'campaign_pack_created', actorName: ownerA.user.name }]
    })

    await env.DB.prepare(`
      UPDATE workspace_memberships SET role = 'member'
      WHERE workspace_id = ? AND user_id = ?
    `).bind(ownerA.currentWorkspace.id, ownerA.user.id).run()
    const denied = await dispatch('/api/workspace-activity', { headers: activityHeaders(ownerA.cookie) })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({
      error: '只有工作區 owner 或 admin 可以查看活動記錄。 Only workspace owners or admins can view activity.'
    })
  })

  it('fails closed without exposing D1 details when the activity ledger cannot be read', async () => {
    const owner = await registerAccount('Unavailable Activity')
    const unavailableDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('FROM workspace_activity_events')) return statement
        return {
          bind: () => ({
            all: async () => { throw new TypeError('synthetic private D1 activity failure') }
          })
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const response = await dispatch('/api/workspace-activity', {
      headers: activityHeaders(owner.cookie)
    }, { ...env, DB: unavailableDb } as Env)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      code: 'unavailable',
      error: '工作區活動暫時無法讀取。 Workspace activity is temporarily unavailable.'
    })
  })

  it('does not let child delete events block an authorized workspace cascade', async () => {
    const owner = await registerAccount('Activity Cascade')
    await seedAuditedOperations(owner)

    await expect(env.DB.prepare('DELETE FROM workspaces WHERE id = ?')
      .bind(owner.currentWorkspace.id)
      .run()).resolves.toBeDefined()

    const workspace = await env.DB.prepare('SELECT id FROM workspaces WHERE id = ?')
      .bind(owner.currentWorkspace.id)
      .first()
    const activity = await env.DB.prepare('SELECT id FROM workspace_activity_events WHERE workspace_id = ?')
      .bind(owner.currentWorkspace.id)
      .all()
    expect(workspace).toBeNull()
    expect(activity.results).toEqual([])
  })

  it('requires authentication and rejects unsupported methods', async () => {
    const anonymous = await dispatch('/api/workspace-activity')
    expect(anonymous.status).toBe(401)

    const owner = await registerAccount('Activity Method')
    const method = await dispatch('/api/workspace-activity', {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    })
    expect(method.status).toBe(405)
    expect(method.headers.get('allow')).toBe('GET')
  })
})
