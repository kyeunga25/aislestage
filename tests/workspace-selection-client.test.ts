import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadWorkspaceList,
  loadWorkspaceListSnapshot,
  selectCurrentWorkspace,
  workspaceListUnavailableMessage,
  workspaceSelectionUnavailableMessage
} from '../src/lib/workspace-selection-client'
import {
  persistSelectedWorkspaceId,
  readSelectedWorkspaceId,
  WORKSPACE_SELECTION_EVENT_NAME,
  WORKSPACE_SELECTION_HEADER,
  workspaceIdFromSelectionEvent
} from '../src/lib/workspace-selection-storage'

const firstWorkspace = {
  id: '123e4567-e89b-42d3-a456-426614174301',
  name: 'Primary Workspace',
  role: 'owner' as const,
  accessStatus: 'active' as const,
  availableOutputs: 5,
  reservedOutputs: 1
}

const secondWorkspace = {
  id: '123e4567-e89b-42d3-a456-426614174302',
  name: 'Campaign Team',
  role: 'member' as const,
  accessStatus: 'active' as const,
  availableOutputs: 2,
  reservedOutputs: 0
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) }
  }
}

describe('workspace selection client', () => {
  it('loads an exact active list whose first item matches currentWorkspace', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      workspaces: [firstWorkspace, secondWorkspace],
      currentWorkspace: firstWorkspace
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadWorkspaceList()).resolves.toEqual({
      workspaces: [firstWorkspace, secondWorkspace],
      currentWorkspace: firstWorkspace
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces', expect.objectContaining({
      credentials: 'same-origin',
      signal: expect.any(AbortSignal)
    }))
  })

  it('adds the validated per-tab workspace header to same-origin API requests', async () => {
    vi.stubGlobal('sessionStorage', memoryStorage())
    vi.stubGlobal('localStorage', memoryStorage())
    persistSelectedWorkspaceId(firstWorkspace.id)
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      workspaces: [firstWorkspace],
      currentWorkspace: firstWorkspace
    }))
    vi.stubGlobal('fetch', fetchMock)

    await loadWorkspaceList()
    const headers = fetchMock.mock.calls[0][1]?.headers
    expect(headers).toBeInstanceOf(Headers)
    expect((headers as Headers).get(WORKSPACE_SELECTION_HEADER)).toBe(firstWorkspace.id)
  })

  it('persists an exact selection for the current tab and emits a bounded cross-tab marker', () => {
    const sessionStorage = memoryStorage()
    const localStorage = memoryStorage()
    vi.stubGlobal('sessionStorage', sessionStorage)
    vi.stubGlobal('localStorage', localStorage)

    persistSelectedWorkspaceId(secondWorkspace.id, true)

    expect(readSelectedWorkspaceId()).toBe(secondWorkspace.id)
    const marker = localStorage.getItem(WORKSPACE_SELECTION_EVENT_NAME)
    expect(marker).toBeTruthy()
    expect(workspaceIdFromSelectionEvent({
      key: WORKSPACE_SELECTION_EVENT_NAME,
      newValue: marker
    })).toBe(secondWorkspace.id)
    expect(workspaceIdFromSelectionEvent({
      key: WORKSPACE_SELECTION_EVENT_NAME,
      newValue: JSON.stringify({ workspaceId: secondWorkspace.id, nonce: 'invalid' })
    })).toBeNull()
  })

  it.each([
    { workspaces: [firstWorkspace], currentWorkspace: secondWorkspace },
    { workspaces: [secondWorkspace, firstWorkspace], currentWorkspace: firstWorkspace },
    { workspaces: [firstWorkspace, firstWorkspace], currentWorkspace: firstWorkspace },
    { workspaces: [{ ...firstWorkspace, workspaceId: 'private-id' }], currentWorkspace: firstWorkspace },
    { workspaces: [{ ...firstWorkspace, accessStatus: 'suspended' }], currentWorkspace: firstWorkspace },
    { workspaces: Array.from({ length: 51 }, (_, index) => ({ ...firstWorkspace, id: `123e4567-e89b-42d3-a456-${String(426614174301 + index).padStart(12, '0')}` })), currentWorkspace: firstWorkspace },
    { workspaces: [firstWorkspace], currentWorkspace: firstWorkspace, cursor: 'private-cursor' }
  ])('rejects malformed, expanded or inconsistent list data %#', async (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)))
    await expect(loadWorkspaceList()).rejects.toThrow(workspaceListUnavailableMessage)
  })

  it('preserves the prior trusted UI state through a snapshot error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'private database detail' }, { status: 503 })))
    await expect(loadWorkspaceListSnapshot()).resolves.toEqual({
      workspaceList: null,
      error: workspaceListUnavailableMessage
    })
  })

  it('selects one workspace with an exact idempotent request and acknowledgement', async () => {
    const fetchMock = vi.fn(async () => Response.json({ currentWorkspace: secondWorkspace }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(selectCurrentWorkspace(secondWorkspace.id)).resolves.toEqual(secondWorkspace)
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/current', expect.objectContaining({
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: secondWorkspace.id }),
      signal: expect.any(AbortSignal)
    }))
  })

  it('retries the idempotent selection at most once after a temporary server failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'private detail' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ currentWorkspace: secondWorkspace }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(selectCurrentWorkspace(secondWorkspace.id)).resolves.toEqual(secondWorkspace)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1]?.body).toBe(fetchMock.mock.calls[1][1]?.body)
  })

  it.each([
    { currentWorkspace: firstWorkspace },
    { currentWorkspace: { ...secondWorkspace, internalId: 'private' } },
    { currentWorkspace: { ...secondWorkspace, role: 'super-admin' } },
    { currentWorkspace: secondWorkspace, replayed: true }
  ])('rejects malformed or identity-mismatched success data %#', async (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)))
    await expect(selectCurrentWorkspace(secondWorkspace.id)).rejects.toThrow(workspaceSelectionUnavailableMessage)
  })

  it('rejects invalid local workspace identifiers before sending a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(selectCurrentWorkspace('not-a-workspace')).rejects.toThrow(workspaceSelectionUnavailableMessage)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bounds stalled selection attempts and releases the caller', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })))

    const request = selectCurrentWorkspace(secondWorkspace.id)
    const expectation = expect(request).rejects.toThrow(workspaceSelectionUnavailableMessage)
    await vi.advanceTimersByTimeAsync(30_000)
    await expectation
  })
})
