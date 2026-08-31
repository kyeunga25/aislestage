import { readSelectedWorkspaceId, WORKSPACE_SELECTION_HEADER } from './workspace-selection-storage'

function workspaceScopedInit(input: RequestInfo | URL, init: Omit<RequestInit, 'signal'> | undefined) {
  const selectedWorkspaceId = readSelectedWorkspaceId()
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!selectedWorkspaceId || !target.startsWith('/api/')) return init
  const headers = new Headers(init?.headers)
  if (!headers.has(WORKSPACE_SELECTION_HEADER)) headers.set(WORKSPACE_SELECTION_HEADER, selectedWorkspaceId)
  return { ...init, headers }
}

export async function fetchWithTimeout<T>(
  input: RequestInfo | URL,
  init: Omit<RequestInit, 'signal'> | undefined,
  timeoutMs: number,
  consume: (response: Response, signal: AbortSignal) => Promise<T>
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Invalid fetch timeout')
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(input, { ...workspaceScopedInit(input, init), signal: controller.signal })
    return await consume(response, controller.signal)
  } finally {
    clearTimeout(timeout)
  }
}
