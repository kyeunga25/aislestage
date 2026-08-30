import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { Env } from '../src/worker'
import { dispatch, registerAccount, validPngBytes, validWebpBytes } from './helpers'

async function uploadProductSource(
  cookie: string,
  bytes: Uint8Array,
  filename: string,
  contentType: 'image/png' | 'image/webp'
) {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(bytes).buffer], filename, { type: contentType }))
  return dispatch('/api/assets/product', {
    method: 'POST',
    headers: { cookie, origin: 'https://app.test', 'idempotency-key': crypto.randomUUID() },
    body: form
  })
}

describe('private product-source library', () => {
  it('returns only the current workspace verified sources without original names or storage identity', async () => {
    const owner = await registerAccount('Product Library Owner')
    const otherOwner = await registerAccount('Other Product Library')
    const firstUpload = await uploadProductSource(owner.cookie, validPngBytes(), 'private-launch-name.png', 'image/png')
    const secondUpload = await uploadProductSource(owner.cookie, validWebpBytes(), 'private-seasonal-name.webp', 'image/webp')
    await uploadProductSource(otherOwner.cookie, validPngBytes(), 'other-workspace.png', 'image/png')
    expect(firstUpload.status).toBe(201)
    expect(secondUpload.status).toBe(201)

    const response = await dispatch('/api/assets/product', { headers: { cookie: owner.cookie } })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const raw = await response.text()
    const payload = JSON.parse(raw) as { assets: Array<Record<string, unknown>> }

    expect(Object.keys(payload)).toEqual(['assets'])
    expect(payload.assets).toHaveLength(2)
    expect(payload.assets.every((asset) => Object.keys(asset).sort().join(',') === 'contentType,createdAt,heightPx,id,name,previewUrl,sizeBytes,widthPx')).toBe(true)
    expect(payload.assets.map((asset) => asset.name)).toEqual(expect.arrayContaining(['product-image.png', 'product-image.webp']))
    expect(payload.assets.every((asset) => asset.widthPx === 1 && asset.heightPx === 1)).toBe(true)
    expect(payload.assets.every((asset) => asset.previewUrl === `/api/assets/${asset.id}`)).toBe(true)
    expect(payload.assets.every((asset) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(asset.createdAt)))).toBe(true)
    expect(raw).not.toContain('private-launch-name.png')
    expect(raw).not.toContain('private-seasonal-name.webp')
    expect(raw).not.toContain('other-workspace.png')
    expect(raw).not.toContain(owner.currentWorkspace.id)
    expect(raw).not.toContain(otherOwner.currentWorkspace.id)
    expect(raw).not.toContain('object_key')
    expect(raw).not.toContain('content_sha256')
  })

  it('returns explicit unknown dimensions for a verified legacy source', async () => {
    const owner = await registerAccount('Legacy Product Library')
    const uploaded = await uploadProductSource(owner.cookie, validPngBytes(), 'legacy.png', 'image/png')
    const { asset } = await uploaded.json() as { asset: { id: string } }
    await env.DB.prepare('UPDATE media_assets SET width_px = NULL, height_px = NULL WHERE id = ?')
      .bind(asset.id)
      .run()

    const response = await dispatch('/api/assets/product', { headers: { cookie: owner.cookie } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      assets: [{ id: asset.id, widthPx: null, heightPx: null }]
    })
  })

  it('rejects partial or unsafe stored dimension pairs at the D1 boundary', async () => {
    const owner = await registerAccount('Product Dimension Constraint')
    const uploaded = await uploadProductSource(owner.cookie, validPngBytes(), 'constraint.png', 'image/png')
    const { asset } = await uploaded.json() as { asset: { id: string } }

    await expect(env.DB.prepare('UPDATE media_assets SET width_px = ?, height_px = ? WHERE id = ?')
      .bind(1024, null, asset.id)
      .run()).rejects.toThrow()
    await expect(env.DB.prepare('UPDATE media_assets SET width_px = ?, height_px = ? WHERE id = ?')
      .bind(8000, 5000, asset.id)
      .run()).rejects.toThrow()
  })

  it('fails closed without exposing D1 details when the source list cannot be read', async () => {
    const owner = await registerAccount('Unavailable Product Library')
    const unavailableDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('FROM media_assets a')) return statement
        return {
          bind: () => ({
            all: async () => { throw new TypeError('synthetic private product list failure') }
          })
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const response = await dispatch('/api/assets/product', {
      headers: { cookie: owner.cookie }
    }, { ...env, DB: unavailableDb } as Env)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      code: 'unavailable',
      error: '私人商品來源圖暫時無法讀取。 Private product sources are temporarily unavailable.'
    })
  })

  it('requires authentication and rejects unsupported collection methods', async () => {
    const anonymous = await dispatch('/api/assets/product')
    expect(anonymous.status).toBe(401)

    const owner = await registerAccount('Product Library Method')
    const unsupported = await dispatch('/api/assets/product', {
      method: 'DELETE',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    })
    expect(unsupported.status).toBe(405)
    expect(unsupported.headers.get('allow')).toBe('GET, POST')
  })
})
