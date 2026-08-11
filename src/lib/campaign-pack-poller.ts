import { loadGenerations } from './generation-loader'
import type { GenerationResult } from './types'

const CAMPAIGN_PACK_POLL_ATTEMPTS = 16
const CAMPAIGN_PACK_POLL_INTERVAL_MS = 1_250
const MAX_CONSECUTIVE_POLL_FAILURES = 3

type PollDependencies = {
  load?: (workspaceId: string) => Promise<GenerationResult[]>
  wait?: (milliseconds: number) => Promise<void>
}

export type CampaignPackPollResult =
  | { outcome: 'terminal'; latest: GenerationResult[]; pack: GenerationResult[] }
  | { outcome: 'pending'; latest: GenerationResult[] | null; consecutiveFailures: number }
  | { outcome: 'unavailable'; latest: GenerationResult[] | null; consecutiveFailures: number }

function defaultWait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

export async function pollCampaignPack(
  workspaceId: string,
  generationIds: readonly string[],
  onSnapshot: (latest: GenerationResult[]) => void,
  dependencies: PollDependencies = {}
): Promise<CampaignPackPollResult> {
  const expectedIds = new Set(generationIds)
  if (!workspaceId
    || workspaceId.length > 64
    || expectedIds.size !== 3
    || expectedIds.size !== generationIds.length
    || generationIds.some((id) => typeof id !== 'string' || !id || id.length > 64)) {
    throw new TypeError('Invalid Campaign Pack poll identity')
  }

  const load = dependencies.load || loadGenerations
  const wait = dependencies.wait || defaultWait
  let latest: GenerationResult[] | null = null
  let consecutiveFailures = 0

  for (let attempt = 0; attempt < CAMPAIGN_PACK_POLL_ATTEMPTS; attempt += 1) {
    await wait(CAMPAIGN_PACK_POLL_INTERVAL_MS)
    let snapshot: GenerationResult[]
    try {
      snapshot = await load(workspaceId)
    } catch {
      consecutiveFailures += 1
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        return { outcome: 'unavailable', latest, consecutiveFailures }
      }
      continue
    }

    latest = snapshot
    consecutiveFailures = 0
    onSnapshot(snapshot)
    const pack = snapshot.filter((item) => expectedIds.has(item.id))
    if (pack.length === expectedIds.size
      && pack.every((item) => item.status === 'completed' || item.status === 'failed')) {
      return { outcome: 'terminal', latest: snapshot, pack }
    }
  }

  return { outcome: 'pending', latest, consecutiveFailures }
}
