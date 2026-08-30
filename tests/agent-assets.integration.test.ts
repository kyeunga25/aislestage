import { env } from 'cloudflare:workers'
import { getAgentByName } from 'agents'
import { describe, expect, it } from 'vitest'
import { dispatch, registerAccount, validPngBytes, validWebpBytes } from './helpers'

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

async function uploadImage(
  cookie: string,
  bytes: Uint8Array,
  name: string,
  contentType: 'image/png' | 'image/jpeg' | 'image/webp',
  envOverride = env,
  idempotencyKey = crypto.randomUUID()
) {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(bytes).buffer], name, { type: contentType }))
  form.set('rightsAttestation', 'commercial-use-v1')
  return dispatch('/api/assets/product', {
    method: 'POST',
    headers: { cookie, origin: 'https://app.test', 'idempotency-key': idempotencyKey },
    body: form
  }, envOverride)
}

async function uploadPng(cookie: string, name = 'speaker.png', envOverride = env, idempotencyKey = crypto.randomUUID()) {
  return uploadImage(cookie, validPngBytes(), name, 'image/png', envOverride, idempotencyKey)
}

async function uploadWebp(cookie: string, bytes = validWebpBytes(), name = 'product.webp') {
  return uploadImage(cookie, bytes, name, 'image/webp')
}

async function uploadJpeg(cookie: string, bytes: Uint8Array, name = 'product.jpg') {
  return uploadImage(cookie, bytes, name, 'image/jpeg')
}

function base64Url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

const jpegScanHeader = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]
const jpegFrameHeader = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]

function writeUint32BigEndian(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

function writeUint32LittleEndian(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function joinBytes(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function pngCrc(bytes: Uint8Array, start: number, end: number) {
  let crc = 0xffffffff
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset]
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array) {
  const chunk = new Uint8Array(12 + data.byteLength)
  writeUint32BigEndian(chunk, 0, data.byteLength)
  chunk.set(Uint8Array.from(type, (character) => character.charCodeAt(0)), 4)
  chunk.set(data, 8)
  writeUint32BigEndian(chunk, 8 + data.byteLength, pngCrc(chunk, 4, 8 + data.byteLength))
  return chunk
}

function pngWithAncillaryChunk(type: string, data: Uint8Array) {
  const source = validPngBytes()
  return joinBytes([source.slice(0, 33), pngChunk(type, data), source.slice(33)])
}

function pngWithColorTypeChunks(colorType: number, beforeImageData: Uint8Array[], afterImageData: Uint8Array[] = []) {
  const source = validPngBytes()
  source[25] = colorType
  writeUint32BigEndian(source, 29, pngCrc(source, 12, 29))
  const imageDataEnd = source.byteLength - 12
  return joinBytes([
    source.slice(0, 33),
    ...beforeImageData,
    source.slice(33, imageDataEnd),
    ...afterImageData,
    source.slice(imageDataEnd)
  ])
}

function indexedPngWithPaletteEntries(entries: number, transparency?: Uint8Array) {
  const header = new Uint8Array(13)
  writeUint32BigEndian(header, 0, 1)
  writeUint32BigEndian(header, 4, 1)
  header[8] = 1
  header[9] = 3
  const palette = new Uint8Array(entries * 3)
  for (let index = 0; index < entries; index += 1) palette.set([index * 40, index * 40, index * 40], index * 3)
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('PLTE', palette),
    ...(transparency === undefined ? [] : [pngChunk('tRNS', transparency)]),
    pngChunk('IDAT', new Uint8Array([120, 156, 99, 96, 0, 0, 0, 2, 0, 1])),
    pngChunk('IEND', new Uint8Array())
  ]
  return joinBytes(parts)
}

function webpChunk(type: string, data: Uint8Array) {
  const chunk = new Uint8Array(8 + data.byteLength + (data.byteLength % 2))
  chunk.set(Uint8Array.from(type, (character) => character.charCodeAt(0)), 0)
  writeUint32LittleEndian(chunk, 4, data.byteLength)
  chunk.set(data, 8)
  return chunk
}

function extendedWebpWithTrailingChunk(trailing?: { type: string; data: Uint8Array }) {
  const source = validWebpBytes()
  const imageDataLength = source[16] + source[17] * 0x100 + source[18] * 0x10000 + source[19] * 0x1000000
  const chunks = [
    webpChunk('VP8X', new Uint8Array(10)),
    webpChunk('VP8L', source.slice(20, 20 + imageDataLength))
  ]
  if (trailing) chunks.push(webpChunk(trailing.type, trailing.data))
  const payload = joinBytes(chunks)
  const output = new Uint8Array(12 + payload.byteLength)
  output.set(Uint8Array.from('RIFF', (character) => character.charCodeAt(0)), 0)
  writeUint32LittleEndian(output, 4, output.byteLength - 8)
  output.set(Uint8Array.from('WEBP', (character) => character.charCodeAt(0)), 8)
  output.set(payload, 12)
  return output
}

function pngWithDimensions(width: number, height: number) {
  const bytes = validPngBytes()
  writeUint32BigEndian(bytes, 16, width)
  writeUint32BigEndian(bytes, 20, height)
  writeUint32BigEndian(bytes, 29, pngCrc(bytes, 12, 29))
  return bytes
}

function webpWithDimensions(width: number, height: number) {
  const bytes = validWebpBytes()
  const header = ((width - 1) | ((height - 1) << 14)) >>> 0
  bytes[21] = header & 0xff
  bytes[22] = (header >>> 8) & 0xff
  bytes[23] = (header >>> 16) & 0xff
  bytes[24] = (header >>> 24) & 0xff
  return bytes
}

function jpegWithDimensions(width: number, height: number) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x02,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    ...jpegScanHeader,
    0x11,
    0xff, 0xd9
  ])
}

describe('private product assets', () => {
  it('validates, stores and privately serves a workspace product image', async () => {
    const owner = await registerAccount('Asset Owner')
    const uploaded = await uploadPng(owner.cookie)
    expect(uploaded.status).toBe(201)
    const payload = await uploaded.json() as { asset: { id: string; previewUrl: string; contentType: string; sizeBytes: number; widthPx: number; heightPx: number } }
    expect(payload.asset).toMatchObject({ contentType: 'image/png', sizeBytes: validPngBytes().byteLength, widthPx: 1, heightPx: 1 })

    const storedAsset = await env.DB.prepare(`
      SELECT object_key AS objectKey, content_sha256 AS contentSha256, size_bytes AS sizeBytes,
        width_px AS widthPx, height_px AS heightPx
      FROM media_assets WHERE id = ?
    `).bind(payload.asset.id).first<{ objectKey: string; contentSha256: string; sizeBytes: number; widthPx: number; heightPx: number }>()
    expect(storedAsset).toMatchObject({ sizeBytes: validPngBytes().byteLength, contentSha256: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), widthPx: 1, heightPx: 1 })
    const storedObject = storedAsset ? await env.MEDIA_BUCKET.head(storedAsset.objectKey) : null
    expect(storedObject?.checksums.sha256?.byteLength).toBe(32)
    expect(base64Url(storedObject!.checksums.sha256!)).toBe(storedAsset!.contentSha256)

    const preview = await dispatch(payload.asset.previewUrl, { headers: { cookie: owner.cookie } })
    expect(preview.status).toBe(200)
    expect(preview.headers.get('cache-control')).toBe('private, no-store')
    expect(preview.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(new Uint8Array(await preview.arrayBuffer()).slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))

    const otherOwner = await registerAccount('Other Asset Owner')
    const forbidden = await dispatch(payload.asset.previewUrl, { headers: { cookie: otherOwner.cookie } })
    expect(forbidden.status).toBe(404)
    const forbiddenDelete = await dispatch(payload.asset.previewUrl, { method: 'DELETE', headers: { cookie: otherOwner.cookie, origin: 'https://app.test' } })
    expect(forbiddenDelete.status).toBe(404)
  })

  it('requires a canonical upload idempotency key before reading or storing a product image', async () => {
    const owner = await registerAccount('Asset Idempotency Required')
    const form = new FormData()
    form.set('file', new File([validPngBytes()], 'product.png', { type: 'image/png' }))
    form.set('rightsAttestation', 'commercial-use-v1')

    const response = await dispatch('/api/assets/product', {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: 'https://app.test' },
      body: form
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/idempotency/i) })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
    expect((await env.MEDIA_BUCKET.list({ prefix: `workspaces/${owner.currentWorkspace.id}/assets/product-source/` })).objects).toHaveLength(0)
  })

  it('replays the same product upload key without creating another row or object', async () => {
    const owner = await registerAccount('Asset Idempotent Replay')
    const idempotencyKey = crypto.randomUUID()

    const first = await uploadPng(owner.cookie, 'first-name.png', env, idempotencyKey)
    const replay = await uploadPng(owner.cookie, 'second-name.png', env, idempotencyKey)

    expect(first.status).toBe(201)
    expect(replay.status).toBe(201)
    const firstPayload = await first.json() as { asset: { id: string; previewUrl: string } }
    const replayPayload = await replay.json()
    expect(firstPayload.asset.id).toBe(idempotencyKey)
    expect(replayPayload).toEqual(firstPayload)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE id = ? AND workspace_id = ?')
      .bind(idempotencyKey, owner.currentWorkspace.id).first()).toEqual({ count: 1 })
    expect((await env.MEDIA_BUCKET.list({ prefix: `workspaces/${owner.currentWorkspace.id}/assets/product-source/` })).objects).toHaveLength(1)
  })

  it('does not delete a committed retry anchor when replay storage repair is unavailable', async () => {
    const owner = await registerAccount('Asset Replay Storage Failure')
    const idempotencyKey = crypto.randomUUID()
    const first = await uploadPng(owner.cookie, 'replay-anchor.png', env, idempotencyKey)
    const { asset } = await first.json() as { asset: { previewUrl: string } }
    let deleteCalls = 0
    const unavailableBucket = {
      head: async () => null,
      put: async () => { throw new TypeError('synthetic replay storage failure') },
      delete: async () => { deleteCalls += 1 }
    } as unknown as typeof env.MEDIA_BUCKET

    const replay = await uploadPng(owner.cookie, 'replay-anchor.png', { ...env, MEDIA_BUCKET: unavailableBucket }, idempotencyKey)

    expect(replay.status).toBe(503)
    expect(deleteCalls).toBe(0)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE id = ? AND workspace_id = ?')
      .bind(idempotencyKey, owner.currentWorkspace.id).first()).toEqual({ count: 1 })
    expect((await dispatch(asset.previewUrl, { headers: { cookie: owner.cookie } })).status).toBe(200)
  })

  it('allows only one canonical payload when different files race on the same upload key', async () => {
    const owner = await registerAccount('Asset Idempotent Conflict')
    const idempotencyKey = crypto.randomUUID()
    const [first, second] = await Promise.all([
      uploadImage(owner.cookie, pngWithDimensions(1, 1), 'first.png', 'image/png', env, idempotencyKey),
      uploadImage(owner.cookie, pngWithDimensions(2, 1), 'second.png', 'image/png', env, idempotencyKey)
    ])

    expect([first.status, second.status].sort()).toEqual([201, 409])
    const created = first.status === 201 ? first : second
    const conflict = first.status === 409 ? first : second
    expect(await conflict.json()).toMatchObject({ error: expect.stringMatching(/idempotency/i) })
    const { asset } = await created.json() as { asset: { id: string; previewUrl: string } }
    expect(asset.id).toBe(idempotencyKey)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE id = ? AND workspace_id = ?')
      .bind(idempotencyKey, owner.currentWorkspace.id).first()).toEqual({ count: 1 })
    expect((await env.MEDIA_BUCKET.list({ prefix: `workspaces/${owner.currentWorkspace.id}/assets/product-source/` })).objects).toHaveLength(1)
    expect((await dispatch(asset.previewUrl, { headers: { cookie: owner.cookie } })).status).toBe(200)
  })

  it('does not replay an upload key across workspaces or disturb the original asset', async () => {
    const firstOwner = await registerAccount('Asset Key First Workspace')
    const secondOwner = await registerAccount('Asset Key Second Workspace')
    const idempotencyKey = crypto.randomUUID()
    const first = await uploadPng(firstOwner.cookie, 'first-workspace.png', env, idempotencyKey)
    const second = await uploadPng(secondOwner.cookie, 'second-workspace.png', env, idempotencyKey)

    expect(first.status).toBe(201)
    expect(second.status).toBe(503)
    const { asset } = await first.json() as { asset: { previewUrl: string } }
    expect((await dispatch(asset.previewUrl, { headers: { cookie: firstOwner.cookie } })).status).toBe(200)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?')
      .bind(secondOwner.currentWorkspace.id).first()).toEqual({ count: 0 })
    expect((await env.MEDIA_BUCKET.list({ prefix: `workspaces/${secondOwner.currentWorkspace.id}/assets/product-source/` })).objects).toHaveLength(0)
  })

  it('reports private product metadata unavailable without weakening workspace scoping', async () => {
    const owner = await registerAccount('Asset Metadata Availability')
    const uploaded = await uploadPng(owner.cookie, 'metadata-availability.png')
    const { asset } = await uploaded.json() as { asset: { previewUrl: string } }
    const metadataFailureDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('FROM media_assets a') || !query.includes("a.kind = 'product-source'")) return statement
        return {
          bind: () => ({
            first: async () => { throw new TypeError('synthetic product metadata read failure') }
          })
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const response = await dispatch(asset.previewUrl, {
      headers: { cookie: owner.cookie }
    }, { ...env, DB: metadataFailureDb })

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      code: 'unavailable',
      error: '私人商品圖片暫時無法讀取。 Private product image is temporarily unavailable.'
    })
  })

  it('reports private product object storage unavailable after scoped metadata succeeds', async () => {
    const owner = await registerAccount('Asset Object Availability')
    const uploaded = await uploadPng(owner.cookie, 'object-availability.png')
    const { asset } = await uploaded.json() as { asset: { previewUrl: string } }
    const unavailableBucket = {
      get: async () => { throw new TypeError('synthetic private object read failure') }
    } as unknown as typeof env.MEDIA_BUCKET

    const response = await dispatch(asset.previewUrl, {
      headers: { cookie: owner.cookie }
    }, { ...env, MEDIA_BUCKET: unavailableBucket })

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      code: 'unavailable',
      error: '私人商品圖片暫時無法讀取。 Private product image is temporarily unavailable.'
    })
  })

  it('reconciles an asset insert that commits before D1 reports failure', async () => {
    const owner = await registerAccount('Ambiguous Asset Commit')
    const ambiguousDb = {
      prepare: env.DB.prepare.bind(env.DB),
      async batch(statements: D1PreparedStatement[]) {
        await env.DB.batch(statements)
        throw new Error('synthetic response failure after commit')
      }
    } as unknown as typeof env.DB

    const uploaded = await uploadPng(owner.cookie, 'ambiguous-commit.png', { ...env, DB: ambiguousDb })

    expect(uploaded.status).toBe(201)
    const { asset } = await uploaded.json() as { asset: { id: string; previewUrl: string } }
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE id = ?').bind(asset.id).first()).toEqual({ count: 1 })
    expect(await dispatch(asset.previewUrl, { headers: { cookie: owner.cookie } }).then((response) => response.status)).toBe(200)
  })

  it('removes the private object when an asset insert definitely does not commit', async () => {
    const owner = await registerAccount('Rejected Asset Insert')
    const rejectingDb = {
      prepare: env.DB.prepare.bind(env.DB),
      batch: async () => { throw new Error('synthetic failure before commit') }
    } as unknown as typeof env.DB

    const uploaded = await uploadPng(owner.cookie, 'rejected-insert.png', { ...env, DB: rejectingDb })

    expect(uploaded.status).toBe(503)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
    const objects = await env.MEDIA_BUCKET.list({ prefix: `workspaces/${owner.currentWorkspace.id}/assets/product-source/` })
    expect(objects.objects).toHaveLength(0)
  })

  it('fails closed when private R2 product bytes change while metadata remains unchanged', async () => {
    const owner = await registerAccount('Asset Digest Guard')
    const uploaded = await uploadPng(owner.cookie, 'digest-source.png')
    const { asset } = await uploaded.json() as { asset: { id: string; previewUrl: string } }
    const row = await env.DB.prepare('SELECT object_key AS objectKey FROM media_assets WHERE id = ?')
      .bind(asset.id)
      .first<{ objectKey: string }>()
    const original = row?.objectKey ? await env.MEDIA_BUCKET.get(row.objectKey) : null
    expect(original).not.toBeNull()
    const replacement = validPngBytes()
    replacement[replacement.byteLength - 1] ^= 1
    const replacementDigest = await crypto.subtle.digest('SHA-256', replacement)
    await env.MEDIA_BUCKET.put(row!.objectKey, replacement, {
      httpMetadata: original!.httpMetadata,
      customMetadata: original!.customMetadata,
      sha256: replacementDigest
    })

    const preview = await dispatch(asset.previewUrl, { headers: { cookie: owner.cookie } })
    expect(preview.status).toBe(409)
    expect(preview.headers.get('content-type')).toContain('application/json')
    expect(await preview.json()).toMatchObject({ error: expect.stringContaining('完整性') })

    const planned = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief: validBrief(asset.id) })
    })
    expect(planned.status).toBe(409)
    expect(await planned.json()).toMatchObject({ error: expect.stringContaining('完整性') })
    expect(await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } }).then((response) => response.json()))
      .toMatchObject({ state: { stage: 'idle', revision: 0 } })
  })

  it('rejects an allowlisted MIME type when the file signature does not match', async () => {
    const owner = await registerAccount('Invalid Asset')
    const form = new FormData()
    form.set('file', new File(['not-a-png'], 'fake.png', { type: 'image/png' }))
    form.set('rightsAttestation', 'commercial-use-v1')
    const response = await dispatch('/api/assets/product', { method: 'POST', headers: { cookie: owner.cookie, origin: 'https://app.test', 'idempotency-key': crypto.randomUUID() }, body: form })
    expect(response.status).toBe(415)
  })

  it.each([
    { label: 'signature without chunks', bytes: validPngBytes().slice(0, 8) },
    { label: 'IHDR without image data or trailer', bytes: validPngBytes().slice(0, 33) },
    { label: 'truncated final chunk', bytes: validPngBytes().slice(0, -1) },
    {
      label: 'chunk checksum mismatch',
      bytes: (() => {
        const bytes = validPngBytes()
        bytes[29] ^= 1
        return bytes
      })()
    },
    {
      label: 'content after IEND',
      bytes: (() => {
        const valid = validPngBytes()
        const bytes = new Uint8Array(valid.byteLength + 1)
        bytes.set(valid)
        bytes[bytes.byteLength - 1] = 1
        return bytes
      })()
    }
  ])('rejects structurally invalid PNG files: $label', async ({ bytes }) => {
    const owner = await registerAccount('Invalid PNG Structure')
    const form = new FormData()
    form.set('file', new File([bytes], 'invalid.png', { type: 'image/png' }))
    form.set('rightsAttestation', 'commercial-use-v1')

    const response = await dispatch('/api/assets/product', {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: 'https://app.test', 'idempotency-key': crypto.randomUUID() },
      body: form
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('結構') })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it('accepts an indexed-color PNG whose palette fits its bit depth', async () => {
    const owner = await registerAccount('Valid Indexed PNG Palette')
    const response = await uploadImage(owner.cookie, indexedPngWithPaletteEntries(2), 'indexed.png', 'image/png')

    expect(response.status).toBe(201)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 1 })
  })

  it('rejects an indexed-color PNG whose palette exceeds its bit depth before storage', async () => {
    const owner = await registerAccount('Invalid Indexed PNG Palette')
    const response = await uploadImage(owner.cookie, indexedPngWithPaletteEntries(3), 'indexed.png', 'image/png')

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('結構') })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
    expect((await env.MEDIA_BUCKET.list({ prefix: `workspaces/${owner.currentWorkspace.id}/assets/product-source/` })).objects).toHaveLength(0)
  })

  it.each([
    { label: 'greyscale', bytes: pngWithColorTypeChunks(0, [pngChunk('tRNS', new Uint8Array(2))]) },
    { label: 'truecolor', bytes: pngWithColorTypeChunks(2, [pngChunk('tRNS', new Uint8Array(6))]) },
    { label: 'indexed-color', bytes: indexedPngWithPaletteEntries(2, new Uint8Array([0, 255])) }
  ])('accepts a structurally valid $label PNG transparency chunk', async ({ bytes }) => {
    const owner = await registerAccount('Valid PNG Transparency')
    const response = await uploadImage(owner.cookie, bytes, 'transparent.png', 'image/png')

    expect(response.status).toBe(201)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 1 })
  })

  it.each([
    { label: 'one-byte greyscale value', bytes: pngWithColorTypeChunks(0, [pngChunk('tRNS', new Uint8Array(1))]) },
    { label: 'five-byte truecolor value', bytes: pngWithColorTypeChunks(2, [pngChunk('tRNS', new Uint8Array(5))]) },
    { label: 'alpha table longer than its palette', bytes: indexedPngWithPaletteEntries(2, new Uint8Array(3)) },
    { label: 'greyscale alpha channel', bytes: pngWithColorTypeChunks(4, [pngChunk('tRNS', new Uint8Array(2))]) },
    { label: 'truecolor alpha channel', bytes: pngWithColorTypeChunks(6, [pngChunk('tRNS', new Uint8Array(6))]) },
    { label: 'duplicate chunks', bytes: pngWithColorTypeChunks(0, [pngChunk('tRNS', new Uint8Array(2)), pngChunk('tRNS', new Uint8Array(2))]) },
    { label: 'chunk after image data', bytes: pngWithColorTypeChunks(0, [], [pngChunk('tRNS', new Uint8Array(2))]) },
    { label: 'indexed chunk before its palette', bytes: pngWithColorTypeChunks(3, [pngChunk('tRNS', new Uint8Array(1)), pngChunk('PLTE', new Uint8Array(3))]) },
    { label: 'truecolor palette after transparency', bytes: pngWithColorTypeChunks(2, [pngChunk('tRNS', new Uint8Array(6)), pngChunk('PLTE', new Uint8Array(3))]) }
  ])('rejects invalid PNG transparency semantics: $label', async ({ bytes }) => {
    const owner = await registerAccount('Invalid PNG Transparency')
    const response = await uploadImage(owner.cookie, bytes, 'invalid-transparency.png', 'image/png')

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('結構') })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
    expect((await env.MEDIA_BUCKET.list({ prefix: `workspaces/${owner.currentWorkspace.id}/assets/product-source/` })).objects).toHaveLength(0)
  })

  it.each([
    { label: 'public PNG color data', bytes: pngWithAncillaryChunk('gAMA', new Uint8Array([0, 0, 177, 143])), name: 'public-color.png', contentType: 'image/png' as const },
    { label: 'standard extended WebP', bytes: extendedWebpWithTrailingChunk(), name: 'extended.webp', contentType: 'image/webp' as const }
  ])('accepts bounded $label without custom payloads', async ({ bytes, name, contentType }) => {
    const owner = await registerAccount('Public Image Container Data')
    const response = await uploadImage(owner.cookie, bytes, name, contentType)

    expect(response.status).toBe(201)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 1 })
  })

  it.each([
    { label: 'private PNG chunk', bytes: pngWithAncillaryChunk('vpAg', new Uint8Array([1, 2, 3, 4])), name: 'private-chunk.png', contentType: 'image/png' as const },
    { label: 'unknown WebP chunk', bytes: extendedWebpWithTrailingChunk({ type: 'PRIV', data: new Uint8Array([1, 2, 3, 4]) }), name: 'private-chunk.webp', contentType: 'image/webp' as const }
  ])('rejects a $label before storing custom container data', async ({ bytes, name, contentType }) => {
    const owner = await registerAccount('Private Image Container Data')
    const response = await uploadImage(owner.cookie, bytes, name, contentType)

    expect(response.status).toBe(400)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
    expect((await env.MEDIA_BUCKET.list({ prefix: `workspaces/${owner.currentWorkspace.id}/assets/product-source/` })).objects).toHaveLength(0)
  })

  it('accepts a bounded static WebP container with image data', async () => {
    const owner = await registerAccount('Valid WebP Structure')
    const response = await uploadWebp(owner.cookie)

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      asset: { contentType: 'image/webp', sizeBytes: validWebpBytes().byteLength, widthPx: 1, heightPx: 1 }
    })
  })

  it.each([
    { label: 'PNG', bytes: pngWithDimensions(9_000, 4_000), name: 'oversized.png', contentType: 'image/png' as const },
    { label: 'JPEG', bytes: jpegWithDimensions(9_000, 4_000), name: 'oversized.jpg', contentType: 'image/jpeg' as const },
    { label: 'WebP', bytes: webpWithDimensions(8_192, 8_192), name: 'oversized.webp', contentType: 'image/webp' as const }
  ])('rejects $label dimensions that exceed the bounded product image contract', async ({ bytes, name, contentType }) => {
    const owner = await registerAccount('Oversized Image Dimensions')
    const response = await uploadImage(owner.cookie, bytes, name, contentType)

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('8192') })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it.each([
    { label: 'RIFF header without chunks', bytes: validWebpBytes().slice(0, 12) },
    {
      label: 'incorrect RIFF payload size',
      bytes: (() => {
        const bytes = validWebpBytes()
        bytes[4] = 0
        return bytes
      })()
    },
    { label: 'truncated image chunk', bytes: validWebpBytes().slice(0, -1) },
    {
      label: 'container without image data',
      bytes: new Uint8Array([82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80, 74, 85, 78, 75, 0, 0, 0, 0])
    }
  ])('rejects structurally invalid WebP files: $label', async ({ bytes }) => {
    const owner = await registerAccount('Invalid WebP Structure')
    const response = await uploadWebp(owner.cookie, bytes, 'invalid.webp')

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('結構') })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it('rejects image metadata that could leak hidden location or author details', async () => {
    const owner = await registerAccount('Metadata Asset')
    const bytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 0, 101, 88, 73, 102, 0, 0, 0, 0
    ])
    const form = new FormData()
    form.set('file', new File([bytes], 'private-details.png', { type: 'image/png' }))
    form.set('rightsAttestation', 'commercial-use-v1')

    const response = await dispatch('/api/assets/product', { method: 'POST', headers: { cookie: owner.cookie, origin: 'https://app.test', 'idempotency-key': crypto.randomUUID() }, body: form })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('metadata') })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it('accepts a structurally bounded JPEG with fill bytes, stuffed bytes, restart markers and multiple scans', async () => {
    const owner = await registerAccount('Safe JPEG Markers')
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x02,
      ...jpegFrameHeader,
      ...jpegScanHeader,
      0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33,
      0xff, 0xff, ...jpegScanHeader.slice(1),
      0x44, 0xff, 0xd7, 0x55,
      0xff, 0xd9
    ])

    const response = await uploadJpeg(owner.cookie, bytes)
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      asset: { contentType: 'image/jpeg', sizeBytes: bytes.byteLength, widthPx: 1, heightPx: 1 }
    })
  })

  it('rejects a JPEG with excessive marker work before storing the asset', async () => {
    const owner = await registerAccount('Bounded JPEG Markers')
    const repeatedSegments = Array.from({ length: 4_096 }, () => [0xff, 0xe0, 0x00, 0x02]).flat()
    const bytes = new Uint8Array([
      0xff, 0xd8,
      ...jpegFrameHeader,
      ...repeatedSegments,
      ...jpegScanHeader,
      0x11,
      0xff, 0xd9
    ])

    const response = await uploadJpeg(owner.cookie, bytes, 'excessive-markers.jpg')

    expect(response.status).toBe(400)
    const payload = await response.json() as { error: string }
    expect(payload.error).toContain('結構')
    expect(payload.error).toContain('Invalid image metadata or structure')
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it.each([
    {
      label: 'repeated marker fill before APP1',
      bytes: [0xff, 0xd8, 0xff, 0xff, 0xe1, 0x00, 0x02, 0xff, 0xd9]
    },
    {
      label: 'standalone restart marker before APP13',
      bytes: [0xff, 0xd8, 0xff, 0xd0, 0xff, 0xed, 0x00, 0x02, 0xff, 0xd9]
    },
    {
      label: 'comment marker after stuffed entropy data and a second scan',
      bytes: [
        0xff, 0xd8, ...jpegFrameHeader, ...jpegScanHeader, 0x11, 0xff, 0x00, 0x22,
        ...jpegScanHeader, 0x33, 0xff, 0xfe, 0x00, 0x02, 0xff, 0xd9
      ]
    },
    {
      label: 'truncated segment length',
      bytes: [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00, 0xff, 0xd9]
    },
    {
      label: 'missing end-of-image marker',
      bytes: [0xff, 0xd8, ...jpegFrameHeader, ...jpegScanHeader, 0x11, 0xff, 0x00, 0x22]
    },
    {
      label: 'end-of-image without a frame or scan',
      bytes: [0xff, 0xd8, 0xff, 0xd9]
    }
  ])('fails closed for JPEG metadata or malformed marker structure: $label', async ({ bytes }) => {
    const owner = await registerAccount('Unsafe JPEG Markers')
    const response = await uploadJpeg(owner.cookie, new Uint8Array(bytes))

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

  it('keeps private asset state unchanged when delete preflight metadata is unreadable', async () => {
    const owner = await registerAccount('Asset Delete Preflight Availability')
    const uploaded = await uploadPng(owner.cookie, 'delete-preflight.png')
    const { asset } = await uploaded.json() as { asset: { id: string; previewUrl: string } }
    const planned = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief: validBrief(asset.id) })
    })
    const { state: plannedState } = await planned.json() as { state: { stage: string; revision: number } }
    const stored = await env.DB.prepare('SELECT object_key AS objectKey FROM media_assets WHERE id = ?')
      .bind(asset.id)
      .first<{ objectKey: string }>()
    const preflightFailureDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('SELECT a.object_key AS objectKey') || !query.includes('JOIN workspaces w')) return statement
        return {
          bind: () => ({
            first: async () => { throw new TypeError('synthetic asset delete preflight failure') }
          })
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const failed = await dispatch(asset.previewUrl, {
      method: 'DELETE',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    }, { ...env, DB: preflightFailureDb })

    expect(failed.status).toBe(503)
    expect(failed.headers.get('cache-control')).toBe('no-store')
    expect(await failed.json()).toEqual({ error: '未能刪除商品圖片。 Unable to delete product image.' })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE id = ?').bind(asset.id).first()).toEqual({ count: 1 })
    expect(await env.MEDIA_BUCKET.head(stored!.objectKey)).not.toBeNull()
    expect(await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } }).then((response) => response.json())).toMatchObject({
      state: { stage: plannedState.stage, revision: plannedState.revision, brief: { assetId: asset.id } }
    })
  })

  it('reconciles an asset delete that commits before D1 reports failure', async () => {
    const owner = await registerAccount('Ambiguous Asset Delete')
    const uploaded = await uploadPng(owner.cookie, 'ambiguous-delete.png')
    const { asset } = await uploaded.json() as { asset: { id: string; previewUrl: string } }
    await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief: validBrief(asset.id) })
    })
    const stored = await env.DB.prepare('SELECT object_key AS objectKey FROM media_assets WHERE id = ?')
      .bind(asset.id)
      .first<{ objectKey: string }>()
    const ambiguousDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('DELETE FROM media_assets')) return statement
        return {
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values)
            return {
              run: async () => {
                await bound.run()
                throw new TypeError('synthetic response failure after asset delete commit')
              }
            }
          }
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const deleted = await dispatch(asset.previewUrl, {
      method: 'DELETE',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    }, { ...env, DB: ambiguousDb })

    expect(deleted.status).toBe(204)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE id = ?').bind(asset.id).first()).toEqual({ count: 0 })
    expect(await env.MEDIA_BUCKET.get(stored!.objectKey)).toBeNull()
    expect(await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } }).then((response) => response.json()))
      .toMatchObject({ state: { stage: 'idle', revision: 0 } })
  })

  it('keeps an asset retry anchor when its D1 delete does not commit', async () => {
    const owner = await registerAccount('Rejected Asset Delete')
    const uploaded = await uploadPng(owner.cookie, 'retry-delete.png')
    const { asset } = await uploaded.json() as { asset: { id: string; previewUrl: string } }
    await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief: validBrief(asset.id) })
    })
    const stored = await env.DB.prepare('SELECT object_key AS objectKey FROM media_assets WHERE id = ?')
      .bind(asset.id)
      .first<{ objectKey: string }>()
    const rejectingDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query)
        if (!query.includes('DELETE FROM media_assets')) return statement
        return {
          bind: () => ({
            run: async () => { throw new TypeError('synthetic failure before asset delete commit') }
          })
        }
      },
      batch: env.DB.batch.bind(env.DB)
    } as unknown as typeof env.DB

    const failed = await dispatch(asset.previewUrl, {
      method: 'DELETE',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    }, { ...env, DB: rejectingDb })

    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({ error: '未能刪除商品圖片。 Unable to delete product image.' })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE id = ?').bind(asset.id).first()).toEqual({ count: 1 })
    expect(await env.MEDIA_BUCKET.get(stored!.objectKey)).toBeNull()
    expect(await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } }).then((response) => response.json()))
      .toMatchObject({ state: { stage: 'idle', revision: 0 } })

    const retried = await dispatch(asset.previewUrl, {
      method: 'DELETE',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    })
    expect(retried.status).toBe(204)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE id = ?').bind(asset.id).first()).toEqual({ count: 0 })
  })

  it('preserves an approved Agent plan when private asset deletion fails', async () => {
    const owner = await registerAccount('Failed Asset Delete')
    const uploaded = await uploadPng(owner.cookie, 'keep-on-failure.png')
    const { asset } = await uploaded.json() as { asset: { id: string; previewUrl: string } }
    const planned = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief: validBrief(asset.id) })
    })
    const { state: plannedState } = await planned.json() as { state: { revision: number } }
    const approved = await dispatch('/api/campaign-agent/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ revision: plannedState.revision })
    })
    const { state: approvedState } = await approved.json() as { state: { revision: number; approvedAt: string } }
    const failingBucket = {
      delete: async () => { throw new Error('synthetic R2 delete failure') }
    } as unknown as typeof env.MEDIA_BUCKET

    const failed = await dispatch(asset.previewUrl, {
      method: 'DELETE',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    }, { ...env, MEDIA_BUCKET: failingBucket })

    expect(failed.status).toBe(503)
    expect(await dispatch(asset.previewUrl, { headers: { cookie: owner.cookie } }).then((response) => response.status)).toBe(200)
    expect(await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } }).then((response) => response.json())).toMatchObject({
      state: { stage: 'approved', revision: approvedState.revision, approvedAt: approvedState.approvedAt, brief: { assetId: asset.id } }
    })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE id = ?').bind(asset.id).first()).toEqual({ count: 1 })
  })

  it('preserves the current Agent plan when deleting a different product asset', async () => {
    const owner = await registerAccount('Unrelated Asset Delete')
    const plannedAssetResponse = await uploadPng(owner.cookie, 'planned-source.png')
    const unrelatedAssetResponse = await uploadPng(owner.cookie, 'unrelated-source.png')
    const { asset: plannedAsset } = await plannedAssetResponse.json() as { asset: { id: string; previewUrl: string } }
    const { asset: unrelatedAsset } = await unrelatedAssetResponse.json() as { asset: { id: string; previewUrl: string } }
    const planned = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief: validBrief(plannedAsset.id) })
    })
    const { state: plannedState } = await planned.json() as { state: { stage: string; revision: number } }

    const deleted = await dispatch(unrelatedAsset.previewUrl, {
      method: 'DELETE',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    })

    expect(deleted.status).toBe(204)
    expect(await dispatch(unrelatedAsset.previewUrl, { headers: { cookie: owner.cookie } }).then((response) => response.status)).toBe(404)
    expect(await dispatch(plannedAsset.previewUrl, { headers: { cookie: owner.cookie } }).then((response) => response.status)).toBe(200)
    expect(await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } }).then((response) => response.json())).toMatchObject({
      state: { stage: plannedState.stage, revision: plannedState.revision, brief: { assetId: plannedAsset.id } }
    })
    const replayedDelete = await dispatch(unrelatedAsset.previewUrl, {
      method: 'DELETE',
      headers: { cookie: owner.cookie, origin: 'https://app.test' }
    })
    expect(replayedDelete.status).toBe(404)
    expect(await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } }).then((response) => response.json())).toMatchObject({
      state: { stage: plannedState.stage, revision: plannedState.revision, brief: { assetId: plannedAsset.id } }
    })
  })
})

describe('workspace Campaign Agent', () => {
  it('does not expose internal methods as WebSocket callable RPC', async () => {
    const owner = await registerAccount('Internal Agent RPC')
    const agent = await getAgentByName(env.CAMPAIGN_AGENT, owner.currentWorkspace.id)
    const callableMethods = await agent.getCallableMethods()

    expect([...callableMethods.keys()]).toEqual([])
  })

  it('maps Agent binding acquisition failures to a bounded unavailable response', async () => {
    const owner = await registerAccount('Unavailable Agent Binding')
    const unavailableEnv = {
      ...env,
      CAMPAIGN_AGENT: undefined as unknown as typeof env.CAMPAIGN_AGENT
    }

    const response = await dispatch('/api/campaign-agent', {
      headers: { cookie: owner.cookie }
    }, unavailableEnv)

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      error: 'Campaign Agent 暫時未能完成這個動作。 Campaign Agent is temporarily unavailable.'
    })
  })

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
      body: JSON.stringify({ revision: 2 })
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

  it('requires an exact approval revision and makes concurrent replay idempotent', async () => {
    const owner = await registerAccount('Strict Agent Approval')
    const uploaded = await uploadPng(owner.cookie, 'strict-approval-source.png')
    const { asset } = await uploaded.json() as { asset: { id: string } }
    const planned = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief: validBrief(asset.id) })
    })
    const { state: plannedState } = await planned.json() as { state: { revision: number } }
    const approve = (body: unknown) => dispatch('/api/campaign-agent/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify(body)
    })

    for (const malformed of [
      { revision: true },
      { revision: String(plannedState.revision) },
      { revision: null },
      { revision: 0 },
      { revision: 1.5 },
      { revision: plannedState.revision, unexpected: true },
      []
    ]) {
      const response = await approve(malformed)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/批准版本格式無效.*Approval revision/) })
      expect(await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } }).then((stateResponse) => stateResponse.json())).toMatchObject({
        state: { stage: 'awaiting-approval', revision: plannedState.revision }
      })
    }

    const oversized = await approve({ revision: plannedState.revision, padding: 'x'.repeat(48_000) })
    expect(oversized.status).toBe(413)
    expect(await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } }).then((stateResponse) => stateResponse.json())).toMatchObject({
      state: { stage: 'awaiting-approval', revision: plannedState.revision }
    })

    const concurrent = await Promise.all([approve({ revision: plannedState.revision }), approve({ revision: plannedState.revision })])
    expect(concurrent.map((response) => response.status)).toEqual([200, 200])
    const concurrentPayloads = await Promise.all(concurrent.map((response) => response.json())) as Array<{ replayed: boolean; state: { approvedAt: string; messages: Array<{ id: string }> } }>
    expect(concurrentPayloads.map((payload) => payload.replayed).sort()).toEqual([false, true])
    expect(concurrentPayloads[0].state.approvedAt).toBe(concurrentPayloads[1].state.approvedAt)
    expect(concurrentPayloads[1].state.messages.filter((message) => message.id === `approved-${plannedState.revision}`)).toHaveLength(1)

    const replay = await approve({ revision: plannedState.revision })
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ replayed: true, state: { stage: 'approved', revision: plannedState.revision, approvedAt: concurrentPayloads[0].state.approvedAt } })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM output_ledger WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it('rejects a malformed plan envelope without replacing an approved revision', async () => {
    const owner = await registerAccount('Strict Agent Plan')
    const uploaded = await uploadPng(owner.cookie, 'strict-plan-source.png')
    const { asset } = await uploaded.json() as { asset: { id: string } }
    const brief = validBrief(asset.id)
    const planned = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief })
    })
    const { state: plannedState } = await planned.json() as { state: { revision: number } }
    const approved = await dispatch('/api/campaign-agent/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ revision: plannedState.revision })
    })
    const { state: approvedState } = await approved.json() as { state: { revision: number; approvedAt: string } }
    const plan = (body: BodyInit) => dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body
    })

    for (const malformed of [
      JSON.stringify({}),
      JSON.stringify({ brief: null }),
      JSON.stringify({ brief: [] }),
      JSON.stringify({ brief: 'not-an-object' }),
      JSON.stringify({ brief, unexpected: true }),
      JSON.stringify([]),
      '{'
    ]) {
      const response = await plan(malformed)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/Campaign Brief 請求格式無效.*request must contain/) })
      expect(await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } }).then((stateResponse) => stateResponse.json())).toMatchObject({
        state: { stage: 'approved', revision: approvedState.revision, approvedAt: approvedState.approvedAt, brief: { assetId: asset.id } }
      })
    }

    for (const briefWithUnknownField of [
      { ...brief, unexpected: true },
      { ...brief, brand: { ...brief.brand, unexpected: true } },
      { ...brief, product: { ...brief.product, unexpected: true } }
    ]) {
      const response = await plan(JSON.stringify({ brief: briefWithUnknownField }))
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/不支援.*not supported/i) })
      expect(await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } }).then((stateResponse) => stateResponse.json())).toMatchObject({
        state: { stage: 'approved', revision: approvedState.revision, approvedAt: approvedState.approvedAt, brief: { assetId: asset.id } }
      })
    }

    const partial = await plan(JSON.stringify({ brief: { product: { price: '' } } }))
    expect(partial.status).toBe(200)
    expect(await partial.json()).toMatchObject({ state: { stage: 'needs-input', revision: approvedState.revision + 1 } })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM output_ledger WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it('keeps the current revision when replanning references a missing or cross-workspace asset', async () => {
    const owner = await registerAccount('Plan Asset Scope')
    const otherOwner = await registerAccount('Other Plan Asset Scope')
    const ownUpload = await uploadPng(owner.cookie, 'own-plan-source.png')
    const otherUpload = await uploadPng(otherOwner.cookie, 'other-plan-source.png')
    const { asset: ownAsset } = await ownUpload.json() as { asset: { id: string } }
    const { asset: otherAsset } = await otherUpload.json() as { asset: { id: string } }
    const planned = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief: validBrief(ownAsset.id) })
    })
    const { state: current } = await planned.json() as { state: { stage: string; revision: number } }

    for (const invalidAssetId of [otherAsset.id, crypto.randomUUID()]) {
      const response = await dispatch('/api/campaign-agent/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
        body: JSON.stringify({ brief: validBrief(invalidAssetId) })
      })
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('Product asset not found') })
      expect(await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } }).then((stateResponse) => stateResponse.json())).toMatchObject({
        state: { stage: current.stage, revision: current.revision, brief: { assetId: ownAsset.id } }
      })
    }
  })

  it('rejects lossy brief normalization without replacing the current plan', async () => {
    const owner = await registerAccount('Exact Brief Limits')
    const uploaded = await uploadPng(owner.cookie, 'exact-brief-source.png')
    const { asset } = await uploaded.json() as { asset: { id: string } }
    const brief = validBrief(asset.id)
    const planned = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief })
    })
    const { state: current } = await planned.json() as { state: { stage: string; revision: number; brief: { product: { price: string } } } }

    const invalidBriefs = [
      { value: { ...brief, product: { ...brief.product, price: '9'.repeat(121) } }, error: /價格.*120/ },
      { value: { ...brief, product: { ...brief.product, benefits: Array.from({ length: 9 }, (_, index) => `賣點 ${index + 1}`) } }, error: /產品賣點.*8/ },
      { value: { ...brief, product: { ...brief.product, name: 42 } }, error: /商品名稱格式無效/ },
      { value: { ...brief, brand: { ...brief.brand, locale: 'fr' } }, error: /語言設定格式無效/ }
    ]

    for (const invalidBrief of invalidBriefs) {
      const response = await dispatch('/api/campaign-agent/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
        body: JSON.stringify({ brief: invalidBrief.value })
      })

      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(invalidBrief.error) })
      expect(await dispatch('/api/campaign-agent', { headers: { cookie: owner.cookie } }).then((stateResponse) => stateResponse.json())).toMatchObject({
        state: { stage: current.stage, revision: current.revision, brief: { product: { price: current.brief.product.price } } }
      })
    }
  })

  it('keeps commercial text outside the composition safe area out of approval and supports correction', async () => {
    const owner = await registerAccount('Agent Copy Safe Area')
    const uploaded = await uploadPng(owner.cookie, 'copy-safe-area-source.png')
    const { asset } = await uploaded.json() as { asset: { id: string } }
    const brief = validBrief(asset.id)
    const planned = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief: { ...brief, product: { ...brief.product, price: 'HK$ 12,345,678,900' } } })
    })

    expect(planned.status).toBe(200)
    const { state } = await planned.json() as { state: { stage: string; revision: number; checks: Array<{ id: string; status: string; detail: string }> } }
    expect(state.stage).toBe('needs-input')
    expect(state.checks.find((check) => check.id === 'claims')).toMatchObject({
      status: 'action',
      detail: expect.stringMatching(/價格超出素材安全區.*Price exceeds the composition safe area/)
    })

    const approval = await dispatch('/api/campaign-agent/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ revision: state.revision })
    })
    expect(approval.status).toBe(409)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM output_ledger WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })

    const corrected = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ brief })
    })
    const { state: correctedState } = await corrected.json() as { state: { stage: string; revision: number } }
    expect(correctedState).toMatchObject({ stage: 'awaiting-approval', revision: state.revision + 1 })

    const correctedApproval = await dispatch('/api/campaign-agent/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ revision: correctedState.revision })
    })
    expect(correctedApproval.status).toBe(200)
    expect(await correctedApproval.json()).toMatchObject({ state: { stage: 'approved', revision: correctedState.revision } })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM output_ledger WHERE workspace_id = ?').bind(owner.currentWorkspace.id).first()).toEqual({ count: 0 })
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
