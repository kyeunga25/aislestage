import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { Env } from '../src/worker'
import type { RegisteredAccount } from './helpers'
import { dispatch, registerAccount, validPngBytes } from './helpers'

const expectedProduct = {
  name: 'Test Speaker',
  nameEn: 'Test Speaker',
  category: '消費電子',
  benefits: ['12 小時播放', 'IPX5 防水'],
  benefitsEn: ['12-hour playback', 'IPX5 water resistance'],
  specifications: 'Bluetooth 5.3',
  price: 'HK$399',
  promotion: '限時免運費',
  promotionEn: 'Free delivery for a limited time',
  channels: ['Shopify', 'Instagram']
}

function approvedBrief(assetId: string) {
  return {
    assetId,
    intent: '限時優惠',
    brand: {
      name: 'Test Brand',
      tone: '簡潔、可信',
      colors: ['#155eef', '#ffffff'],
      forbiddenWords: '最平、保證',
      locale: 'zh-Hant',
      cta: '立即選購',
      ctaEn: 'Shop now'
    },
    product: expectedProduct
  }
}

async function approveProduct(account: RegisteredAccount) {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(validPngBytes()).buffer], 'private-product-source.png', { type: 'image/png' }))
  form.set('rightsAttestation', 'commercial-use-v1')
  const uploaded = await dispatch('/api/assets/product', {
    method: 'POST',
    headers: { cookie: account.cookie, origin: 'https://app.test', 'idempotency-key': crypto.randomUUID() },
    body: form
  })
  expect(uploaded.status).toBe(201)
  const { asset } = await uploaded.json() as { asset: { id: string } }

  const planned = await dispatch('/api/campaign-agent/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
    body: JSON.stringify({ brief: approvedBrief(asset.id) })
  })
  expect(planned.status).toBe(200)
  const { state } = await planned.json() as { state: { revision: number } }

  const approved = await dispatch('/api/campaign-agent/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
    body: JSON.stringify({ revision: state.revision })
  })
  expect(approved.status).toBe(200)
  return state.revision
}

function saveProduct(cookie: string, approvedRevision: number, extra: Record<string, unknown> = {}) {
  return dispatch('/api/product-profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: 'https://app.test' },
    body: JSON.stringify({ approvedRevision, ...extra })
  })
}

describe('private approved product profile library', () => {
  it('saves one approved profile idempotently and lists only the current workspace', async () => {
    const owner = await registerAccount('Product Profile Owner')
    const otherOwner = await registerAccount('Other Product Profile')
    const revision = await approveProduct(owner)

    const created = await saveProduct(owner.cookie, revision)
    expect(created.status).toBe(201)
    expect(created.headers.get('cache-control')).toBe('no-store')
    const createdPayload = await created.json() as { productProfile: Record<string, unknown>; replayed: boolean }
    expect(Object.keys(createdPayload).sort()).toEqual(['productProfile', 'replayed'])
    expect(createdPayload.replayed).toBe(false)
    expect(Object.keys(createdPayload.productProfile).sort()).toEqual([
      'approvedRevision', 'benefits', 'benefitsEn', 'category', 'channels', 'createdAt',
      'id', 'name', 'nameEn', 'price', 'promotion', 'promotionEn', 'specifications'
    ])
    expect(createdPayload.productProfile).toMatchObject({ ...expectedProduct, approvedRevision: revision })
    expect(createdPayload.productProfile.id).toMatch(/^[0-9a-f-]{36}$/i)

    const replay = await saveProduct(owner.cookie, revision)
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toEqual({ ...createdPayload, replayed: true })

    const list = await dispatch('/api/product-profiles', { headers: { cookie: owner.cookie } })
    const raw = await list.text()
    expect(JSON.parse(raw)).toEqual({ productProfiles: [createdPayload.productProfile] })
    expect(raw).not.toContain(owner.currentWorkspace.id)
    expect(raw).not.toContain(owner.user.id)
    expect(raw).not.toContain('snapshot_sha256')
    expect(raw).not.toContain('assetId')
    expect(raw).not.toContain('brand')

    const otherList = await dispatch('/api/product-profiles', { headers: { cookie: otherOwner.cookie } })
    await expect(otherList.json()).resolves.toEqual({ productProfiles: [] })
  })

  it('requires a current approved revision and rejects malformed mutations before writing', async () => {
    const owner = await registerAccount('Strict Product Profile')
    expect((await saveProduct(owner.cookie, 1)).status).toBe(409)

    for (const body of [
      { approvedRevision: 0 },
      { approvedRevision: 1.5 },
      { approvedRevision: '1' },
      { approvedRevision: true },
      { approvedRevision: 1, unexpected: true }
    ]) {
      const response = await dispatch('/api/product-profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
        body: JSON.stringify(body)
      })
      expect(response.status).toBe(400)
    }

    const wrongMediaType = await dispatch('/api/product-profiles', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ approvedRevision: 1 })
    })
    expect(wrongMediaType.status).toBe(415)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM products WHERE workspace_id = ?')
      .bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it('fails closed when a stored product snapshot no longer matches its canonical digest', async () => {
    const owner = await registerAccount('Product Profile Integrity')
    const revision = await approveProduct(owner)
    const created = await saveProduct(owner.cookie, revision)
    expect(created.status).toBe(201)
    const { productProfile } = await created.json() as { productProfile: { id: string } }

    await env.DB.prepare('UPDATE products SET promotion = ? WHERE id = ? AND workspace_id = ?')
      .bind('Synthetic drift', productProfile.id, owner.currentWorkspace.id)
      .run()

    const list = await dispatch('/api/product-profiles', { headers: { cookie: owner.cookie } })
    expect(list.status).toBe(503)
    await expect(list.json()).resolves.toEqual({
      code: 'unavailable',
      error: '私人商品資料暫時無法讀取。 Private product library is temporarily unavailable.'
    })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM products WHERE workspace_id = ?')
      .bind(owner.currentWorkspace.id).first()).toEqual({ count: 1 })
  })

  it('deletes only one workspace-scoped product profile', async () => {
    const owner = await registerAccount('Product Profile Delete')
    const otherOwner = await registerAccount('Other Product Delete')
    const revision = await approveProduct(owner)
    const created = await saveProduct(owner.cookie, revision)
    const { productProfile } = await created.json() as { productProfile: { id: string } }

    const crossWorkspace = await dispatch(`/api/product-profiles/${productProfile.id}`, {
      method: 'DELETE', headers: { cookie: otherOwner.cookie, origin: 'https://app.test' }
    })
    expect(crossWorkspace.status).toBe(404)

    const deleted = await dispatch(`/api/product-profiles/${productProfile.id}`, {
      method: 'DELETE', headers: { cookie: owner.cookie, origin: 'https://app.test' }
    })
    expect(deleted.status).toBe(204)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM products WHERE workspace_id = ?')
      .bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })

    const absent = await dispatch(`/api/product-profiles/${productProfile.id}`, {
      method: 'DELETE', headers: { cookie: owner.cookie, origin: 'https://app.test' }
    })
    expect(absent.status).toBe(404)
  })

  it('fails closed on list read errors and enforces authentication and methods', async () => {
    const owner = await registerAccount('Unavailable Product Profiles')
    const unavailableDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('FROM products')) return statement
        return { bind: () => ({ all: async () => { throw new TypeError('synthetic private product list failure') } }) }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const unavailable = await dispatch('/api/product-profiles', { headers: { cookie: owner.cookie } }, { ...env, DB: unavailableDb } as Env)
    expect(unavailable.status).toBe(503)
    await expect(unavailable.json()).resolves.toEqual({
      code: 'unavailable',
      error: '私人商品資料暫時無法讀取。 Private product library is temporarily unavailable.'
    })

    expect((await dispatch('/api/product-profiles')).status).toBe(401)
    const unsupported = await dispatch('/api/product-profiles', {
      method: 'PUT', headers: { cookie: owner.cookie, origin: 'https://app.test' }
    })
    expect(unsupported.status).toBe(405)
    expect(unsupported.headers.get('allow')).toBe('GET, POST')
  })
})
