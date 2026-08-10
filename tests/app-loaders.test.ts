import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadGenerations, loadGenerationSnapshot } from '../src/lib/generation-loader'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workspace generation loading', () => {
  it('keeps an unavailable generation list distinct from a legitimate empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      code: 'unavailable',
      error: 'synthetic private storage detail'
    }, { status: 503 })))

    await expect(loadGenerations('workspace-availability-test')).rejects.toThrow(
      '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    )
  })

  it('returns no authoritative snapshot when the list is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      code: 'unavailable',
      error: 'synthetic private storage detail'
    }, { status: 503 })))

    await expect(loadGenerationSnapshot('workspace-snapshot-test')).resolves.toEqual({
      results: null,
      error: '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    })
  })

  it('accepts an explicit empty generation array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ generations: [] })))

    await expect(loadGenerations('workspace-empty-test')).resolves.toEqual([])
  })

  it('rejects a successful response that omits the generation array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))

    await expect(loadGenerations('workspace-malformed-test')).rejects.toThrow(
      '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    )
  })

  it('uses the bounded bilingual error when the request cannot reach the API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('synthetic network failure') }))

    await expect(loadGenerations('workspace-network-test')).rejects.toThrow(
      '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'
    )
  })
})
