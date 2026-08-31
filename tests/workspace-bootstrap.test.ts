import { describe, expect, it, vi } from 'vitest'
import { initialCampaignAgentState } from '../src/lib/campaign-agent'
import { createWorkspaceBootstrapLoader } from '../src/lib/workspace-bootstrap'
import type { SessionLoadResult } from '../src/lib/workspace-bootstrap-loader'

const activeSessionResult = {
  session: {
    user: {
      id: 'user-bootstrap-coordinator',
      email: 'owner@example.test',
      name: '測試商戶',
      accountStatus: 'active' as const,
      accountType: 'beta' as const
    },
    currentWorkspace: {
      id: 'workspace-bootstrap-coordinator',
      name: '測試工作區',
      role: 'owner' as const,
      accessStatus: 'active' as const,
      availableOutputs: 6,
      reservedOutputs: 0
    }
  },
  failure: null
}

const platformStatus = {
  status: 'ok' as const,
  service: 'campaign-asset-worker' as const,
  releaseMode: 'restricted' as const,
  authMode: 'access' as const,
  registrationMode: 'closed' as const,
  registrationOpen: false,
  generationEnabled: false,
  generationMode: 'disabled' as const,
  agentMode: 'deterministic' as const
}

function dependencies() {
  return {
    loadSession: vi.fn(async (): Promise<SessionLoadResult> => activeSessionResult),
    loadPlatformStatus: vi.fn(async () => platformStatus),
    loadGenerationSnapshot: vi.fn(async () => ({ results: [], error: null })),
    loadCampaignAgentSnapshot: vi.fn(async () => ({ state: initialCampaignAgentState(), error: null })),
    loadProductAssetListSnapshot: vi.fn(async () => ({ assets: [], error: null }))
  }
}

describe('workspace bootstrap coordination', () => {
  it('shares one complete in-flight workspace bootstrap and clears it after settlement', async () => {
    const loaders = dependencies()
    const loadWorkspaceBootstrap = createWorkspaceBootstrapLoader(loaders)

    const first = loadWorkspaceBootstrap()
    const concurrent = loadWorkspaceBootstrap()
    expect(concurrent).toBe(first)
    await expect(first).resolves.toEqual({
      sessionResult: activeSessionResult,
      platformStatus,
      generationSnapshot: { results: [], error: null },
      campaignAgentSnapshot: { state: initialCampaignAgentState(), error: null },
      productAssetSnapshot: { assets: [], error: null }
    })
    expect(loaders.loadSession).toHaveBeenCalledTimes(1)
    expect(loaders.loadPlatformStatus).toHaveBeenCalledTimes(1)
    expect(loaders.loadGenerationSnapshot).toHaveBeenCalledTimes(1)
    expect(loaders.loadGenerationSnapshot).toHaveBeenCalledWith('workspace-bootstrap-coordinator')
    expect(loaders.loadCampaignAgentSnapshot).toHaveBeenCalledTimes(1)
    expect(loaders.loadProductAssetListSnapshot).toHaveBeenCalledTimes(1)

    await loadWorkspaceBootstrap()
    expect(loaders.loadSession).toHaveBeenCalledTimes(2)
    expect(loaders.loadPlatformStatus).toHaveBeenCalledTimes(2)
    expect(loaders.loadGenerationSnapshot).toHaveBeenCalledTimes(2)
    expect(loaders.loadCampaignAgentSnapshot).toHaveBeenCalledTimes(2)
    expect(loaders.loadProductAssetListSnapshot).toHaveBeenCalledTimes(2)
  })

  it('does not read private workspace resources for an unauthenticated session', async () => {
    const loaders = dependencies()
    loaders.loadSession.mockResolvedValue({ session: null, failure: 'authentication-required' })
    const loadWorkspaceBootstrap = createWorkspaceBootstrapLoader(loaders)

    await expect(loadWorkspaceBootstrap()).resolves.toEqual({
      sessionResult: { session: null, failure: 'authentication-required' },
      platformStatus,
      generationSnapshot: null,
      campaignAgentSnapshot: null,
      productAssetSnapshot: null
    })
    expect(loaders.loadGenerationSnapshot).not.toHaveBeenCalled()
    expect(loaders.loadCampaignAgentSnapshot).not.toHaveBeenCalled()
    expect(loaders.loadProductAssetListSnapshot).not.toHaveBeenCalled()
  })

  it('clears a rejected bootstrap so a later attempt can recover', async () => {
    const loaders = dependencies()
    loaders.loadSession.mockRejectedValueOnce(new Error('synthetic bootstrap failure'))
    const loadWorkspaceBootstrap = createWorkspaceBootstrapLoader(loaders)

    await expect(loadWorkspaceBootstrap()).rejects.toThrow('synthetic bootstrap failure')
    await expect(loadWorkspaceBootstrap()).resolves.toMatchObject({ sessionResult: activeSessionResult })
    expect(loaders.loadSession).toHaveBeenCalledTimes(2)
    expect(loaders.loadGenerationSnapshot).toHaveBeenCalledTimes(1)
    expect(loaders.loadCampaignAgentSnapshot).toHaveBeenCalledTimes(1)
    expect(loaders.loadProductAssetListSnapshot).toHaveBeenCalledTimes(1)
  })
})
