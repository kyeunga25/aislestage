export const publicDemoPath = '/demo'

export function isPublicDemoPath(pathname: string) {
  return pathname === publicDemoPath || pathname.startsWith(`${publicDemoPath}/`)
}
