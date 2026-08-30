import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadProductProfileList,
  loadProductProfileListSnapshot,
  productProfileListUnavailableMessage,
  productProfileSaveUnavailableMessage,
  saveApprovedProductProfile
} from '../src/lib/product-profile-client'

const canonicalProductProfile = {
  id: '123e4567-e89b-42d3-a456-426614174200',
  name: 'Test Speaker',
  nameEn: 'Test Speaker',
  category: '消費電子',
  benefits: ['12 小時播放', 'IPX5 防水'],
  benefitsEn: ['12-hour playback', 'IPX5 water resistance'],
  specifications: 'Bluetooth 5.3',
  price: 'HK$399',
  promotion: '限時免運費',
  promotionEn: 'Free delivery for a limited time',
  channels: ['Shopify', 'Instagram'],
  approvedRevision: 2,
  createdAt: '2026-08-30T06:00:00Z'
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('product profile client', () => {
  it('loads an exact bounded workspace product profile list', async () => {
    const fetchMock = vi.fn(async () => Response.json({ productProfiles: [canonicalProductProfile] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadProductProfileList()).resolves.toEqual([canonicalProductProfile])
    expect(fetchMock).toHaveBeenCalledWith('/api/product-profiles', expect.objectContaining({
      credentials: 'same-origin',
      signal: expect.any(AbortSignal)
    }))
  })

  it.each([
    { productProfiles: [{ ...canonicalProductProfile, workspaceId: 'private-workspace' }] },
    { productProfiles: [{ ...canonicalProductProfile, id: 'unsafe-id' }] },
    { productProfiles: [{ ...canonicalProductProfile, benefits: ['safe', 3] }] },
    { productProfiles: [{ ...canonicalProductProfile, benefitsEn: ['one'] }] },
    { productProfiles: [{ ...canonicalProductProfile, channels: ['x'.repeat(81)] }] },
    { productProfiles: [{ ...canonicalProductProfile, approvedRevision: 0 }] },
    { productProfiles: [{ ...canonicalProductProfile, createdAt: '2026-02-31T06:00:00Z' }] },
    { productProfiles: [canonicalProductProfile, canonicalProductProfile] },
    { productProfiles: Array.from({ length: 21 }, (_, index) => ({
      ...canonicalProductProfile,
      id: `123e4567-e89b-42d3-a456-${(index + 200).toString().padStart(12, '0')}`
    })) },
    { productProfiles: [], cursor: 'private-cursor' }
  ])('rejects malformed or expanded product profile data %#', async (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)))
    await expect(loadProductProfileList()).rejects.toThrow(productProfileListUnavailableMessage)
  })

  it('keeps the prior product profile snapshot authoritative when loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'private D1 detail' }, { status: 503 })))
    await expect(loadProductProfileListSnapshot()).resolves.toEqual({
      productProfiles: null,
      error: productProfileListUnavailableMessage
    })
  })

  it('saves one approved revision and accepts only the canonical creation envelope', async () => {
    const fetchMock = vi.fn(async () => Response.json({ productProfile: canonicalProductProfile, replayed: false }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(saveApprovedProductProfile(2)).resolves.toEqual(canonicalProductProfile)
    expect(fetchMock).toHaveBeenCalledWith('/api/product-profiles', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approvedRevision: 2 }),
      signal: expect.any(AbortSignal)
    }))
  })

  it('retries one uncertain save with the same body and accepts an idempotent replay', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'synthetic detail' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ productProfile: canonicalProductProfile, replayed: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(saveApprovedProductProfile(2)).resolves.toEqual(canonicalProductProfile)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(fetchMock.mock.calls[1]?.[1]?.body)
  })

  it('rejects stale approval, malformed success, and unsafe local revisions without exposing details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'private Agent detail' }, { status: 409 })))
    await expect(saveApprovedProductProfile(2)).rejects.toThrow(
      '商品資料批准版本已改變，請重新核對。 Product approval changed; review the latest plan.'
    )

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ productProfile: canonicalProductProfile, replayed: false }, { status: 200 })))
    await expect(saveApprovedProductProfile(2)).rejects.toThrow(productProfileSaveUnavailableMessage)

    const noFetch = vi.fn()
    vi.stubGlobal('fetch', noFetch)
    await expect(saveApprovedProductProfile(0)).rejects.toThrow('商品資料批准版本無效。 Product approval revision is invalid.')
    expect(noFetch).not.toHaveBeenCalled()
  })
})
