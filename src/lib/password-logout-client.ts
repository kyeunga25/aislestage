export const passwordLogoutInvalidResponseMessage = '未能確認登出狀態。 Unable to verify the logout state.'
export const passwordLogoutUnavailableMessage = '登出暫時無法完成，工作區仍保持登入。 Logout is temporarily unavailable; the workspace remains signed in.'

const responseKeys = new Set(['ok'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.size && actualKeys.every((key) => keys.has(key))
}

export async function logoutPasswordSession() {
  let response: Response
  try {
    response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin'
    })
  } catch {
    throw new Error(passwordLogoutUnavailableMessage)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(passwordLogoutUnavailableMessage)
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(passwordLogoutInvalidResponseMessage)
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(passwordLogoutInvalidResponseMessage)
  }
  const data = await response.json().catch(() => null)
  if (!isRecord(data) || !hasExactKeys(data, responseKeys) || data.ok !== true) {
    throw new Error(passwordLogoutInvalidResponseMessage)
  }
}
