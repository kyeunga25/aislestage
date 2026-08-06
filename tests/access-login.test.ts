import { describe, expect, it } from 'vitest'
import { accessLoginPath, normalizeAccessFailureReason, safePrivateReturnPath } from '../src/lib/access-login'

describe('Access login routing', () => {
  it('keeps only app-local return paths', () => {
    expect(safePrivateReturnPath('/app')).toBe('/app')
    expect(safePrivateReturnPath('/app/campaign-packs?view=latest#pack')).toBe('/app/campaign-packs?view=latest#pack')
    expect(safePrivateReturnPath('/app/../login')).toBe('/app')
    expect(safePrivateReturnPath('/api/session')).toBe('/app')
    expect(safePrivateReturnPath('//example.test/app')).toBe('/app')
    expect(safePrivateReturnPath('https://example.test/app')).toBe('/app')
    expect(safePrivateReturnPath('/app\\example')).toBe('/app')
  })

  it('builds a public login URL without accepting arbitrary reason values', () => {
    expect(accessLoginPath('/app/campaign-packs', 'authentication-required'))
      .toBe('/login?reason=authentication-required&returnTo=%2Fapp%2Fcampaign-packs')
    expect(normalizeAccessFailureReason('authentication-invalid')).toBe('authentication-invalid')
    expect(normalizeAccessFailureReason('identity-incomplete')).toBe('identity-incomplete')
    expect(normalizeAccessFailureReason('membership-required')).toBe('membership-required')
    expect(normalizeAccessFailureReason('unexpected')).toBeNull()
  })
})
