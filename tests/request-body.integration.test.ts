import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { dispatch, registerAccount, validPngBytes } from './helpers'

const encoder = new TextEncoder()
const uploadRequestLimit = 4 * 1024 * 1024 + 64 * 1024

function concatenate(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function streamingBody(chunks: Uint8Array[], onCancel?: () => void, stayOpen = false) {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++]
      if (chunk) controller.enqueue(chunk)
      else if (!stayOpen) controller.close()
    },
    cancel() {
      onCancel?.()
    }
  })
}

function multipartBody(boundary: string, parts: Array<{ disposition: string; contentType?: string; bytes: Uint8Array }>) {
  const chunks: Uint8Array[] = []
  for (const part of parts) {
    chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: ${part.disposition}\r\n`))
    if (part.contentType) chunks.push(encoder.encode(`Content-Type: ${part.contentType}\r\n`))
    chunks.push(encoder.encode('\r\n'), part.bytes, encoder.encode('\r\n'))
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`))
  return concatenate(chunks)
}

describe('bounded request body consumption', () => {
  it('cancels a lengthless oversized JSON body without materializing the remaining stream', async () => {
    let cancelled = false
    const oversized = encoder.encode(JSON.stringify({ email: 'user@example.test', password: 'x'.repeat(9_000) }))
    const response = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '198.51.100.70',
        origin: 'https://app.test'
      },
      body: streamingBody([
        oversized.subarray(0, 8_000),
        oversized.subarray(8_000)
      ], () => { cancelled = true }, true)
    })

    expect(response.status).toBe(413)
    expect(cancelled).toBe(true)
  })

  it('does not trust an invalid Content-Length header', async () => {
    let cancelled = false
    const response = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': 'invalid',
        'cf-connecting-ip': '198.51.100.71',
        origin: 'https://app.test'
      },
      body: streamingBody([encoder.encode(JSON.stringify({ email: 'user@example.test', password: 'test-password' }))], () => { cancelled = true })
    })

    expect(response.status).toBe(413)
    expect(cancelled).toBe(true)
  })

  it.each(['application/json-malicious', 'text/application/json'])(
    'rejects a non-exact JSON media type before authentication work: %s',
    async (contentType) => {
      const account = await registerAccount('Exact JSON Media Type')
      let cancelled = false
      const response = await dispatch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': contentType, 'cf-connecting-ip': '198.51.100.73', origin: 'https://app.test' },
        body: streamingBody([
          encoder.encode(JSON.stringify({ email: account.user.email, password: 'SecurePass123!' }))
        ], () => { cancelled = true })
      })

      expect(response.status).toBe(415)
      expect(cancelled).toBe(true)
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('application/json') })
    }
  )

  it('rejects a non-exact multipart media type before parsing or storage', async () => {
    const account = await registerAccount('Exact Multipart Media Type')
    const boundary = 'aislestage-exact-multipart'
    const body = multipartBody(boundary, [{
      disposition: 'form-data; name="file"; filename="product.png"',
      contentType: 'image/png',
      bytes: validPngBytes()
    }])
    let cancelled = false

    const response = await dispatch('/api/assets/product', {
      method: 'POST',
      headers: { cookie: account.cookie, origin: 'https://app.test', 'content-type': `text/multipart/form-data; boundary=${boundary}` },
      body: streamingBody([body], () => { cancelled = true })
    })

    expect(response.status).toBe(415)
    expect(cancelled).toBe(true)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('multipart/form-data') })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(account.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it('rejects an oversized ignored multipart field before parsing it', async () => {
    const account = await registerAccount('Ignored Multipart')
    const boundary = 'aislestage-ignored-field'
    const body = multipartBody(boundary, [{
      disposition: 'form-data; name="notes"',
      bytes: new Uint8Array(uploadRequestLimit + 1).fill(120)
    }])
    let cancelled = false

    const response = await dispatch('/api/assets/product', {
      method: 'POST',
      headers: { cookie: account.cookie, origin: 'https://app.test', 'content-type': `multipart/form-data; boundary=${boundary}`, 'idempotency-key': crypto.randomUUID() },
      body: streamingBody([body.subarray(0, 1_024), body.subarray(1_024)], () => { cancelled = true }, true)
    })

    expect(response.status).toBe(413)
    expect(cancelled).toBe(true)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(account.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it('rejects a small file hidden inside an oversized multipart request', async () => {
    const account = await registerAccount('Oversized Multipart')
    const boundary = 'aislestage-small-file-large-request'
    const png = validPngBytes()
    const body = multipartBody(boundary, [
      { disposition: 'form-data; name="file"; filename="product.png"', contentType: 'image/png', bytes: png },
      { disposition: 'form-data; name="ignored"', bytes: new Uint8Array(uploadRequestLimit + 1).fill(120) }
    ])

    const response = await dispatch('/api/assets/product', {
      method: 'POST',
      headers: { cookie: account.cookie, origin: 'https://app.test', 'content-type': `multipart/form-data; boundary=${boundary}`, 'idempotency-key': crypto.randomUUID() },
      body: streamingBody([body.subarray(0, 2_048), body.subarray(2_048)])
    })

    expect(response.status).toBe(413)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE workspace_id = ?').bind(account.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it('accepts legitimate lengthless JSON and multipart bodies through the bounded buffer', async () => {
    const account = await registerAccount('Bounded Controls')
    const loginBody = encoder.encode(JSON.stringify({ email: account.user.email, password: 'SecurePass123!' }))
    const login = await dispatch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'Application/JSON; charset=UTF-8', 'cf-connecting-ip': '198.51.100.72', origin: 'https://app.test' },
      body: streamingBody([loginBody])
    })
    expect(login.status).toBe(200)

    const boundary = 'aislestage-valid-upload'
    const png = validPngBytes()
    const uploadBody = multipartBody(boundary, [{
      disposition: 'form-data; name="file"; filename="product.png"',
      contentType: 'image/png',
      bytes: png
    }])
    const upload = await dispatch('/api/assets/product', {
      method: 'POST',
      headers: { cookie: account.cookie, origin: 'https://app.test', 'content-type': `Multipart/Form-Data; boundary=${boundary}`, 'idempotency-key': crypto.randomUUID() },
      body: streamingBody([uploadBody])
    })

    expect(upload.status).toBe(201)
    expect(await upload.json()).toMatchObject({ asset: { contentType: 'image/png', sizeBytes: png.byteLength } })
  })
})
