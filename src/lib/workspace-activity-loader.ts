import { readBoundedJsonResponse } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import type { WorkspaceActivityEvent, WorkspaceActivityEventType } from './types'

export const workspaceActivityUnavailableMessage = '工作區活動暫時無法讀取。 Workspace activity is temporarily unavailable.'

const MAX_ACTIVITY_RESPONSE_BYTES = 64 * 1024
const ACTIVITY_REQUEST_TIMEOUT_MS = 15_000
const responseKeys = new Set(['activity'])
const activityKeys = new Set(['id', 'type', 'actorName', 'createdAt'])
const activityTypes = new Set<WorkspaceActivityEventType>([
  'product_asset_uploaded',
  'product_asset_deleted',
  'campaign_pack_created',
  'generation_approved',
  'generation_rejected',
  'generation_deleted'
])
const activityIdPattern = /^[A-Za-z0-9-]{1,64}$/
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actual = Object.keys(value)
  return actual.length === keys.size && actual.every((key) => keys.has(key))
}

function isActivityEvent(value: unknown): value is WorkspaceActivityEvent {
  if (!isRecord(value) || !hasExactKeys(value, activityKeys)) return false
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : null
  const parsedCreatedAt = createdAt !== null && utcTimestampPattern.test(createdAt)
    ? new Date(createdAt)
    : null
  return typeof value.id === 'string'
    && activityIdPattern.test(value.id)
    && activityTypes.has(value.type as WorkspaceActivityEventType)
    && (value.actorName === null || (typeof value.actorName === 'string' && value.actorName.length > 0 && value.actorName.length <= 120))
    && createdAt !== null
    && parsedCreatedAt !== null
    && Number.isFinite(parsedCreatedAt.getTime())
    && parsedCreatedAt.toISOString() === createdAt.replace(/Z$/, '.000Z')
}

export function normalizeWorkspaceActivity(value: unknown): WorkspaceActivityEvent[] {
  if (!Array.isArray(value) || value.length > 50 || !value.every(isActivityEvent)) {
    throw new Error(workspaceActivityUnavailableMessage)
  }
  const ids = value.map((event) => event.id)
  if (new Set(ids).size !== ids.length) throw new Error(workspaceActivityUnavailableMessage)
  return value
}

export async function loadWorkspaceActivity() {
  try {
    return await fetchWithTimeout(
      '/api/workspace-activity',
      { credentials: 'same-origin' },
      ACTIVITY_REQUEST_TIMEOUT_MS,
      async (response) => {
        if (response.status !== 200 || !response.ok) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(workspaceActivityUnavailableMessage)
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (contentType !== 'application/json') {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(workspaceActivityUnavailableMessage)
        }
        const data = await readBoundedJsonResponse(response, MAX_ACTIVITY_RESPONSE_BYTES)
        if (!isRecord(data) || !hasExactKeys(data, responseKeys)) throw new Error(workspaceActivityUnavailableMessage)
        return normalizeWorkspaceActivity(data.activity)
      }
    )
  } catch {
    throw new Error(workspaceActivityUnavailableMessage)
  }
}

export async function loadWorkspaceActivitySnapshot(): Promise<{
  activity: WorkspaceActivityEvent[] | null
  error: string | null
}> {
  try {
    return { activity: await loadWorkspaceActivity(), error: null }
  } catch (error) {
    return {
      activity: null,
      error: error instanceof Error ? error.message : workspaceActivityUnavailableMessage
    }
  }
}
