import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  brandPackListUnavailableMessage,
  brandPackSaveUnavailableMessage,
  loadBrandPackList,
  loadBrandPackListSnapshot,
  saveApprovedBrandPack
} from '../src/lib/brand-pack-client'

const canonicalBrandPack = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  name: 'Test Brand',
  tone: '清晰、可信',
  colors: ['#155eef', '#ffffff'],
  forbiddenWords: '保證',
  locale: 'zh-Hant',
  cta: '立即選購',
  ctaEn: 'Shop now',
  approvedRevision: 2,
  createdAt: '2026-08-30T05:00:00Z'
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('brand pack client', () => {
  it('loads an exact bounded workspace brand list', async () => {
    const fetchMock = vi.fn(async () => Response.json({ brandPacks: [canonicalBrandPack] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadBrandPackList()).resolves.toEqual([canonicalBrandPack])
    expect(fetchMock).toHaveBeenCalledWith('/api/brand-packs', expect.objectContaining({
      credentials: 'same-origin',
      signal: expect.any(AbortSignal)
    }))
  })

  it.each([
    { brandPacks: [{ ...canonicalBrandPack, workspaceId: 'private-workspace' }] },
    { brandPacks: [{ ...canonicalBrandPack, id: 'unsafe-id' }] },
    { brandPacks: [{ ...canonicalBrandPack, colors: ['#155eef', 3] }] },
    { brandPacks: [{ ...canonicalBrandPack, colors: ['url(//example.test/color)'] }] },
    { brandPacks: [{ ...canonicalBrandPack, colors: [] }] },
    { brandPacks: [{ ...canonicalBrandPack, locale: 'zh-Hans' }] },
    { brandPacks: [{ ...canonicalBrandPack, approvedRevision: 0 }] },
    { brandPacks: [{ ...canonicalBrandPack, createdAt: '2026-02-31T05:00:00Z' }] },
    { brandPacks: [canonicalBrandPack, canonicalBrandPack] },
    { brandPacks: Array.from({ length: 21 }, (_, index) => ({
      ...canonicalBrandPack,
      id: `123e4567-e89b-42d3-a456-${index.toString().padStart(12, '0')}`
    })) },
    { brandPacks: [], cursor: 'private-cursor' }
  ])('rejects malformed or expanded brand data %#', async (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)))
    await expect(loadBrandPackList()).rejects.toThrow(brandPackListUnavailableMessage)
  })

  it('keeps the prior brand snapshot authoritative when list loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'private D1 detail' }, { status: 503 })))
    await expect(loadBrandPackListSnapshot()).resolves.toEqual({
      brandPacks: null,
      error: brandPackListUnavailableMessage
    })
  })

  it('saves one approved revision and accepts only the canonical creation envelope', async () => {
    const fetchMock = vi.fn(async () => Response.json({ brandPack: canonicalBrandPack, replayed: false }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(saveApprovedBrandPack(2)).resolves.toEqual(canonicalBrandPack)
    expect(fetchMock).toHaveBeenCalledWith('/api/brand-packs', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approvedRevision: 2 }),
      signal: expect.any(AbortSignal)
    }))
  })

  it('retries one uncertain save with the same canonical body and accepts an idempotent replay', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'synthetic detail' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ brandPack: canonicalBrandPack, replayed: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(saveApprovedBrandPack(2)).resolves.toEqual(canonicalBrandPack)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(fetchMock.mock.calls[1]?.[1]?.body)
  })

  it('rejects stale approval, malformed success, and unsafe local revisions without exposing server detail', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: 'private Agent detail' }, { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(saveApprovedBrandPack(2)).rejects.toThrow(
      '品牌資料批准版本已改變，請重新核對。 Brand approval changed; review the latest plan.'
    )

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ brandPack: canonicalBrandPack, replayed: false }, { status: 200 })))
    await expect(saveApprovedBrandPack(2)).rejects.toThrow(brandPackSaveUnavailableMessage)

    const noFetch = vi.fn()
    vi.stubGlobal('fetch', noFetch)
    await expect(saveApprovedBrandPack(0)).rejects.toThrow('品牌資料批准版本無效。 Brand approval revision is invalid.')
    expect(noFetch).not.toHaveBeenCalled()
  })
})
