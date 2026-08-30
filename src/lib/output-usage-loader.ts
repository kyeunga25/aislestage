import { readBoundedJsonResponse } from './bounded-json-response'
import { fetchWithTimeout } from './fetch-with-timeout'
import type { OutputUsageEvent, OutputUsageEventType, OutputUsageSnapshot } from './types'

export const outputUsageUnavailableMessage = '工作區用量暫時無法讀取。 Workspace usage is temporarily unavailable.'

const MAX_OUTPUT_USAGE_BYTES = 64 * 1024
const OUTPUT_USAGE_TIMEOUT_MS = 15_000
const responseKeys = new Set(['allowance', 'summary', 'events'])
const allowanceKeys = new Set(['availableOutputs', 'reservedOutputs', 'updatedAt'])
const summaryKeys = new Set(['completedOutputs', 'releasedOutputs'])
const eventKeys = new Set(['type', 'amount', 'createdAt'])
const eventAmounts: Record<OutputUsageEventType, -1 | 0 | 1> = {
  reservation: -1,
  settlement: 0,
  release: 1
}
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actual = Object.keys(value)
  return actual.length === keys.size && actual.every((key) => keys.has(key))
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !utcTimestampPattern.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value.replace(/Z$/, '.000Z')
}

function normalizeUsageEvent(value: unknown): OutputUsageEvent | null {
  if (!isRecord(value) || !hasExactKeys(value, eventKeys) || !isCanonicalUtcTimestamp(value.createdAt)) return null
  if (value.type !== 'reservation' && value.type !== 'settlement' && value.type !== 'release') return null
  const type = value.type
  if (value.amount !== eventAmounts[type]) return null
  return { type, amount: eventAmounts[type], createdAt: value.createdAt }
}

export function normalizeOutputUsage(value: unknown): OutputUsageSnapshot {
  if (!isRecord(value) || !hasExactKeys(value, responseKeys)) throw new Error(outputUsageUnavailableMessage)
  const { allowance, summary, events } = value
  if (!isRecord(allowance)
    || !hasExactKeys(allowance, allowanceKeys)
    || !isNonNegativeInteger(allowance.availableOutputs)
    || !isNonNegativeInteger(allowance.reservedOutputs)
    || !isCanonicalUtcTimestamp(allowance.updatedAt)
    || !isRecord(summary)
    || !hasExactKeys(summary, summaryKeys)
    || !isNonNegativeInteger(summary.completedOutputs)
    || !isNonNegativeInteger(summary.releasedOutputs)
    || !Array.isArray(events)
    || events.length > 50) throw new Error(outputUsageUnavailableMessage)
  const normalizedEvents = events.map(normalizeUsageEvent)
  if (normalizedEvents.some((event) => event === null)) throw new Error(outputUsageUnavailableMessage)
  return {
    allowance: {
      availableOutputs: allowance.availableOutputs,
      reservedOutputs: allowance.reservedOutputs,
      updatedAt: allowance.updatedAt
    },
    summary: {
      completedOutputs: summary.completedOutputs,
      releasedOutputs: summary.releasedOutputs
    },
    events: normalizedEvents as OutputUsageEvent[]
  }
}

export async function loadOutputUsage() {
  try {
    return await fetchWithTimeout(
      '/api/output-usage',
      { credentials: 'same-origin' },
      OUTPUT_USAGE_TIMEOUT_MS,
      async (response) => {
        if (response.status !== 200 || !response.ok) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(outputUsageUnavailableMessage)
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (contentType !== 'application/json') {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(outputUsageUnavailableMessage)
        }
        const data = await readBoundedJsonResponse(response, MAX_OUTPUT_USAGE_BYTES)
        return normalizeOutputUsage(data)
      }
    )
  } catch {
    throw new Error(outputUsageUnavailableMessage)
  }
}

export async function loadOutputUsageSnapshot(): Promise<{
  usage: OutputUsageSnapshot | null
  error: string | null
}> {
  try {
    return { usage: await loadOutputUsage(), error: null }
  } catch (error) {
    return {
      usage: null,
      error: error instanceof Error ? error.message : outputUsageUnavailableMessage
    }
  }
}
