import { readBoundedJsonResponse, readBoundedJsonResponseOutcome } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import { persistSelectedWorkspaceId } from './workspace-selection-storage'
import type { WorkspaceSummary } from './types'

export const workspaceListUnavailableMessage = '工作區清單暫時無法讀取。 Workspace list is temporarily unavailable.'
export const workspaceSelectionUnavailableMessage = '工作區暫時無法切換。 Workspace switch is temporarily unavailable.'

const MAX_WORKSPACE_LIST_BYTES = 64 * 1024
const MAX_WORKSPACE_SELECTION_BYTES = 16 * 1024
const WORKSPACE_REQUEST_TIMEOUT_MS = 15_000
const WORKSPACE_SELECTION_ATTEMPTS = 2
const workspaceListKeys = new Set(['workspaces', 'currentWorkspace'])
const workspaceSelectionKeys = new Set(['currentWorkspace'])
const workspaceKeys = new Set(['id', 'name', 'role', 'accessStatus', 'availableOutputs', 'reservedOutputs'])
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type WorkspaceList = {
  workspaces: WorkspaceSummary[]
  currentWorkspace: WorkspaceSummary
}

class WorkspaceSelectionAttemptError extends Error {
  constructor(readonly retryable: boolean) {
    super(workspaceSelectionUnavailableMessage)
    this.name = 'WorkspaceSelectionAttemptError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actual = Object.keys(value)
  return actual.length === keys.size && actual.every((key) => keys.has(key))
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function normalizeWorkspace(value: unknown): WorkspaceSummary | null {
  if (!isRecord(value)
    || !hasExactKeys(value, workspaceKeys)
    || typeof value.id !== 'string'
    || !uuidV4.test(value.id)
    || typeof value.name !== 'string'
    || value.name.length < 1
    || value.name.length > 120
    || value.name !== value.name.trim()
    || (value.role !== 'owner' && value.role !== 'admin' && value.role !== 'member')
    || value.accessStatus !== 'active'
    || !isNonNegativeSafeInteger(value.availableOutputs)
    || !isNonNegativeSafeInteger(value.reservedOutputs)) return null

  return {
    id: value.id,
    name: value.name,
    role: value.role,
    accessStatus: 'active',
    availableOutputs: value.availableOutputs,
    reservedOutputs: value.reservedOutputs
  }
}

function sameWorkspace(left: WorkspaceSummary, right: WorkspaceSummary) {
  return left.id === right.id
    && left.name === right.name
    && left.role === right.role
    && left.accessStatus === right.accessStatus
    && left.availableOutputs === right.availableOutputs
    && left.reservedOutputs === right.reservedOutputs
}

function normalizeWorkspaceList(value: unknown): WorkspaceList {
  if (!isRecord(value)
    || !hasExactKeys(value, workspaceListKeys)
    || !Array.isArray(value.workspaces)
    || value.workspaces.length < 1
    || value.workspaces.length > 50) throw new Error(workspaceListUnavailableMessage)

  const workspaces = value.workspaces.map(normalizeWorkspace)
  const currentWorkspace = normalizeWorkspace(value.currentWorkspace)
  if (!currentWorkspace
    || workspaces.some((workspace) => workspace === null)
    || new Set(workspaces.map((workspace) => workspace?.id)).size !== workspaces.length) {
    throw new Error(workspaceListUnavailableMessage)
  }
  const canonical = workspaces as WorkspaceSummary[]
  if (!sameWorkspace(canonical[0], currentWorkspace)) throw new Error(workspaceListUnavailableMessage)
  return { workspaces: canonical, currentWorkspace }
}

export async function loadWorkspaceList(): Promise<WorkspaceList> {
  try {
    return await fetchWithTimeout(
      '/api/workspaces',
      { credentials: 'same-origin' },
      WORKSPACE_REQUEST_TIMEOUT_MS,
      async (response) => {
        if (response.status !== 200 || !response.ok) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(workspaceListUnavailableMessage)
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (contentType !== 'application/json') {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(workspaceListUnavailableMessage)
        }
        return normalizeWorkspaceList(await readBoundedJsonResponse(response, MAX_WORKSPACE_LIST_BYTES))
      }
    )
  } catch {
    throw new Error(workspaceListUnavailableMessage)
  }
}

export async function loadWorkspaceListSnapshot(): Promise<{
  workspaceList: WorkspaceList | null
  error: string | null
}> {
  try {
    return { workspaceList: await loadWorkspaceList(), error: null }
  } catch (error) {
    return {
      workspaceList: null,
      error: error instanceof Error ? error.message : workspaceListUnavailableMessage
    }
  }
}

async function selectionAttempt(workspaceId: string, body: string) {
  return fetchWithTimeout(
    '/api/workspaces/current',
    {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body
    },
    WORKSPACE_REQUEST_TIMEOUT_MS,
    async (response, signal) => {
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new WorkspaceSelectionAttemptError(response.status === 408 || response.status >= 500)
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined)
        throw new WorkspaceSelectionAttemptError(false)
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        await response.body?.cancel().catch(() => undefined)
        throw new WorkspaceSelectionAttemptError(false)
      }
      const outcome = await readBoundedJsonResponseOutcome(response, MAX_WORKSPACE_SELECTION_BYTES)
      if (signal.aborted || outcome.kind === 'stream-error') throw new WorkspaceSelectionAttemptError(true)
      const data = outcome.kind === 'value' ? outcome.value : null
      if (!isRecord(data) || !hasExactKeys(data, workspaceSelectionKeys)) {
        throw new WorkspaceSelectionAttemptError(false)
      }
      const currentWorkspace = normalizeWorkspace(data.currentWorkspace)
      if (!currentWorkspace || currentWorkspace.id !== workspaceId) {
        throw new WorkspaceSelectionAttemptError(false)
      }
      return currentWorkspace
    }
  )
}

export async function selectCurrentWorkspace(workspaceId: string) {
  if (typeof workspaceId !== 'string' || !uuidV4.test(workspaceId)) {
    throw new Error(workspaceSelectionUnavailableMessage)
  }
  const body = JSON.stringify({ workspaceId })
  for (let attempt = 0; attempt < WORKSPACE_SELECTION_ATTEMPTS; attempt += 1) {
    try {
      const selected = await selectionAttempt(workspaceId, body)
      persistSelectedWorkspaceId(selected.id, true)
      return selected
    } catch (error) {
      const retryable = !(error instanceof WorkspaceSelectionAttemptError) || error.retryable
      if (retryable && attempt + 1 < WORKSPACE_SELECTION_ATTEMPTS) continue
      throw new Error(workspaceSelectionUnavailableMessage)
    }
  }
  throw new Error(workspaceSelectionUnavailableMessage)
}
