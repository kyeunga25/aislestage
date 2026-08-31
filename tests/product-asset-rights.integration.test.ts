import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { Env } from '../src/worker'
import { dispatch, generationInput, registerAccount, validPngBytes } from './helpers'

const rightsAttestation = 'commercial-use-v1'

function productUploadForm(options: {
  attestation?: string | null
  duplicateAttestation?: boolean
  unexpectedField?: boolean
} = {}) {
  const form = new FormData()
  form.set('file', new File([validPngBytes()], 'private-product-name.png', { type: 'image/png' }))
  if (options.attestation !== null) form.set('rightsAttestation', options.attestation ?? rightsAttestation)
  if (options.duplicateAttestation) form.append('rightsAttestation', rightsAttestation)
  if (options.unexpectedField) form.set('privateNote', 'must-not-be-stored')
  return form
}

async function uploadProductSource(cookie: string, options: Parameters<typeof productUploadForm>[0] = {}) {
  return dispatch('/api/assets/product', {
    method: 'POST',
    headers: {
      cookie,
      origin: 'https://app.test',
      'idempotency-key': crypto.randomUUID()
    },
    body: productUploadForm(options)
  })
}

function confirmRights(cookie: string, assetId: string, body: unknown = { attestation: rightsAttestation }) {
  return dispatch(`/api/assets/${assetId}/rights`, {
    method: 'POST',
    headers: { cookie, origin: 'https://app.test', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function campaignBrief(assetId: string) {
  const input = generationInput('unused-workspace', assetId)
  return {
    assetId,
    intent: input.intent,
    brand: input.brand,
    product: input.product
  }
}

describe('product-source commercial-use rights', () => {
  it('requires one exact rights attestation before reading image bytes or writing private state', async () => {
    const owner = await registerAccount('Rights Upload Boundary')
    const cases = [
      productUploadForm({ attestation: null }),
      productUploadForm({ attestation: 'commercial-use-v2' }),
      productUploadForm({ duplicateAttestation: true }),
      productUploadForm({ unexpectedField: true })
    ]

    for (const form of cases) {
      const response = await dispatch('/api/assets/product', {
        method: 'POST',
        headers: {
          cookie: owner.cookie,
          origin: 'https://app.test',
          'idempotency-key': crypto.randomUUID()
        },
        body: form
      })
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/使用權|rights/i) })
    }

    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?')
      .bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
    expect((await env.MEDIA_BUCKET.list({ prefix: `workspaces/${owner.currentWorkspace.id}/assets/product-source/` })).objects).toHaveLength(0)
  })

  it('stores an immutable versioned attestation without returning actor or storage identity', async () => {
    const owner = await registerAccount('Rights Audit Record')
    const otherOwner = await registerAccount('Rights Audit Other Workspace')
    const uploaded = await uploadProductSource(owner.cookie)

    expect(uploaded.status).toBe(201)
    const raw = await uploaded.text()
    const payload = JSON.parse(raw) as { asset: { id: string; rightsStatus: string } }
    expect(payload.asset.rightsStatus).toBe('confirmed')
    expect(raw).not.toContain(owner.user.id)
    expect(raw).not.toContain(owner.currentWorkspace.id)
    expect(raw).not.toContain('commercial-use-v1')

    const stored = await env.DB.prepare(`
      SELECT workspace_id AS workspaceId, confirmed_by_user_id AS confirmedByUserId,
        attestation_version AS attestationVersion,
        strftime('%Y-%m-%dT%H:%M:%SZ', confirmed_at) AS confirmedAt
      FROM product_asset_rights_attestations
      WHERE asset_id = ?
    `).bind(payload.asset.id).first<{
      workspaceId: string
      confirmedByUserId: string
      attestationVersion: string
      confirmedAt: string
    }>()
    expect(stored).toEqual({
      workspaceId: owner.currentWorkspace.id,
      confirmedByUserId: owner.user.id,
      attestationVersion: rightsAttestation,
      confirmedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    })

    await expect(env.DB.prepare(`
      UPDATE product_asset_rights_attestations
      SET attestation_version = 'commercial-use-v2'
      WHERE asset_id = ?
    `).bind(payload.asset.id).run()).rejects.toThrow()
    await env.DB.prepare('DELETE FROM product_asset_rights_attestations WHERE asset_id = ?').bind(payload.asset.id).run()
    await expect(env.DB.prepare(`
      INSERT INTO product_asset_rights_attestations (
        asset_id, workspace_id, confirmed_by_user_id, attestation_version
      ) VALUES (?, ?, ?, ?)
    `).bind(
      payload.asset.id,
      otherOwner.currentWorkspace.id,
      otherOwner.user.id,
      rightsAttestation
    ).run()).rejects.toThrow()
  })

  it('lists legacy sources as unconfirmed and confirms one workspace asset idempotently', async () => {
    const owner = await registerAccount('Legacy Rights Confirmation')
    const otherOwner = await registerAccount('Other Rights Workspace')
    const uploaded = await uploadProductSource(owner.cookie)
    const { asset } = await uploaded.json() as { asset: { id: string } }
    await env.DB.prepare('DELETE FROM product_asset_rights_attestations WHERE asset_id = ?').bind(asset.id).run()

    const list = await dispatch('/api/assets/product', { headers: { cookie: owner.cookie } })
    expect(list.status).toBe(200)
    await expect(list.json()).resolves.toMatchObject({
      assets: [{ id: asset.id, rightsStatus: 'unconfirmed' }]
    })

    const crossWorkspace = await confirmRights(otherOwner.cookie, asset.id)
    expect(crossWorkspace.status).toBe(404)

    const first = await confirmRights(owner.cookie, asset.id)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({
      asset: { id: asset.id, rightsStatus: 'confirmed' },
      replayed: false
    })
    const replay = await confirmRights(owner.cookie, asset.id)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({
      asset: { id: asset.id, rightsStatus: 'confirmed' },
      replayed: true
    })

    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM product_asset_rights_attestations WHERE asset_id = ?')
      .bind(asset.id).first()).toEqual({ count: 1 })
  })

  it('rejects malformed, oversized, wrong-media-type, and unsupported rights mutations', async () => {
    const owner = await registerAccount('Rights Mutation Boundary')
    const uploaded = await uploadProductSource(owner.cookie)
    const { asset } = await uploaded.json() as { asset: { id: string } }
    await env.DB.prepare('DELETE FROM product_asset_rights_attestations WHERE asset_id = ?').bind(asset.id).run()

    for (const body of [
      {},
      { attestation: 'commercial-use-v2' },
      { attestation: rightsAttestation, unexpected: true },
      { attestation: [rightsAttestation] }
    ]) {
      expect((await confirmRights(owner.cookie, asset.id, body)).status).toBe(400)
    }

    const wrongMedia = await dispatch(`/api/assets/${asset.id}/rights`, {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: 'https://app.test', 'content-type': 'text/plain' },
      body: rightsAttestation
    })
    expect(wrongMedia.status).toBe(415)

    const oversized = await dispatch(`/api/assets/${asset.id}/rights`, {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: 'https://app.test', 'content-type': 'application/json' },
      body: JSON.stringify({ attestation: rightsAttestation, padding: 'x'.repeat(2048) })
    })
    expect(oversized.status).toBe(413)

    const unsupported = await dispatch(`/api/assets/${asset.id}/rights`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    })
    expect(unsupported.status).toBe(405)
    expect(unsupported.headers.get('allow')).toBe('POST')
  })

  it('reconciles a rights insert that commits before D1 reports its response', async () => {
    const owner = await registerAccount('Ambiguous Rights Confirmation')
    const uploaded = await uploadProductSource(owner.cookie)
    const { asset } = await uploaded.json() as { asset: { id: string } }
    await env.DB.prepare('DELETE FROM product_asset_rights_attestations WHERE asset_id = ?').bind(asset.id).run()
    const ambiguousDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('INSERT INTO product_asset_rights_attestations')) return statement
        return {
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values)
            return {
              run: async () => {
                await bound.run()
                throw new TypeError('synthetic response failure after rights commit')
              }
            }
          }
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const response = await dispatch(`/api/assets/${asset.id}/rights`, {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: 'https://app.test', 'content-type': 'application/json' },
      body: JSON.stringify({ attestation: rightsAttestation })
    }, { ...env, DB: ambiguousDb } as Env)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      asset: { id: asset.id, rightsStatus: 'confirmed' },
      replayed: true
    })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM product_asset_rights_attestations WHERE asset_id = ?')
      .bind(asset.id).first()).toEqual({ count: 1 })
  })

  it('prevents planning and generation after an attestation is absent', async () => {
    const owner = await registerAccount('Rights Generation Fence')
    const uploaded = await uploadProductSource(owner.cookie)
    const { asset } = await uploaded.json() as { asset: { id: string } }
    await env.DB.prepare('DELETE FROM product_asset_rights_attestations WHERE asset_id = ?').bind(asset.id).run()

    const rejectedPlan = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: 'https://app.test', 'content-type': 'application/json' },
      body: JSON.stringify({ brief: campaignBrief(asset.id) })
    })
    expect(rejectedPlan.status).toBe(409)
    await expect(rejectedPlan.json()).resolves.toMatchObject({ error: expect.stringMatching(/使用權|rights/i) })

    expect((await confirmRights(owner.cookie, asset.id)).status).toBe(200)
    const planned = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: 'https://app.test', 'content-type': 'application/json' },
      body: JSON.stringify({ brief: campaignBrief(asset.id) })
    })
    const { state } = await planned.json() as { state: { revision: number } }
    expect(planned.status).toBe(200)
    expect((await dispatch('/api/campaign-agent/approve', {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: 'https://app.test', 'content-type': 'application/json' },
      body: JSON.stringify({ revision: state.revision })
    })).status).toBe(200)

    await env.DB.prepare('DELETE FROM product_asset_rights_attestations WHERE asset_id = ?').bind(asset.id).run()
    const reconciledState = await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } })
    expect(reconciledState.status).toBe(200)
    await expect(reconciledState.json()).resolves.toMatchObject({
      state: { stage: 'idle', revision: 0, brief: null }
    })
    const generation = await dispatch('/api/generations', {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: 'https://app.test', 'content-type': 'application/json' },
      body: JSON.stringify(generationInput(owner.currentWorkspace.id, asset.id, state.revision))
    })
    expect(generation.status).toBe(409)
    await expect(generation.json()).resolves.toMatchObject({ error: expect.stringMatching(/使用權|rights/i) })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM generations WHERE workspace_id = ?')
      .bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
  })
})
