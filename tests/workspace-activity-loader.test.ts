import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadWorkspaceActivity,
  loadWorkspaceActivitySnapshot,
  workspaceActivityUnavailableMessage
} from '../src/lib/workspace-activity-loader'

const canonicalEvent = {
  id: '0123456789abcdef0123456789abcdef',
  type: 'campaign_pack_created',
  actorName: 'Synthetic Owner',
  createdAt: '2026-08-30T05:00:00Z'
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

describe('workspace activity loader', () => {
  it('accepts an exact canonical manager activity envelope', async () => {
    const fetchMock = vi.fn(async () => Response.json({ activity: [canonicalEvent] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadWorkspaceActivity()).resolves.toEqual([canonicalEvent])
    expect(fetchMock).toHaveBeenCalledWith('/api/workspace-activity', expect.objectContaining({
      credentials: 'same-origin',
      signal: expect.any(AbortSignal)
    }))
  })

  it.each([
    { activity: [{ ...canonicalEvent, internalSubjectId: 'private-subject' }] },
    { activity: [{ ...canonicalEvent, type: 'unknown_event' }] },
    { activity: [{ ...canonicalEvent, actorName: 'x'.repeat(121) }] },
    { activity: [{ ...canonicalEvent, createdAt: 'not-a-time' }] },
    { activity: [{ ...canonicalEvent, createdAt: '2026-02-31T05:00:00Z' }] },
    { activity: [canonicalEvent, canonicalEvent] },
    { activity: Array.from({ length: 51 }, (_, index) => ({ ...canonicalEvent, id: index.toString(16).padStart(32, '0') })) },
    { activity: [], privateCursor: 'do-not-trust' }
  ])('rejects malformed or expanded activity data %#', async (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)))
    await expect(loadWorkspaceActivity()).rejects.toThrow(workspaceActivityUnavailableMessage)
  })

  it('rejects non-canonical status, media type, and oversized bodies without exposing server details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      code: 'unavailable',
      error: 'synthetic private database detail'
    }, { status: 503 })))
    await expect(loadWorkspaceActivity()).rejects.toThrow(workspaceActivityUnavailableMessage)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ activity: [] }), {
      headers: { 'content-type': 'text/plain' }
    })))
    await expect(loadWorkspaceActivity()).rejects.toThrow(workspaceActivityUnavailableMessage)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `${' '.repeat(64 * 1024)}${JSON.stringify({ activity: [] })}`,
      { headers: { 'content-type': 'application/json' } }
    )))
    await expect(loadWorkspaceActivity()).rejects.toThrow(workspaceActivityUnavailableMessage)
  })

  it('returns no authoritative snapshot when the request deadline expires', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchAfterDeadline(() => Response.json({ activity: [] })))

    const snapshot = loadWorkspaceActivitySnapshot()
    const assertion = expect(snapshot).resolves.toEqual({
      activity: null,
      error: workspaceActivityUnavailableMessage
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })
})
