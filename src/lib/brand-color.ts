export const fallbackBrandColor = '#155eef' as const

const brandColorPattern = /^#[0-9a-f]{6}$/i

export function isSafeBrandColor(value: unknown): value is string {
  return typeof value === 'string' && brandColorPattern.test(value)
}

export function isSafeBrandColorList(value: unknown, maxItems: number): value is string[] {
  return Array.isArray(value)
    && value.length >= 1
    && value.length <= maxItems
    && value.every(isSafeBrandColor)
}

export function brandColorForDisplay(value: unknown) {
  return isSafeBrandColor(value) ? value : fallbackBrandColor
}
