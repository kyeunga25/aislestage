import { readBoundedJsonResponseOutcome } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import { loadSession, normalizeAuthSessionPayload, type AuthedSession } from './workspace-bootstrap-loader'

export type PasswordAuthRequest =
  | { mode: 'login'; email: string; password: string }
  | { mode: 'register'; name: string; workspaceName: string; email: string; password: string; inviteCode?: string }

export const authInputInvalidMessage = '請核對登入資料。 Please check the submitted details.'
export const authServiceUnavailableMessage = '登入服務暫時無法使用。 Authentication service is temporarily unavailable.'

const MAX_AUTH_CLIENT_BODY_BYTES = 6 * 1024
const MAX_AUTH_RESPONSE_BYTES = 16 * 1024
const PASSWORD_AUTH_TIMEOUT_MS = 30_000

type AuthIdentity =
  | { mode: 'login'; email: string }
  | { mode: 'register'; email: string; name: string; workspaceName: string }

class PasswordAuthAttemptError extends Error {
  constructor(message: string, readonly reconcilable: boolean) {
    super(message)
    this.name = 'PasswordAuthAttemptError'
  }
}

function normalizeText(value: unknown, minLength: number, maxLength: number) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length >= minLength && normalized.length <= maxLength ? normalized : null
}

function normalizeEmail(value: unknown) {
  const normalized = normalizeText(value, 3, 254)?.toLowerCase() || null
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null
}

function safeAuthBody(request: PasswordAuthRequest) {
  if (!request || typeof request !== 'object' || (request.mode !== 'login' && request.mode !== 'register')) {
    throw new Error(authInputInvalidMessage)
  }
  const email = normalizeEmail(request.email)
  const password = normalizeText(request.password, 8, 256)
  if (!email || !password) throw new Error(authInputInvalidMessage)

  let body: Record<string, string>
  let identity: AuthIdentity
  if (request.mode === 'login') {
    body = { email, password }
    identity = { mode: 'login', email }
  } else {
    const name = normalizeText(request.name, 1, 120)
    const workspaceName = normalizeText(request.workspaceName, 1, 120)
    const inviteCode = request.inviteCode === undefined ? undefined : normalizeText(request.inviteCode, 12, 256)
    if (!name || !workspaceName || (request.inviteCode !== undefined && !inviteCode)) {
      throw new Error(authInputInvalidMessage)
    }
    body = { name, workspaceName, email, password, ...(inviteCode ? { inviteCode } : {}) }
    identity = { mode: 'register', email, name, workspaceName }
  }
  const serialized = JSON.stringify(body)
  if (new TextEncoder().encode(serialized).byteLength > MAX_AUTH_CLIENT_BODY_BYTES) {
    throw new Error(authInputInvalidMessage)
  }
  return { body: serialized, identity }
}

function authFailureMessage(status: number) {
  if (status === 400 || status === 415) return authInputInvalidMessage
  if (status === 401) return '電郵或密碼不正確。 Email or password is incorrect.'
  if (status === 403) return '登入或註冊未獲允許。 Sign-in or registration is not permitted.'
  if (status === 409) return '帳號或邀請狀態有衝突，請核對後重試。 Account or invitation state conflicts; please check and retry.'
  if (status === 413) return '登入資料過大。 Authentication payload is too large.'
  if (status === 429) return '嘗試次數過多，請稍後再試。 Too many attempts; please try again later.'
  return authServiceUnavailableMessage
}

function authIdentityMatches(identity: AuthIdentity, session: AuthedSession) {
  return session.user.email === identity.email
    && (identity.mode === 'login'
      || (session.user.name === identity.name
        && session.currentWorkspace.name === identity.workspaceName
        && session.currentWorkspace.role === 'owner'))
}

export async function submitPasswordAuth(request: PasswordAuthRequest): Promise<AuthedSession> {
  const { body, identity } = safeAuthBody(request)
  try {
    return await fetchWithTimeout(
      `/api/auth/${request.mode}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body
      },
      PASSWORD_AUTH_TIMEOUT_MS,
      async (response, signal) => {
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined)
          throw new PasswordAuthAttemptError(
            authFailureMessage(response.status),
            response.status === 408 || response.status >= 500
          )
        }
        const expectedStatus = request.mode === 'register' ? 201 : 200
        if (response.status !== expectedStatus) {
          await response.body?.cancel().catch(() => undefined)
          throw new PasswordAuthAttemptError(authServiceUnavailableMessage, false)
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (contentType !== 'application/json') {
          await response.body?.cancel().catch(() => undefined)
          throw new PasswordAuthAttemptError(authServiceUnavailableMessage, false)
        }
        const outcome = await readBoundedJsonResponseOutcome(response, MAX_AUTH_RESPONSE_BYTES)
        if (signal.aborted || outcome.kind === 'stream-error') {
          throw new PasswordAuthAttemptError(authServiceUnavailableMessage, true)
        }
        const session = outcome.kind === 'value' ? normalizeAuthSessionPayload(outcome.value) : null
        if (!session || !authIdentityMatches(identity, session)) {
          throw new PasswordAuthAttemptError(authServiceUnavailableMessage, false)
        }
        return session
      }
    )
  } catch (error) {
    const reconcilable = !(error instanceof PasswordAuthAttemptError) || error.reconcilable
    if (!reconcilable) {
      throw new Error(error instanceof PasswordAuthAttemptError ? error.message : authServiceUnavailableMessage)
    }
    try {
      const reconciled = (await loadSession()).session
      if (reconciled && authIdentityMatches(identity, reconciled)) return reconciled
    } catch {
      // Never resend password or registration data when session state is ambiguous.
    }
    throw new Error(authServiceUnavailableMessage)
  }
}
