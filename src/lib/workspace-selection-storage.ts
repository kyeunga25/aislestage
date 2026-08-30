export const WORKSPACE_SELECTION_HEADER = 'x-aislestage-workspace-id'
export const WORKSPACE_SELECTION_EVENT_NAME = 'aislestage.workspace-selection.v1'

const WORKSPACE_SELECTION_TAB_STORAGE_NAME = 'aislestage.current-workspace.v1'
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_MARKER_BYTES = 256
let selectedWorkspaceInMemory: string | null = null

function isBrowserContext() {
  return 'window' in globalThis
}

type WorkspaceSelectionMarker = {
  workspaceId: string
  nonce: string
}

function browserStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    const storage = globalThis[kind]
    return storage && typeof storage.getItem === 'function' ? storage : null
  } catch {
    return null
  }
}

function parseMarker(value: string | null): WorkspaceSelectionMarker | null {
  if (!value || value.length > MAX_MARKER_BYTES) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (Object.keys(record).length !== 2
      || typeof record.workspaceId !== 'string'
      || !uuidV4.test(record.workspaceId)
      || typeof record.nonce !== 'string'
      || !uuidV4.test(record.nonce)) return null
    return { workspaceId: record.workspaceId, nonce: record.nonce }
  } catch {
    return null
  }
}

export function readSelectedWorkspaceId() {
  if (isBrowserContext() && selectedWorkspaceInMemory) return selectedWorkspaceInMemory
  const session = browserStorage('sessionStorage')
  const selected = session?.getItem(WORKSPACE_SELECTION_TAB_STORAGE_NAME) || null
  if (selected && uuidV4.test(selected)) {
    if (isBrowserContext()) selectedWorkspaceInMemory = selected
    return selected
  }

  const marker = parseMarker(browserStorage('localStorage')?.getItem(WORKSPACE_SELECTION_EVENT_NAME) || null)
  if (!marker) return null
  if (isBrowserContext()) selectedWorkspaceInMemory = marker.workspaceId
  try {
    session?.setItem(WORKSPACE_SELECTION_TAB_STORAGE_NAME, marker.workspaceId)
  } catch {
    // The server still verifies the browser-wide cookie when storage is unavailable.
  }
  return marker.workspaceId
}

export function persistSelectedWorkspaceId(workspaceId: string, broadcast = false) {
  if (!uuidV4.test(workspaceId)) throw new TypeError('Invalid workspace selection')
  if (isBrowserContext()) selectedWorkspaceInMemory = workspaceId
  try {
    browserStorage('sessionStorage')?.setItem(WORKSPACE_SELECTION_TAB_STORAGE_NAME, workspaceId)
  } catch {
    // The HttpOnly selection cookie remains the headerless-resource fallback.
  }
  if (!broadcast) return
  try {
    const marker: WorkspaceSelectionMarker = { workspaceId, nonce: crypto.randomUUID() }
    browserStorage('localStorage')?.setItem(WORKSPACE_SELECTION_EVENT_NAME, JSON.stringify(marker))
  } catch {
    // Per-tab selection remains safe even when cross-tab notification is unavailable.
  }
}

export function workspaceIdFromSelectionEvent(event: { key: string | null; newValue: string | null }) {
  return event.key === WORKSPACE_SELECTION_EVENT_NAME ? parseMarker(event.newValue)?.workspaceId || null : null
}
