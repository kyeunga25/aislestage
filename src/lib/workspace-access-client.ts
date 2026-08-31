import { readBoundedJsonResponse, readBoundedJsonResponseOutcome } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import type { WorkspaceMember } from './types'

export const workspaceMembersUnavailableMessage = '工作區成員暫時無法讀取。 Workspace members are temporarily unavailable.'
export const workspaceMemberInviteUnavailableMessage = '成員邀請暫時無法使用。 Workspace member invitation is temporarily unavailable.'
export const workspaceMemberRoleUnavailableMessage = '成員角色更新暫時無法使用。 Workspace member role update is temporarily unavailable.'
export const workspaceMemberRemovalUnavailableMessage = '成員移除暫時無法使用。 Workspace member removal is temporarily unavailable.'

const MAX_MEMBER_LIST_BYTES = 64 * 1024
const MAX_MEMBER_MUTATION_BYTES = 16 * 1024
const MEMBER_REQUEST_TIMEOUT_MS = 15_000
const MEMBER_MUTATION_ATTEMPTS = 2
const memberListKeys = new Set(['members'])
const mutationKeys = new Set(['member', 'replayed'])
const memberKeys = new Set(['id', 'name', 'email', 'role', 'accountStatus', 'authMode', 'createdAt'])
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

class WorkspaceMemberAttemptError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'WorkspaceMemberAttemptError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actual = Object.keys(value)
  return actual.length === keys.size && actual.every((key) => keys.has(key))
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !utcTimestampPattern.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value.replace(/Z$/, '.000Z')
}

function normalizeWorkspaceMember(value: unknown): WorkspaceMember | null {
  if (!isRecord(value)
    || !hasExactKeys(value, memberKeys)
    || typeof value.id !== 'string'
    || !uuidV4.test(value.id)
    || typeof value.name !== 'string'
    || value.name.length < 1
    || value.name.length > 120
    || value.name !== value.name.trim()
    || typeof value.email !== 'string'
    || value.email.length > 254
    || value.email !== value.email.trim().toLowerCase()
    || !emailPattern.test(value.email)
    || (value.role !== 'owner' && value.role !== 'admin' && value.role !== 'member')
    || (value.accountStatus !== 'active' && value.accountStatus !== 'suspended' && value.accountStatus !== 'deactivated')
    || (value.authMode !== 'access' && value.authMode !== 'password')
    || !isCanonicalUtcTimestamp(value.createdAt)) return null
  return {
    id: value.id,
    name: value.name,
    email: value.email,
    role: value.role,
    accountStatus: value.accountStatus,
    authMode: value.authMode,
    createdAt: value.createdAt
  }
}

export function normalizeWorkspaceMembers(value: unknown): WorkspaceMember[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw new Error(workspaceMembersUnavailableMessage)
  }
  const members = value.map(normalizeWorkspaceMember)
  if (members.some((member) => member === null)) throw new Error(workspaceMembersUnavailableMessage)
  const canonical = members as WorkspaceMember[]
  if (new Set(canonical.map((member) => member.id)).size !== canonical.length
    || new Set(canonical.map((member) => member.email)).size !== canonical.length
    || canonical.filter((member) => member.role === 'owner').length !== 1) {
    throw new Error(workspaceMembersUnavailableMessage)
  }
  return canonical
}

export async function loadWorkspaceMembers() {
  try {
    return await fetchWithTimeout(
      '/api/workspace-members',
      { credentials: 'same-origin' },
      MEMBER_REQUEST_TIMEOUT_MS,
      async (response) => {
        if (response.status !== 200 || !response.ok) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(workspaceMembersUnavailableMessage)
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (contentType !== 'application/json') {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(workspaceMembersUnavailableMessage)
        }
        const data = await readBoundedJsonResponse(response, MAX_MEMBER_LIST_BYTES)
        if (!isRecord(data) || !hasExactKeys(data, memberListKeys)) throw new Error(workspaceMembersUnavailableMessage)
        return normalizeWorkspaceMembers(data.members)
      }
    )
  } catch {
    throw new Error(workspaceMembersUnavailableMessage)
  }
}

export async function loadWorkspaceMembersSnapshot(): Promise<{
  members: WorkspaceMember[] | null
  error: string | null
}> {
  try {
    return { members: await loadWorkspaceMembers(), error: null }
  } catch (error) {
    return {
      members: null,
      error: error instanceof Error ? error.message : workspaceMembersUnavailableMessage
    }
  }
}

function mutationFailureMessage(kind: 'invite' | 'role', status: number) {
  if (status === 400 || status === 413 || status === 415) {
    return kind === 'invite'
      ? '成員資料格式無效，請核對後再試。 Workspace member details are invalid; review them and retry.'
      : '成員角色格式無效，請重新載入。 Workspace member role is invalid; reload it.'
  }
  if (status === 401 || status === 403) {
    return '工作區管理權限已改變，請重新載入或登入。 Workspace management permission changed; reload or sign in again.'
  }
  if (status === 404) return '找不到這個工作區成員，請重新載入。 Workspace member was not found; reload the list.'
  if (status === 409) {
    return kind === 'invite'
      ? '這個帳號已有不同角色或目前不可加入。 This account has a different role or cannot be added.'
      : '這個成員角色不可變更。 This workspace member role cannot be changed.'
  }
  return kind === 'invite' ? workspaceMemberInviteUnavailableMessage : workspaceMemberRoleUnavailableMessage
}

async function memberMutationAttempt(options: {
  kind: 'invite' | 'role'
  path: string
  method: 'POST' | 'PATCH'
  body: string
  expectedId?: string
  expectedEmail?: string
  expectedRole: 'admin' | 'member'
}) {
  return fetchWithTimeout(
    options.path,
    {
      method: options.method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: options.body
    },
    MEMBER_REQUEST_TIMEOUT_MS,
    async (response, signal) => {
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new WorkspaceMemberAttemptError(
          mutationFailureMessage(options.kind, response.status),
          response.status === 408 || response.status >= 500
        )
      }
      const statusAllowed = options.kind === 'invite'
        ? response.status === 200 || response.status === 201
        : response.status === 200
      if (!statusAllowed) {
        await response.body?.cancel().catch(() => undefined)
        throw new WorkspaceMemberAttemptError(
          options.kind === 'invite' ? workspaceMemberInviteUnavailableMessage : workspaceMemberRoleUnavailableMessage,
          false
        )
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        await response.body?.cancel().catch(() => undefined)
        throw new WorkspaceMemberAttemptError(
          options.kind === 'invite' ? workspaceMemberInviteUnavailableMessage : workspaceMemberRoleUnavailableMessage,
          false
        )
      }
      const outcome = await readBoundedJsonResponseOutcome(response, MAX_MEMBER_MUTATION_BYTES)
      const unavailable = options.kind === 'invite' ? workspaceMemberInviteUnavailableMessage : workspaceMemberRoleUnavailableMessage
      if (signal.aborted || outcome.kind === 'stream-error') {
        throw new WorkspaceMemberAttemptError(unavailable, true)
      }
      const data = outcome.kind === 'value' ? outcome.value : null
      if (!isRecord(data)
        || !hasExactKeys(data, mutationKeys)
        || typeof data.replayed !== 'boolean'
        || (options.kind === 'invite' && (response.status === 201) !== !data.replayed)) {
        throw new WorkspaceMemberAttemptError(unavailable, false)
      }
      const member = normalizeWorkspaceMember(data.member)
      if (!member
        || member.role !== options.expectedRole
        || (options.expectedId && member.id !== options.expectedId)
        || (options.expectedEmail && member.email !== options.expectedEmail)) {
        throw new WorkspaceMemberAttemptError(unavailable, false)
      }
      return member
    }
  )
}

async function runMemberMutation(options: Parameters<typeof memberMutationAttempt>[0]) {
  for (let attempt = 0; attempt < MEMBER_MUTATION_ATTEMPTS; attempt += 1) {
    try {
      return await memberMutationAttempt(options)
    } catch (error) {
      const retryable = !(error instanceof WorkspaceMemberAttemptError) || error.retryable
      if (retryable && attempt + 1 < MEMBER_MUTATION_ATTEMPTS) continue
      const fallback = options.kind === 'invite' ? workspaceMemberInviteUnavailableMessage : workspaceMemberRoleUnavailableMessage
      throw new Error(error instanceof WorkspaceMemberAttemptError ? error.message : fallback)
    }
  }
  throw new Error(options.kind === 'invite' ? workspaceMemberInviteUnavailableMessage : workspaceMemberRoleUnavailableMessage)
}

export async function inviteWorkspaceMember(input: {
  email: string
  name: string
  role: 'admin' | 'member'
}) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (email !== input.email
    || !emailPattern.test(email)
    || email.length > 254
    || name !== input.name
    || name.length < 1
    || name.length > 120
    || (input.role !== 'admin' && input.role !== 'member')) {
    throw new Error('成員資料格式無效，請核對後再試。 Workspace member details are invalid; review them and retry.')
  }
  return runMemberMutation({
    kind: 'invite',
    path: '/api/workspace-members',
    method: 'POST',
    body: JSON.stringify({ email, name, role: input.role }),
    expectedEmail: email,
    expectedRole: input.role
  })
}

export async function updateWorkspaceMemberRole(memberId: string, role: 'admin' | 'member') {
  if (typeof memberId !== 'string' || !uuidV4.test(memberId) || (role !== 'admin' && role !== 'member')) {
    throw new Error('成員角色格式無效，請重新載入。 Workspace member role is invalid; reload it.')
  }
  return runMemberMutation({
    kind: 'role',
    path: `/api/workspace-members/${encodeURIComponent(memberId)}`,
    method: 'PATCH',
    body: JSON.stringify({ role }),
    expectedId: memberId,
    expectedRole: role
  })
}

export async function removeWorkspaceMember(memberId: string) {
  if (typeof memberId !== 'string' || !uuidV4.test(memberId)) {
    throw new Error('成員識別資料無效，請重新載入。 Workspace member identity is invalid; reload it.')
  }
  for (let attempt = 0; attempt < MEMBER_MUTATION_ATTEMPTS; attempt += 1) {
    try {
      const result = await fetchWithTimeout(
        `/api/workspace-members/${encodeURIComponent(memberId)}`,
        { method: 'DELETE', credentials: 'same-origin' },
        MEMBER_REQUEST_TIMEOUT_MS,
        async (response) => {
          const status = response.status
          const ok = response.ok
          await response.body?.cancel().catch(() => undefined)
          return { status, ok }
        }
      )
      if (result.status === 204 || result.status === 404) return
      if (result.status === 408 || result.status >= 500) {
        if (attempt + 1 < MEMBER_MUTATION_ATTEMPTS) continue
        throw new WorkspaceMemberAttemptError(workspaceMemberRemovalUnavailableMessage, false)
      }
      if (result.ok) throw new WorkspaceMemberAttemptError('未能確認成員移除結果。 Unable to verify workspace member removal.', false)
      if (result.status === 401 || result.status === 403) {
        throw new WorkspaceMemberAttemptError('工作區管理權限已改變，請重新載入或登入。 Workspace management permission changed; reload or sign in again.', false)
      }
      if (result.status === 409) {
        throw new WorkspaceMemberAttemptError('這個成員不可移除。 This workspace member cannot be removed.', false)
      }
      throw new WorkspaceMemberAttemptError(workspaceMemberRemovalUnavailableMessage, false)
    } catch (error) {
      if (!(error instanceof WorkspaceMemberAttemptError) && attempt + 1 < MEMBER_MUTATION_ATTEMPTS) continue
      throw new Error(error instanceof WorkspaceMemberAttemptError ? error.message : workspaceMemberRemovalUnavailableMessage)
    }
  }
  throw new Error(workspaceMemberRemovalUnavailableMessage)
}
