import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { Env } from '../src/worker'
import type { RegisteredAccount } from './helpers'
import { dispatch, registerAccount, validPngBytes } from './helpers'

const expectedBrand = {
  name: 'Test Brand',
  tone: '簡潔、可信',
  colors: ['#155eef', '#ffffff'],
  forbiddenWords: '最平、保證',
  locale: 'zh-Hant' as const,
  cta: '立即選購',
  ctaEn: 'Shop now'
}

function approvedBrief(assetId: string) {
  return {
    assetId,
    intent: '限時優惠',
    brand: expectedBrand,
    product: {
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
  }
}

async function approveBrand(account: RegisteredAccount) {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(validPngBytes()).buffer], 'private-brand-source.png', { type: 'image/png' }))
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

function saveBrand(cookie: string, approvedRevision: number, extra: Record<string, unknown> = {}) {
  return dispatch('/api/brand-packs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: 'https://app.test' },
    body: JSON.stringify({ approvedRevision, ...extra })
  })
}

describe('private approved brand library', () => {
  it('saves one approved snapshot idempotently and returns only the current workspace list', async () => {
    const owner = await registerAccount('Brand Library Owner')
    const otherOwner = await registerAccount('Other Brand Library')
    const revision = await approveBrand(owner)

    const created = await saveBrand(owner.cookie, revision)
    expect(created.status).toBe(201)
    expect(created.headers.get('cache-control')).toBe('no-store')
    const createdPayload = await created.json() as {
      brandPack: Record<string, unknown>
      replayed: boolean
    }
    expect(Object.keys(createdPayload).sort()).toEqual(['brandPack', 'replayed'])
    expect(createdPayload.replayed).toBe(false)
    expect(Object.keys(createdPayload.brandPack).sort()).toEqual([
      'approvedRevision',
      'colors',
      'createdAt',
      'cta',
      'ctaEn',
      'forbiddenWords',
      'id',
      'locale',
      'name',
      'tone'
    ])
    expect(createdPayload.brandPack).toMatchObject({ ...expectedBrand, approvedRevision: revision })
    expect(createdPayload.brandPack.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(createdPayload.brandPack.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)

    const replay = await saveBrand(owner.cookie, revision)
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toEqual({ ...createdPayload, replayed: true })

    const ownList = await dispatch('/api/brand-packs', { headers: { cookie: owner.cookie } })
    expect(ownList.status).toBe(200)
    const raw = await ownList.text()
    expect(JSON.parse(raw)).toEqual({ brandPacks: [createdPayload.brandPack] })
    expect(raw).not.toContain(owner.currentWorkspace.id)
    expect(raw).not.toContain(owner.user.id)
    expect(raw).not.toContain('snapshot_sha256')

    const otherList = await dispatch('/api/brand-packs', { headers: { cookie: otherOwner.cookie } })
    await expect(otherList.json()).resolves.toEqual({ brandPacks: [] })
  })

  it('requires a current approved revision and rejects malformed mutations before writing', async () => {
    const owner = await registerAccount('Strict Brand Library')

    const unapproved = await saveBrand(owner.cookie, 1)
    expect(unapproved.status).toBe(409)

    for (const body of [
      { approvedRevision: 0 },
      { approvedRevision: 1.5 },
      { approvedRevision: '1' },
      { approvedRevision: true },
      { approvedRevision: 1, unexpected: true }
    ]) {
      const response = await dispatch('/api/brand-packs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
        body: JSON.stringify(body)
      })
      expect(response.status).toBe(400)
    }

    const wrongMediaType = await dispatch('/api/brand-packs', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ approvedRevision: 1 })
    })
    expect(wrongMediaType.status).toBe(415)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM brand_packs WHERE workspace_id = ?')
      .bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it('deletes only one workspace-scoped snapshot and leaves cross-workspace requests undisclosed', async () => {
    const owner = await registerAccount('Brand Delete Owner')
    const otherOwner = await registerAccount('Other Brand Delete')
    const revision = await approveBrand(owner)
    const created = await saveBrand(owner.cookie, revision)
    const { brandPack } = await created.json() as { brandPack: { id: string } }

    const crossWorkspace = await dispatch(`/api/brand-packs/${brandPack.id}`, {
      method: 'DELETE',
      headers: { cookie: otherOwner.cookie, origin: 'https://app.test' }
    })
    expect(crossWorkspace.status).toBe(404)

    const deleted = await dispatch(`/api/brand-packs/${brandPack.id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    })
    expect(deleted.status).toBe(204)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM brand_packs WHERE workspace_id = ?')
      .bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })

    const alreadyAbsent = await dispatch(`/api/brand-packs/${brandPack.id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    })
    expect(alreadyAbsent.status).toBe(404)
  })

  it('fails closed on a list read error and enforces authentication and collection methods', async () => {
    const owner = await registerAccount('Unavailable Brand Library')
    const unavailableDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('FROM brand_packs')) return statement
        return {
          bind: () => ({
            all: async () => { throw new TypeError('synthetic private brand list failure') }
          })
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const unavailable = await dispatch('/api/brand-packs', {
      headers: { cookie: owner.cookie }
    }, { ...env, DB: unavailableDb } as Env)
    expect(unavailable.status).toBe(503)
    await expect(unavailable.json()).resolves.toEqual({
      code: 'unavailable',
      error: '私人品牌資料暫時無法讀取。 Private brand library is temporarily unavailable.'
    })

    expect((await dispatch('/api/brand-packs')).status).toBe(401)
    const unsupported = await dispatch('/api/brand-packs', {
      method: 'PUT',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    })
    expect(unsupported.status).toBe(405)
    expect(unsupported.headers.get('allow')).toBe('GET, POST')
  })
})
