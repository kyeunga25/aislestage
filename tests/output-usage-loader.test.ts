import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadOutputUsage,
  loadOutputUsageSnapshot,
  outputUsageUnavailableMessage
} from '../src/lib/output-usage-loader'

const canonicalUsage = {
  allowance: {
    availableOutputs: 6,
    reservedOutputs: 1,
    updatedAt: '2026-08-30T05:10:00Z'
  },
  summary: {
    completedOutputs: 4,
    releasedOutputs: 1
  },
  events: [{
    type: 'reservation',
    amount: -1,
    createdAt: '2026-08-30T05:00:00Z'
  }, {
    type: 'settlement',
    amount: 0,
    createdAt: '2026-08-30T05:05:00Z'
  }, {
    type: 'release',
    amount: 1,
    createdAt: '2026-08-30T05:06:00Z'
  }]
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function fetchAfterDeadline(response: () => Response) {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const completion = setTimeout(() => resolve(response()), 30_000)
    init?.signal?.addEventListener('abort', () => {
      clearTimeout(completion)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  }))
}

describe('output usage loader', () => {
  it('accepts one exact bounded workspace usage snapshot', async () => {
    const fetchMock = vi.fn(async () => Response.json(canonicalUsage))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadOutputUsage()).resolves.toEqual(canonicalUsage)
    expect(fetchMock).toHaveBeenCalledWith('/api/output-usage', expect.objectContaining({
      credentials: 'same-origin',
      signal: expect.any(AbortSignal)
    }))
  })

  it.each([
    { ...canonicalUsage, privateCursor: 'do-not-trust' },
    { ...canonicalUsage, allowance: { ...canonicalUsage.allowance, workspaceId: 'private-workspace' } },
    { ...canonicalUsage, allowance: { ...canonicalUsage.allowance, availableOutputs: -1 } },
    { ...canonicalUsage, allowance: { ...canonicalUsage.allowance, reservedOutputs: 1.5 } },
    { ...canonicalUsage, allowance: { ...canonicalUsage.allowance, updatedAt: '2026-02-31T05:00:00Z' } },
    { ...canonicalUsage, summary: { ...canonicalUsage.summary, completedOutputs: -1 } },
    { ...canonicalUsage, events: [{ ...canonicalUsage.events[0], generationId: 'private-generation' }] },
    { ...canonicalUsage, events: [{ ...canonicalUsage.events[0], type: 'grant' }] },
    { ...canonicalUsage, events: [{ ...canonicalUsage.events[0], amount: 1 }] },
    { ...canonicalUsage, events: [{ ...canonicalUsage.events[0], createdAt: 'not-a-time' }] },
    { ...canonicalUsage, events: Array.from({ length: 51 }, () => canonicalUsage.events[0]) }
  ])('rejects malformed, expanded, or identity-bearing usage data %#', async (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)))
    await expect(loadOutputUsage()).rejects.toThrow(outputUsageUnavailableMessage)
  })

  it('rejects non-canonical status, media type, and oversized bodies without exposing details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'private ledger detail' }, { status: 503 })))
    await expect(loadOutputUsage()).rejects.toThrow(outputUsageUnavailableMessage)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(canonicalUsage), {
      headers: { 'content-type': 'text/plain' }
    })))
    await expect(loadOutputUsage()).rejects.toThrow(outputUsageUnavailableMessage)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `${' '.repeat(64 * 1024)}${JSON.stringify(canonicalUsage)}`,
      { headers: { 'content-type': 'application/json' } }
    )))
    await expect(loadOutputUsage()).rejects.toThrow(outputUsageUnavailableMessage)
  })

  it('keeps the prior usage snapshot authoritative when the deadline expires', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchAfterDeadline(() => Response.json(canonicalUsage)))

    const snapshot = loadOutputUsageSnapshot()
    const assertion = expect(snapshot).resolves.toEqual({
      usage: null,
      error: outputUsageUnavailableMessage
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })
})
