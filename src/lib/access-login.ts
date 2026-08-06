export type AccessFailureReason =
  | 'authentication-required'
  | 'membership-required'
  | 'configuration-error'
  | 'access-denied'
  | 'signed-out'
  | 'unavailable'

const supportedReasons = new Set<AccessFailureReason>([
  'authentication-required',
  'membership-required',
  'configuration-error',
  'access-denied',
  'signed-out',
  'unavailable'
])

export function normalizeAccessFailureReason(value: string | null | undefined): AccessFailureReason | null {
  return value && supportedReasons.has(value as AccessFailureReason) ? value as AccessFailureReason : null
}

export function safePrivateReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/app'

  try {
    const base = new URL('https://return.invalid')
    const candidate = new URL(value, base)
    if (candidate.origin !== base.origin) return '/app'
    if (candidate.pathname !== '/app' && !candidate.pathname.startsWith('/app/')) return '/app'
    return `${candidate.pathname}${candidate.search}${candidate.hash}`
  } catch {
    return '/app'
  }
}

export function accessLoginPath(returnTo: string | null | undefined = '/app', reason?: AccessFailureReason | null) {
  const params = new URLSearchParams()
  if (reason) params.set('reason', reason)
  params.set('returnTo', safePrivateReturnPath(returnTo))
  return `/login?${params.toString()}`
}
