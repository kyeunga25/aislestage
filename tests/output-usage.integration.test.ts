import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { Env } from '../src/worker'
import { dispatch, registerAccount } from './helpers'

async function insertUsageEvent(options: {
  workspaceId: string
  generationId: string
  type: 'reservation' | 'settlement' | 'release'
  amount: -1 | 0 | 1
  createdAt: string
  note: string
  providerEventId: string
}) {
  await env.DB.prepare(`
    INSERT INTO output_ledger (
      id, workspace_id, generation_id, event_type, amount,
      provider_event_id, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    options.workspaceId,
    options.generationId,
    options.type,
    options.amount,
    options.providerEventId,
    options.note,
    options.createdAt
  ).run()
}

describe('workspace output usage dashboard API', () => {
  it('returns current allowance and public-safe recent events for only the current workspace', async () => {
    const owner = await registerAccount('Usage Owner')
    const otherOwner = await registerAccount('Other Usage Owner')
    const privateGenerationIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]

    await insertUsageEvent({
      workspaceId: owner.currentWorkspace.id,
      generationId: privateGenerationIds[0],
      type: 'reservation',
      amount: -1,
      createdAt: '2026-08-30 05:00:00',
      note: 'private reservation detail',
      providerEventId: 'private-provider-reservation'
    })
    await insertUsageEvent({
      workspaceId: owner.currentWorkspace.id,
      generationId: privateGenerationIds[1],
      type: 'settlement',
      amount: 0,
      createdAt: '2026-08-30 05:05:00',
      note: 'private settlement detail',
      providerEventId: 'private-provider-settlement'
    })
    await insertUsageEvent({
      workspaceId: owner.currentWorkspace.id,
      generationId: privateGenerationIds[2],
      type: 'release',
      amount: 1,
      createdAt: '2026-08-30 05:06:00',
      note: 'private release detail',
      providerEventId: 'private-provider-release'
    })
    await insertUsageEvent({
      workspaceId: otherOwner.currentWorkspace.id,
      generationId: crypto.randomUUID(),
      type: 'reservation',
      amount: -1,
      createdAt: '2026-08-30 05:07:00',
      note: 'other workspace detail',
      providerEventId: 'other-provider-reservation'
    })

    const response = await dispatch('/api/output-usage', { headers: { cookie: owner.cookie } })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const raw = await response.text()
    const payload = JSON.parse(raw) as {
      allowance: { availableOutputs: number; reservedOutputs: number; updatedAt: string }
      summary: { completedOutputs: number; releasedOutputs: number }
      events: Array<{ type: string; amount: number; createdAt: string }>
    }

    expect(Object.keys(payload).sort()).toEqual(['allowance', 'events', 'summary'])
    expect(Object.keys(payload.allowance).sort()).toEqual(['availableOutputs', 'reservedOutputs', 'updatedAt'])
    expect(Object.keys(payload.summary).sort()).toEqual(['completedOutputs', 'releasedOutputs'])
    expect(payload.allowance).toMatchObject({ availableOutputs: 3, reservedOutputs: 0 })
    expect(payload.summary).toEqual({ completedOutputs: 1, releasedOutputs: 1 })
    expect(payload.events).toEqual([
      { type: 'release', amount: 1, createdAt: '2026-08-30T05:06:00Z' },
      { type: 'settlement', amount: 0, createdAt: '2026-08-30T05:05:00Z' },
      { type: 'reservation', amount: -1, createdAt: '2026-08-30T05:00:00Z' }
    ])
    expect(payload.events.every((event) => Object.keys(event).sort().join(',') === 'amount,createdAt,type')).toBe(true)
    expect(raw).not.toContain(owner.currentWorkspace.id)
    expect(raw).not.toContain(otherOwner.currentWorkspace.id)
    privateGenerationIds.forEach((id) => expect(raw).not.toContain(id))
    expect(raw).not.toContain('private reservation detail')
    expect(raw).not.toContain('private-provider')
    expect(raw).not.toContain('other workspace detail')
  })

  it('keeps usage workspace-scoped and available to an active workspace member', async () => {
    const account = await registerAccount('Usage Member')
    await env.DB.prepare(`
      UPDATE workspace_memberships SET role = 'member'
      WHERE workspace_id = ? AND user_id = ?
    `).bind(account.currentWorkspace.id, account.user.id).run()

    const response = await dispatch('/api/output-usage', { headers: { cookie: account.cookie } })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      allowance: { availableOutputs: 3, reservedOutputs: 0 },
      summary: { completedOutputs: 0, releasedOutputs: 0 },
      events: []
    })
  })

  it('bounds the recent event timeline to 50 canonical rows', async () => {
    const owner = await registerAccount('Bounded Usage')
    await env.DB.batch(Array.from({ length: 51 }, (_, index) => env.DB.prepare(`
      INSERT INTO output_ledger (
        id, workspace_id, generation_id, event_type, amount, note, created_at
      ) VALUES (?, ?, ?, 'reservation', -1, 'synthetic bounded event', datetime('2026-08-30 05:00:00', ?))
    `).bind(
      crypto.randomUUID(),
      owner.currentWorkspace.id,
      crypto.randomUUID(),
      `+${index} seconds`
    )))

    const response = await dispatch('/api/output-usage', { headers: { cookie: owner.cookie } })
    expect(response.status).toBe(200)
    const payload = await response.json() as { events: Array<{ type: string; amount: number; createdAt: string }> }
    expect(payload.events).toHaveLength(50)
    expect(payload.events[0]).toMatchObject({ type: 'reservation', amount: -1, createdAt: '2026-08-30T05:00:50Z' })
    expect(payload.events.at(-1)).toMatchObject({ type: 'reservation', amount: -1, createdAt: '2026-08-30T05:00:01Z' })
  })

  it('fails closed without exposing D1 details when the transactional usage snapshot is unreadable', async () => {
    const owner = await registerAccount('Unavailable Usage')
    const unavailableDb = {
      prepare: env.DB.prepare.bind(env.DB),
      batch: async () => { throw new TypeError('synthetic private usage batch failure') }
    } as unknown as typeof env.DB

    const response = await dispatch('/api/output-usage', {
      headers: { cookie: owner.cookie }
    }, { ...env, DB: unavailableDb } as Env)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      code: 'unavailable',
      error: '工作區用量暫時無法讀取。 Workspace usage is temporarily unavailable.'
    })

    await env.DB.prepare('DELETE FROM output_allowances WHERE workspace_id = ?')
      .bind(owner.currentWorkspace.id).run()
    const missingAllowance = await dispatch('/api/output-usage', { headers: { cookie: owner.cookie } })
    expect(missingAllowance.status).toBe(503)
    await expect(missingAllowance.json()).resolves.toEqual({
      code: 'unavailable',
      error: '工作區用量暫時無法讀取。 Workspace usage is temporarily unavailable.'
    })
  })

  it('does not publish a partial snapshot when a known ledger event has an invalid amount', async () => {
    const owner = await registerAccount('Invalid Usage Amount')
    await env.DB.prepare(`
      INSERT INTO output_ledger (
        id, workspace_id, generation_id, event_type, amount, note
      ) VALUES (?, ?, ?, 'reservation', 1, 'synthetic invalid amount')
    `).bind(crypto.randomUUID(), owner.currentWorkspace.id, crypto.randomUUID()).run()

    const response = await dispatch('/api/output-usage', { headers: { cookie: owner.cookie } })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      code: 'unavailable',
      error: '工作區用量暫時無法讀取。 Workspace usage is temporarily unavailable.'
    })
  })

  it('requires authentication and rejects unsupported methods', async () => {
    expect((await dispatch('/api/output-usage')).status).toBe(401)

    const owner = await registerAccount('Usage Method')
    const unsupported = await dispatch('/api/output-usage', {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    })
    expect(unsupported.status).toBe(405)
    expect(unsupported.headers.get('allow')).toBe('GET')
  })
})
