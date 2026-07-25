import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { dispatch, registerAccount } from './helpers'

function validBrief(assetId: string) {
  return {
    assetId,
    intent: '限時優惠',
    brand: {
      name: 'Test Brand',
      tone: '簡潔、可信',
      colors: ['#155eef'],
      forbiddenWords: '最平、保證',
      locale: 'zh-Hant',
      cta: '立即選購',
      ctaEn: 'Shop now'
    },
    product: {
      name: 'Test Speaker',
      nameEn: 'Test Speaker',
      category: '消費電子',
      benefits: ['12 小時播放', 'IPX5 防水', 'USB-C 充電'],
      benefitsEn: ['12-hour playback', 'IPX5 water resistance', 'USB-C charging'],
      specifications: 'Bluetooth 5.3',
      price: 'HK$399',
      promotion: '限時免運費',
      promotionEn: 'Free delivery for a limited time',
      channels: ['Shopify', 'Instagram']
    }
  }
}

async function uploadPng(cookie: string, name = 'speaker.png') {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
  const form = new FormData()
  form.set('file', new File([bytes], name, { type: 'image/png' }))
  return dispatch('/api/assets/product', {
    method: 'POST',
    headers: { cookie, origin: 'https://app.test' },
    body: form
  })
}

describe('private product assets', () => {
  it('validates, stores and privately serves a workspace product image', async () => {
    const owner = await registerAccount('Asset Owner')
    const uploaded = await uploadPng(owner.cookie)
    expect(uploaded.status).toBe(201)
    const payload = await uploaded.json() as { asset: { id: string; previewUrl: string; contentType: string; sizeBytes: number } }
    expect(payload.asset).toMatchObject({ contentType: 'image/png', sizeBytes: 12 })

    const preview = await dispatch(payload.asset.previewUrl, { headers: { cookie: owner.cookie } })
    expect(preview.status).toBe(200)
    expect(preview.headers.get('cache-control')).toBe('private, max-age=300')
    expect(new Uint8Array(await preview.arrayBuffer()).slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))

    const otherOwner = await registerAccount('Other Asset Owner')
    const forbidden = await dispatch(payload.asset.previewUrl, { headers: { cookie: otherOwner.cookie } })
    expect(forbidden.status).toBe(404)
    const forbiddenDelete = await dispatch(payload.asset.previewUrl, { method: 'DELETE', headers: { cookie: otherOwner.cookie, origin: 'https://app.test' } })
    expect(forbiddenDelete.status).toBe(404)
  })

  it('rejects an allowlisted MIME type when the file signature does not match', async () => {
    const owner = await registerAccount('Invalid Asset')
    const form = new FormData()
    form.set('file', new File(['not-a-png'], 'fake.png', { type: 'image/png' }))
    const response = await dispatch('/api/assets/product', { method: 'POST', headers: { cookie: owner.cookie, origin: 'https://app.test' }, body: form })
    expect(response.status).toBe(415)
  })

  it('rejects image metadata that could leak hidden location or author details', async () => {
    const owner = await registerAccount('Metadata Asset')
    const bytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 0, 101, 88, 73, 102, 0, 0, 0, 0
    ])
    const form = new FormData()
    form.set('file', new File([bytes], 'private-details.png', { type: 'image/png' }))

    const response = await dispatch('/api/assets/product', { method: 'POST', headers: { cookie: owner.cookie, origin: 'https://app.test' }, body: form })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('metadata') })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it('deletes one explicit private product asset and resets its Agent plan', async () => {
    const owner = await registerAccount('Delete Asset')
    const uploaded = await uploadPng(owner.cookie, 'delete-me.png')
    const { asset } = await uploaded.json() as { asset: { id: string; previewUrl: string } }
    await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief: validBrief(asset.id) })
    })

    const deleted = await dispatch(asset.previewUrl, { method: 'DELETE', headers: { cookie: owner.cookie, origin: 'https://app.test' } })
    expect(deleted.status).toBe(204)
    expect(await dispatch(asset.previewUrl, { headers: { cookie: owner.cookie } }).then((response) => response.status)).toBe(404)
    expect(await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } }).then((response) => response.json())).toMatchObject({ state: { stage: 'idle', revision: 0 } })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE id = ?').bind(asset.id).first()).toEqual({ count: 0 })
  })
})

describe('workspace Campaign Agent', () => {
  it('keeps the plan workspace-scoped and requires the current revision for approval', async () => {
    const owner = await registerAccount('Agent Owner')
    const uploaded = await uploadPng(owner.cookie, 'agent-speaker.png')
    const { asset } = await uploaded.json() as { asset: { id: string } }

    const planned = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief: validBrief(asset.id) })
    })
    expect(planned.status).toBe(200)
    const planPayload = await planned.json() as { state: { stage: string; revision: number; mode: string; plan: Array<{ ratio: string }> } }
    expect(planPayload.state).toMatchObject({ stage: 'awaiting-approval', revision: 1, mode: 'deterministic' })
    expect(planPayload.state.plan.map((item) => item.ratio)).toEqual(['1:1', '4:5', '9:16'])

    const staleApproval = await dispatch('/api/campaign-agent/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ revision: 0 })
    })
    expect(staleApproval.status).toBe(409)

    const approved = await dispatch('/api/campaign-agent/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ revision: 1 })
    })
    expect(approved.status).toBe(200)
    expect(await approved.json()).toMatchObject({ state: { stage: 'approved', revision: 1 } })

    const otherOwner = await registerAccount('Other Agent Owner')
    const otherState = await dispatch('/api/campaign-agent', { headers: { cookie: otherOwner.cookie } })
    expect(otherState.status).toBe(200)
    expect(await otherState.json()).toMatchObject({ state: { stage: 'idle', revision: 0 } })
  })

  it('refuses approval until missing commercial facts and the product asset are supplied', async () => {
    const owner = await registerAccount('Incomplete Agent Brief')
    const incompleteBrief = validBrief('')
    const planned = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief: { ...incompleteBrief, assetId: null, product: { ...incompleteBrief.product, price: '', benefits: [] } } })
    })
    expect(planned.status).toBe(200)
    expect(await planned.json()).toMatchObject({ state: { stage: 'needs-input' } })

    const approval = await dispatch('/api/campaign-agent/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ revision: 1 })
    })
    expect(approval.status).toBe(409)
  })

  it('only queues output that matches the currently approved brief and revision', async () => {
    const owner = await registerAccount('Approved Output')
    const uploaded = await uploadPng(owner.cookie, 'approved-speaker.png')
    const { asset } = await uploaded.json() as { asset: { id: string } }
    const brief = validBrief(asset.id)
    const planned = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief })
    })
    const { state } = await planned.json() as { state: { revision: number } }
    await dispatch('/api/campaign-agent/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ revision: state.revision })
    })
    const input = {
      workspaceId: owner.currentWorkspace.id,
      workflowId: 'store-main',
      aspectRatio: '1:1',
      approvedRevision: state.revision,
      intent: brief.intent,
      brand: brief.brand,
      product: brief.product,
      referenceImageUrls: [],
      referenceAssetIds: [asset.id]
    }

    const stale = await dispatch('/api/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ ...input, approvedRevision: state.revision + 1 })
    })
    expect(stale.status).toBe(409)

    const changed = await dispatch('/api/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ ...input, product: { ...input.product, price: 'HK$1' } })
    })
    expect(changed.status).toBe(409)

    const accepted = await dispatch('/api/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify(input)
    })
    expect(accepted.status).toBe(202)
  })
})
