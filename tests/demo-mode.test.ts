import { describe, expect, it } from 'vitest'
import { isPublicDemoPath, publicDemoPath } from '../src/lib/demo-mode'

describe('public demo route', () => {
  it('matches only the dedicated demo path', () => {
    expect(publicDemoPath).toBe('/demo')
    expect(isPublicDemoPath('/demo')).toBe(true)
    expect(isPublicDemoPath('/demo/campaign-packs')).toBe(true)
    expect(isPublicDemoPath('/app')).toBe(false)
    expect(isPublicDemoPath('/demonstration')).toBe(false)
  })
})
