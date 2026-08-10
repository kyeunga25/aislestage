import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCampaignPack, type CampaignPackClientRequest } from '../src/lib/campaign-pack-client'
import { starterBrand, starterProduct } from '../src/lib/demo-data'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Campaign Pack client', () => {
  const campaignPackId = '123e4567-e89b-42d3-a456-426614174000'
  const generationIds = [
    '223e4567-e89b-42d3-a456-426614174000',
    '323e4567-e89b-42d3-a456-426614174000',
    '423e4567-e89b-42d3-a456-426614174000'
  ]
  const request = {
    idempotencyKey: '523e4567-e89b-42d3-a456-426614174000',
    workspaceId: '623e4567-e89b-42d3-a456-426614174000',
    approvedRevision: 3,
    intent: '限時優惠',
    brand: starterBrand,
    product: starterProduct,
    referenceAssetIds: ['723e4567-e89b-42d3-a456-426614174000'],
    outputs: [
      { workflowId: 'store-main', aspectRatio: '1:1' },
      { workflowId: 'meta-ad', aspectRatio: '4:5' },
      { workflowId: 'promo-poster', aspectRatio: '9:16' }
    ]
  } satisfies CampaignPackClientRequest

  function queuedGenerations() {
    return request.outputs.map((output, index) => ({
      id: generationIds[index],
      campaignPackId,
      workflowId: output.workflowId,
      aspectRatio: output.aspectRatio,
      status: 'queued',
      contentType: null,
      approvedRevision: request.approvedRevision,
      errorMessage: null,
      createdAt: `2026-08-10 13:0${index}:00`,
      reviewStatus: 'draft',
      reviewedAt: null,
      imageUrl: null,
      downloadUrl: null,
      provenance: {
        approvedRevision: request.approvedRevision,
        compositionVersion: null,
        generationMode: null
      }
    }))
  }

  it('accepts an exact newly reserved pack and sends the canonical request', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({
      campaignPackId,
      generations: queuedGenerations(),
      reservedOutputs: 3
    }, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createCampaignPack(request)).resolves.toMatchObject({
      campaignPackId,
      replayed: false,
      generations: expect.arrayContaining([
        expect.objectContaining({ workflowId: 'store-main', aspectRatio: '1:1', status: 'queued' })
      ])
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/campaign-packs')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(request)
  })

  it('accepts an exact idempotent replay envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      campaignPackId,
      generations: queuedGenerations(),
      replayed: true
    })))

    await expect(createCampaignPack(request)).resolves.toMatchObject({ campaignPackId, replayed: true })
  })

  it('rejects a generation that does not match the requested output set', async () => {
    const generations = queuedGenerations().map((generation, index) => index === 0
      ? { ...generation, workflowId: 'detail-banner' as const, aspectRatio: '16:5' as const }
      : generation)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      campaignPackId,
      generations,
      reservedOutputs: 3
    }, { status: 202 })))

    await expect(createCampaignPack(request)).rejects.toThrow(
      '未能確認 Campaign Pack 建立結果。 Unable to verify the Campaign Pack creation.'
    )
  })

  it('rejects an expanded success envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      campaignPackId,
      generations: queuedGenerations(),
      reservedOutputs: 3,
      privateObjectKeys: ['synthetic-private-key']
    }, { status: 202 })))

    await expect(createCampaignPack(request)).rejects.toThrow(
      '未能確認 Campaign Pack 建立結果。 Unable to verify the Campaign Pack creation.'
    )
  })

  it('rejects a Campaign Pack response whose streamed body exceeds the client limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `${' '.repeat(64 * 1024)}${JSON.stringify({
        campaignPackId,
        generations: queuedGenerations(),
        reservedOutputs: 3
      })}`,
      { status: 202, headers: { 'content-type': 'application/json' } }
    )))

    await expect(createCampaignPack(request)).rejects.toThrow(
      '未能確認 Campaign Pack 建立結果。 Unable to verify the Campaign Pack creation.'
    )
  })

  it('does not expose a server error detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: 'synthetic allowance ledger detail'
    }, { status: 503 })))

    await expect(createCampaignPack(request)).rejects.toThrow(
      'Campaign Pack 建立暫時無法使用。 Campaign Pack creation is temporarily unavailable.'
    )
  })

  it('rejects duplicate requested outputs before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(createCampaignPack({
      ...request,
      outputs: [request.outputs[0], request.outputs[0], request.outputs[2]]
    })).rejects.toThrow(
      'Campaign Pack 請求格式無效，請重新核對已批准計劃。 Campaign Pack request is invalid; review the approved plan.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
