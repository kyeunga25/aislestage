export async function fetchWithTimeout<T>(
  input: RequestInfo | URL,
  init: Omit<RequestInit, 'signal'> | undefined,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Invalid fetch timeout')
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    return await consume(response)
  } finally {
    clearTimeout(timeout)
  }
}
