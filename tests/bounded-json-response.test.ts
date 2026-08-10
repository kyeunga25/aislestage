import { describe, expect, it } from 'vitest'
import { readBoundedJsonResponse } from '../src/lib/bounded-json-response'

describe('bounded JSON response reader', () => {
  it('accepts valid JSON at the exact UTF-8 byte limit', async () => {
    const body = JSON.stringify({ ok: true })
    const maxBytes = new TextEncoder().encode(body).byteLength

    await expect(readBoundedJsonResponse(new Response(body), maxBytes)).resolves.toEqual({ ok: true })
  })

  it('rejects a declared response length above the limit', async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-length': '1025' }
    })

    await expect(readBoundedJsonResponse(response, 1024)).resolves.toBeNull()
  })

  it('rejects actual streamed bytes above the limit even when the declared length is smaller', async () => {
    const response = new Response(` ${JSON.stringify({ ok: true })}`, {
      headers: { 'content-length': '1' }
    })

    await expect(readBoundedJsonResponse(response, 8)).resolves.toBeNull()
  })

  it('rejects malformed JSON within the byte limit', async () => {
    await expect(readBoundedJsonResponse(new Response('{'), 8)).resolves.toBeNull()
  })
})
