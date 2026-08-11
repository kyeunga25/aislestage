import { readBoundedJsonResponseOutcome } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'

export const passwordLogoutInvalidResponseMessage = '未能確認登出狀態。 Unable to verify the logout state.'
export const passwordLogoutUnavailableMessage = '登出暫時無法完成，工作區仍保持登入。 Logout is temporarily unavailable; the workspace remains signed in.'

const responseKeys = new Set(['ok'])
const MAX_LOGOUT_RESPONSE_BYTES = 1024
const PASSWORD_LOGOUT_TIMEOUT_MS = 15_000
const PASSWORD_LOGOUT_ATTEMPTS = 2

class PasswordLogoutAttemptError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'PasswordLogoutAttemptError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.size && actualKeys.every((key) => keys.has(key))
}

async function logoutPasswordSessionAttempt() {
  return fetchWithTimeout(
    '/api/auth/logout',
    {
      method: 'POST',
      credentials: 'same-origin'
    },
    PASSWORD_LOGOUT_TIMEOUT_MS,
    async (response, signal) => {
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new PasswordLogoutAttemptError(
          passwordLogoutUnavailableMessage,
          response.status === 408 || response.status >= 500
        )
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined)
        throw new PasswordLogoutAttemptError(passwordLogoutInvalidResponseMessage, false)
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        await response.body?.cancel().catch(() => undefined)
        throw new PasswordLogoutAttemptError(passwordLogoutInvalidResponseMessage, false)
      }
      const outcome = await readBoundedJsonResponseOutcome(response, MAX_LOGOUT_RESPONSE_BYTES)
      if (signal.aborted || outcome.kind === 'stream-error') {
        throw new PasswordLogoutAttemptError(passwordLogoutUnavailableMessage, true)
      }
      const data = outcome.kind === 'value' ? outcome.value : null
      if (!isRecord(data) || !hasExactKeys(data, responseKeys) || data.ok !== true) {
        throw new PasswordLogoutAttemptError(passwordLogoutInvalidResponseMessage, false)
      }
    }
  )
}

export async function logoutPasswordSession() {
  for (let attempt = 0; attempt < PASSWORD_LOGOUT_ATTEMPTS; attempt += 1) {
    try {
      return await logoutPasswordSessionAttempt()
    } catch (error) {
      const retryable = !(error instanceof PasswordLogoutAttemptError) || error.retryable
      if (retryable && attempt + 1 < PASSWORD_LOGOUT_ATTEMPTS) continue
      if (error instanceof PasswordLogoutAttemptError) throw new Error(error.message)
      throw new Error(passwordLogoutUnavailableMessage)
    }
  }
  throw new Error(passwordLogoutUnavailableMessage)
}
