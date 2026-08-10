import { afterEach, describe, expect, it, vi } from 'vitest'
import { submitGenerationReview } from '../src/lib/generation-review-client'
import { normalizeGenerationResults } from '../src/lib/generation-loader'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('generation review client', () => {
  const generationId = '123e4567-e89b-42d3-a456-426614174000'
  const canonicalDraft = {
    id: generationId,
    campaignPackId: '123e4567-e89b-42d3-b456-426614174000',
    workflowId: 'store-main',
    aspectRatio: '1:1',
    status: 'completed',
    contentType: 'image/svg+xml',
    approvedRevision: 3,
    errorMessage: null,
    createdAt: '2026-08-10 12:00:00',
    reviewStatus: 'draft',
    reviewedAt: null,
    imageUrl: `/api/generations/${generationId}/image`,
    downloadUrl: null,
    provenance: {
      approvedRevision: 3,
      compositionVersion: 'deterministic-svg-v1',
      generationMode: 'deterministic'
    }
  } as const

  function currentDraft() {
    return normalizeGenerationResults([canonicalDraft])[0]!
  }

  function reviewedGeneration(reviewStatus: 'approved' | 'rejected') {
    return {
      ...canonicalDraft,
      reviewStatus,
      reviewedAt: '2026-08-10 12:05:00',
      downloadUrl: reviewStatus === 'approved' ? `/api/generations/${generationId}/download` : null
    }
  }

  it('accepts the exact reviewed generation and sends only the canonical decision fields', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({
      generation: reviewedGeneration('approved'),
      replayed: false
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitGenerationReview(currentDraft(), 'approve')).resolves.toMatchObject({
      id: generationId,
      reviewStatus: 'approved',
      downloadUrl: `/api/generations/${generationId}/download`
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/generations/${generationId}/review`)
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      decision: 'approve',
      expectedApprovedRevision: 3
    })
  })

  it('rejects a response for another generation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      generation: {
        ...reviewedGeneration('approved'),
        id: '223e4567-e89b-42d3-a456-426614174000',
        imageUrl: '/api/generations/223e4567-e89b-42d3-a456-426614174000/image',
        downloadUrl: '/api/generations/223e4567-e89b-42d3-a456-426614174000/download'
      },
      replayed: false
    })))

    await expect(submitGenerationReview(currentDraft(), 'approve')).rejects.toThrow(
      '未能確認輸出審核結果。 Unable to verify the output review.'
    )
  })

  it('rejects changed immutable generation metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      generation: { ...reviewedGeneration('rejected'), workflowId: 'meta-ad' },
      replayed: false
    })))

    await expect(submitGenerationReview(currentDraft(), 'reject')).rejects.toThrow(
      '未能確認輸出審核結果。 Unable to verify the output review.'
    )
  })

  it('rejects an expanded review response envelope', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      generation: reviewedGeneration('approved'),
      replayed: false,
      reviewer: 'synthetic-private-reviewer'
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitGenerationReview(currentDraft(), 'approve')).rejects.toThrow(
      '未能確認輸出審核結果。 Unable to verify the output review.'
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects a canonical review returned with a non-canonical success status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      generation: reviewedGeneration('approved'),
      replayed: false
    }, { status: 201 })))

    await expect(submitGenerationReview(currentDraft(), 'approve')).rejects.toThrow(
      '未能確認輸出審核結果。 Unable to verify the output review.'
    )
  })

  it('rejects a review response whose streamed body exceeds the client limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `${' '.repeat(16 * 1024)}${JSON.stringify({
        generation: reviewedGeneration('approved'),
        replayed: false
      })}`,
      { headers: { 'content-type': 'application/json' } }
    )))

    await expect(submitGenerationReview(currentDraft(), 'approve')).rejects.toThrow(
      '未能確認輸出審核結果。 Unable to verify the output review.'
    )
  })

  it('does not expose a server error detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: 'synthetic private generation detail'
    }, { status: 503 })))

    await expect(submitGenerationReview(currentDraft(), 'approve')).rejects.toThrow(
      '輸出審核暫時無法使用。 Output review is temporarily unavailable.'
    )
  })

  it('retries one deadline with the same immutable review decision', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      if (fetchMock.mock.calls.length > 1) {
        return Promise.resolve(Response.json({ generation: reviewedGeneration('approved'), replayed: true }))
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const review = submitGenerationReview(currentDraft(), 'approve')
    const assertion = expect(review).resolves.toMatchObject({ id: generationId, reviewStatus: 'approved' })
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => call[1]?.body)).toEqual([
      JSON.stringify({ decision: 'approve', expectedApprovedRevision: 3 }),
      JSON.stringify({ decision: 'approve', expectedApprovedRevision: 3 })
    ])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries when response headers arrive but the review body stalls', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (fetchMock.mock.calls.length > 1) {
        return Response.json({ generation: reviewedGeneration('rejected'), replayed: true })
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{'))
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        }
      })
      return new Response(body, { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const review = submitGenerationReview(currentDraft(), 'reject')
    const assertion = expect(review).resolves.toMatchObject({ id: generationId, reviewStatus: 'rejected' })
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries one server-unavailable response and accepts an authoritative replay', async () => {
    const fetchMock = vi.fn(async () => fetchMock.mock.calls.length === 1
      ? Response.json({ error: 'synthetic temporary failure' }, { status: 503 })
      : Response.json({ generation: reviewedGeneration('approved'), replayed: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitGenerationReview(currentDraft(), 'approve')).resolves.toMatchObject({
      id: generationId,
      reviewStatus: 'approved'
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not replay a review-state conflict', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: 'synthetic state detail' }, { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitGenerationReview(currentDraft(), 'approve')).rejects.toThrow(
      '輸出版本或審核狀態已改變，請重新載入。 The output revision or review state changed; reload it.'
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('stops after two review deadlines and clears both timers', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const review = submitGenerationReview(currentDraft(), 'approve')
    const assertion = expect(review).rejects.toThrow(
      '輸出審核暫時無法使用。 Output review is temporarily unavailable.'
    )
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects an incomplete source generation before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitGenerationReview({ ...currentDraft(), approvedRevision: undefined }, 'approve')).rejects.toThrow(
      '輸出缺少可核對的批准版本，請重新載入。 The output is missing a verifiable approved revision; reload it.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
