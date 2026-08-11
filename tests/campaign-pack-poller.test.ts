import { describe, expect, it, vi } from 'vitest'
import { pollCampaignPack } from '../src/lib/campaign-pack-poller'
import type { GenerationResult } from '../src/lib/types'

describe('Campaign Pack polling', () => {
  const generationIds = ['generation-poll-1', 'generation-poll-2', 'generation-poll-3']

  function generations(status: GenerationResult['status']): GenerationResult[] {
    return generationIds.map((id, index) => ({
      id,
      title: `${index + 1}:1 · Synthetic output`,
      campaignPackId: 'campaign-pack-poll-test',
      workflowId: index === 0 ? 'store-main' : index === 1 ? 'meta-ad' : 'promo-poster',
      aspectRatio: index === 0 ? '1:1' : index === 1 ? '4:5' : '9:16',
      status,
      contentType: status === 'completed' ? 'image/svg+xml' : null,
      approvedRevision: 1,
      errorMessage: status === 'failed' ? 'Synthetic bounded failure' : null,
      createdAt: '2026-08-10 15:00:00',
      reviewStatus: 'draft',
      reviewedAt: null,
      imageUrl: status === 'completed' ? `/api/generations/${id}/image` : null,
      downloadUrl: null,
      provenance: {
        approvedRevision: 1,
        compositionVersion: status === 'completed' ? 'campaign-svg-v1' : null,
        generationMode: status === 'completed' ? 'deterministic' : null
      }
    }))
  }

  const immediateWait = vi.fn(async () => undefined)

  it('tolerates transient reads and finishes from the exact terminal pack identities', async () => {
    const processing = generations('processing')
    const completed = generations('completed')
    const responses: Array<GenerationResult[] | Error> = [
      new Error('synthetic temporary read failure'),
      processing,
      new Error('synthetic temporary read failure'),
      completed
    ]
    const load = vi.fn(async () => {
      const response = responses.shift()
      if (response instanceof Error) throw response
      return response || []
    })
    const onSnapshot = vi.fn()

    await expect(pollCampaignPack('workspace-poll-test', generationIds, onSnapshot, {
      load,
      wait: immediateWait
    })).resolves.toEqual({ outcome: 'terminal', latest: completed, pack: completed })
    expect(load).toHaveBeenCalledTimes(4)
    expect(onSnapshot.mock.calls.map((call) => call[0])).toEqual([processing, completed])
  })

  it('stops after three consecutive unavailable reads without replacing the last trusted snapshot', async () => {
    const processing = generations('processing')
    const load = vi.fn()
      .mockResolvedValueOnce(processing)
      .mockRejectedValue(new Error('synthetic temporary read failure'))
    const onSnapshot = vi.fn()

    await expect(pollCampaignPack('workspace-poll-test', generationIds, onSnapshot, {
      load,
      wait: immediateWait
    })).resolves.toEqual({ outcome: 'unavailable', latest: processing, consecutiveFailures: 3 })
    expect(load).toHaveBeenCalledTimes(4)
    expect(onSnapshot).toHaveBeenCalledOnce()
    expect(onSnapshot).toHaveBeenCalledWith(processing)
  })

  it('resets the consecutive failure counter after a successful snapshot', async () => {
    const processing = generations('processing')
    const completed = generations('completed')
    const responses: Array<GenerationResult[] | Error> = [
      new Error('synthetic temporary read failure'),
      new Error('synthetic temporary read failure'),
      processing,
      new Error('synthetic temporary read failure'),
      new Error('synthetic temporary read failure'),
      completed
    ]
    const load = vi.fn(async () => {
      const response = responses.shift()
      if (response instanceof Error) throw response
      return response || []
    })

    await expect(pollCampaignPack('workspace-poll-test', generationIds, vi.fn(), {
      load,
      wait: immediateWait
    })).resolves.toMatchObject({ outcome: 'terminal', pack: completed })
    expect(load).toHaveBeenCalledTimes(6)
  })

  it('ends as pending after the bounded window when the exact pack is not terminal', async () => {
    const processing = generations('processing')
    const load = vi.fn(async () => processing)

    await expect(pollCampaignPack('workspace-poll-test', generationIds, vi.fn(), {
      load,
      wait: immediateWait
    })).resolves.toEqual({ outcome: 'pending', latest: processing, consecutiveFailures: 0 })
    expect(load).toHaveBeenCalledTimes(16)
  })

  it('does not complete from terminal generations outside the requested pack', async () => {
    const unrelated = generations('completed').map((generation) => {
      const id = `other-${generation.id}`
      return { ...generation, id, imageUrl: `/api/generations/${id}/image` }
    })
    const load = vi.fn(async () => unrelated)

    await expect(pollCampaignPack('workspace-poll-test', generationIds, vi.fn(), {
      load,
      wait: immediateWait
    })).resolves.toEqual({ outcome: 'pending', latest: unrelated, consecutiveFailures: 0 })
    expect(load).toHaveBeenCalledTimes(16)
  })

  it('rejects duplicate generation identities before waiting or loading', async () => {
    const load = vi.fn()
    const wait = vi.fn()

    await expect(pollCampaignPack('workspace-poll-test', [generationIds[0], generationIds[0]], vi.fn(), {
      load,
      wait
    })).rejects.toThrow('Invalid Campaign Pack poll identity')
    expect(wait).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })

  it('rejects an incomplete Campaign Pack identity before polling', async () => {
    const load = vi.fn()
    const wait = vi.fn()

    await expect(pollCampaignPack('workspace-poll-test', generationIds.slice(0, 2), vi.fn(), {
      load,
      wait
    })).rejects.toThrow('Invalid Campaign Pack poll identity')
    expect(wait).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })
})
