async function cancelResponseBody(response: Response) {
  await response.body?.cancel().catch(() => undefined)
}

export type BoundedJsonResponseOutcome =
  | { kind: 'value'; value: unknown }
  | { kind: 'invalid' }
  | { kind: 'stream-error' }

export async function readBoundedJsonResponseOutcome(response: Response, maxBytes: number): Promise<BoundedJsonResponseOutcome> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    await cancelResponseBody(response)
    return { kind: 'invalid' }
  }

  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const normalizedLength = declaredLength.trim()
    const declaredBytes = /^\d+$/.test(normalizedLength) ? Number(normalizedLength) : Number.NaN
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > maxBytes) {
      await cancelResponseBody(response)
      return { kind: 'invalid' }
    }
  }

  if (!response.body) return { kind: 'invalid' }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      totalBytes += value.byteLength
      if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { kind: 'invalid' }
      }
      chunks.push(value)
    }
  } catch {
    await reader.cancel().catch(() => undefined)
    return { kind: 'stream-error' }
  } finally {
    reader.releaseLock()
  }

  if (totalBytes === 0) return { kind: 'invalid' }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { kind: 'value', value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  } catch {
    return { kind: 'invalid' }
  }
}

export async function readBoundedJsonResponse(response: Response, maxBytes: number): Promise<unknown | null> {
  const outcome = await readBoundedJsonResponseOutcome(response, maxBytes)
  return outcome.kind === 'value' ? outcome.value : null
}
