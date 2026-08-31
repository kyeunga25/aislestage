import { normalizeAccessFailureReason, type AccessFailureReason } from './access-login'
import { readBoundedJsonResponse } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import { persistSelectedWorkspaceId } from './workspace-selection-storage'
import type { AuthUser, PlatformStatus, WorkspaceSummary } from './types'

export type AuthedSession = {
  user: AuthUser
  currentWorkspace: WorkspaceSummary
}

export type SessionLoadResult = {
  session: AuthedSession | null
  failure: AccessFailureReason | null
}

export const sessionDataUnavailableMessage = '登入資料暫時無法確認。 Session data is temporarily unavailable.'
export const platformStatusUnavailableMessage = '平台狀態暫時無法確認。 Platform status is temporarily unavailable.'

const ACCESS_FAILURE_HEADER = 'x-aislestage-access-failure'
const MAX_SESSION_RESPONSE_BYTES = 16 * 1024
const MAX_PLATFORM_STATUS_RESPONSE_BYTES = 4 * 1024
const HYDRATION_REQUEST_TIMEOUT_MS = 15_000
const authenticatedSessionKeys = new Set(['authenticated', 'user', 'currentWorkspace'])
const authSessionKeys = new Set(['user', 'currentWorkspace'])
const unauthenticatedSessionKeys = new Set(['authenticated'])
const userKeys = new Set(['id', 'email', 'name', 'accountStatus', 'accountType'])
const workspaceKeys = new Set(['id', 'name', 'role', 'accessStatus', 'availableOutputs', 'reservedOutputs'])
const platformStatusKeys = new Set([
  'status',
  'service',
  'releaseMode',
  'authMode',
  'registrationMode',
  'registrationOpen',
  'generationEnabled',
  'generationMode',
  'agentMode'
])
const accountTypes = new Set(['standard', 'beta', 'test'])
const workspaceRoles = new Set(['owner', 'admin', 'member'])
const authModes = new Set(['access', 'password'])
const registrationModes = new Set(['open', 'invite', 'closed'])
const generationModes = new Set(['disabled', 'deterministic', 'assisted'])
const agentModes = new Set(['deterministic', 'assisted'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.size && actualKeys.every((key) => keys.has(key))
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength && value.trim().length > 0
}

function isEmail(value: unknown): value is string {
  return isText(value, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function normalizeActiveSession(user: unknown, currentWorkspace: unknown): AuthedSession | null {
  if (!isRecord(user)
    || !hasExactKeys(user, userKeys)
    || !isText(user.id, 64)
    || !isEmail(user.email)
    || !isText(user.name, 120)
    || user.accountStatus !== 'active'
    || !accountTypes.has(String(user.accountType))
    || !isRecord(currentWorkspace)
    || !hasExactKeys(currentWorkspace, workspaceKeys)
    || !isText(currentWorkspace.id, 64)
    || !isText(currentWorkspace.name, 120)
    || !workspaceRoles.has(String(currentWorkspace.role))
    || currentWorkspace.accessStatus !== 'active'
    || !isNonNegativeSafeInteger(currentWorkspace.availableOutputs)
    || !isNonNegativeSafeInteger(currentWorkspace.reservedOutputs)) return null

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      accountStatus: 'active',
      accountType: user.accountType as AuthUser['accountType']
    },
    currentWorkspace: {
      id: currentWorkspace.id,
      name: currentWorkspace.name,
      role: currentWorkspace.role as WorkspaceSummary['role'],
      accessStatus: 'active',
      availableOutputs: currentWorkspace.availableOutputs,
      reservedOutputs: currentWorkspace.reservedOutputs
    }
  }
}

function normalizeAuthenticatedSession(value: Record<string, unknown>): AuthedSession | null {
  if (value.authenticated !== true || !hasExactKeys(value, authenticatedSessionKeys)) return null
  return normalizeActiveSession(value.user, value.currentWorkspace)
}

export function normalizeAuthSessionPayload(value: unknown): AuthedSession | null {
  if (!isRecord(value) || !hasExactKeys(value, authSessionKeys)) return null
  return normalizeActiveSession(value.user, value.currentWorkspace)
}

export async function loadSession(): Promise<SessionLoadResult> {
  try {
    return await fetchWithTimeout(
      '/api/session',
      { credentials: 'same-origin' },
      HYDRATION_REQUEST_TIMEOUT_MS,
      async (response): Promise<SessionLoadResult> => {
        if (!response.ok) {
          const reason = normalizeAccessFailureReason(response.headers.get(ACCESS_FAILURE_HEADER))
          await response.body?.cancel().catch(() => undefined)
          return {
            session: null,
            failure: reason || (response.status >= 500 ? 'unavailable' : 'authentication-required')
          }
        }
        if (response.status !== 200) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(sessionDataUnavailableMessage)
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (contentType !== 'application/json') {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(sessionDataUnavailableMessage)
        }
        const data = await readBoundedJsonResponse(response, MAX_SESSION_RESPONSE_BYTES)
        if (!isRecord(data)) throw new Error(sessionDataUnavailableMessage)
        if (data.authenticated === false && hasExactKeys(data, unauthenticatedSessionKeys)) {
          return { session: null, failure: 'authentication-required' }
        }
        const session = normalizeAuthenticatedSession(data)
        if (!session) throw new Error(sessionDataUnavailableMessage)
        try {
          persistSelectedWorkspaceId(session.currentWorkspace.id)
        } catch {
          // Keep the established session contract even if selection persistence is unavailable.
        }
        return { session, failure: null }
      }
    )
  } catch {
    throw new Error(sessionDataUnavailableMessage)
  }
}

export function normalizePlatformStatus(value: unknown): PlatformStatus {
  if (!isRecord(value)
    || !hasExactKeys(value, platformStatusKeys)
    || value.status !== 'ok'
    || value.service !== 'campaign-asset-worker'
    || value.releaseMode !== 'restricted'
    || !authModes.has(String(value.authMode))
    || !registrationModes.has(String(value.registrationMode))
    || typeof value.registrationOpen !== 'boolean'
    || typeof value.generationEnabled !== 'boolean'
    || !generationModes.has(String(value.generationMode))
    || !agentModes.has(String(value.agentMode))) throw new Error(platformStatusUnavailableMessage)

  const registrationOpen = value.authMode === 'password' && value.registrationMode !== 'closed'
  const generationEnabled = value.generationMode !== 'disabled'
  if ((value.authMode === 'access' && value.registrationMode !== 'closed')
    || value.registrationOpen !== registrationOpen
    || value.generationEnabled !== generationEnabled) {
    throw new Error(platformStatusUnavailableMessage)
  }

  return {
    status: 'ok',
    service: 'campaign-asset-worker',
    releaseMode: 'restricted',
    authMode: value.authMode as PlatformStatus['authMode'],
    registrationMode: value.registrationMode as PlatformStatus['registrationMode'],
    registrationOpen,
    generationEnabled,
    generationMode: value.generationMode as PlatformStatus['generationMode'],
    agentMode: value.agentMode as PlatformStatus['agentMode']
  }
}

export async function loadPlatformStatus() {
  try {
    return await fetchWithTimeout(
      '/api/health',
      { credentials: 'same-origin' },
      HYDRATION_REQUEST_TIMEOUT_MS,
      async (response) => {
        if (!response.ok || response.status !== 200) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(platformStatusUnavailableMessage)
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (contentType !== 'application/json') {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(platformStatusUnavailableMessage)
        }
        const data = await readBoundedJsonResponse(response, MAX_PLATFORM_STATUS_RESPONSE_BYTES)
        return normalizePlatformStatus(data)
      }
    )
  } catch {
    throw new Error(platformStatusUnavailableMessage)
  }
}
