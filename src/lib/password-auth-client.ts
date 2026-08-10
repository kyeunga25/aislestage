import { normalizeAuthSessionPayload, type AuthedSession } from './workspace-bootstrap-loader'

export type PasswordAuthRequest =
  | { mode: 'login'; email: string; password: string }
  | { mode: 'register'; name: string; workspaceName: string; email: string; password: string; inviteCode?: string }

export const authInputInvalidMessage = '請核對登入資料。 Please check the submitted details.'
export const authServiceUnavailableMessage = '登入服務暫時無法使用。 Authentication service is temporarily unavailable.'

const MAX_AUTH_CLIENT_BODY_BYTES = 6 * 1024

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
  if (request.mode === 'login') {
    body = { email, password }
  } else {
    const name = normalizeText(request.name, 1, 120)
    const workspaceName = normalizeText(request.workspaceName, 1, 120)
    const inviteCode = request.inviteCode === undefined ? undefined : normalizeText(request.inviteCode, 12, 256)
    if (!name || !workspaceName || (request.inviteCode !== undefined && !inviteCode)) {
      throw new Error(authInputInvalidMessage)
    }
    body = { name, workspaceName, email, password, ...(inviteCode ? { inviteCode } : {}) }
  }
  const serialized = JSON.stringify(body)
  if (new TextEncoder().encode(serialized).byteLength > MAX_AUTH_CLIENT_BODY_BYTES) {
    throw new Error(authInputInvalidMessage)
  }
  return serialized
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

export async function submitPasswordAuth(request: PasswordAuthRequest): Promise<AuthedSession> {
  const body = safeAuthBody(request)
  let response: Response
  try {
    response = await fetch(`/api/auth/${request.mode}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body
    })
  } catch {
    throw new Error(authServiceUnavailableMessage)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(authFailureMessage(response.status))
  }
  const data = await response.json().catch(() => null)
  const session = normalizeAuthSessionPayload(data)
  if (!session) throw new Error(authServiceUnavailableMessage)
  return session
}
