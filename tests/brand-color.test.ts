import { describe, expect, it } from 'vitest'
import { brandColorForDisplay, fallbackBrandColor, isSafeBrandColor, isSafeBrandColorList } from '../src/lib/brand-color'

describe('brand color boundary', () => {
  it.each(['#155eef', '#ABCDEF', '#000000', '#ffffff'])('accepts an exact six-digit hex color: %s', (color) => {
    expect(isSafeBrandColor(color)).toBe(true)
  })

  it.each([
    'url(//example.test/color)',
    'red',
    '#fff',
    '#12345678',
    '#12345g',
    ' #155eef',
    '#155eef ',
    '',
    155,
    null,
    undefined
  ])('rejects a non-canonical color value: %s', (color) => {
    expect(isSafeBrandColor(color)).toBe(false)
    expect(brandColorForDisplay(color)).toBe(fallbackBrandColor)
  })

  it('requires a bounded non-empty list of safe colors', () => {
    expect(isSafeBrandColorList(['#155eef', '#ABCDEF'], 8)).toBe(true)
    expect(isSafeBrandColorList([], 8)).toBe(false)
    expect(isSafeBrandColorList(['#155eef', 'url(//example.test/color)'], 8)).toBe(false)
    expect(isSafeBrandColorList(Array.from({ length: 9 }, () => '#155eef'), 8)).toBe(false)
  })
})
