import { loadCampaignAgentSnapshot } from './campaign-agent-loader'
import { loadGenerationSnapshot } from './generation-loader'
import { loadProductAssetListSnapshot } from './product-asset-list-loader'
import { loadPlatformStatus, loadSession } from './workspace-bootstrap-loader'

type WorkspaceBootstrapDependencies = {
  loadSession: typeof loadSession
  loadPlatformStatus: typeof loadPlatformStatus
  loadGenerationSnapshot: typeof loadGenerationSnapshot
  loadCampaignAgentSnapshot: typeof loadCampaignAgentSnapshot
  loadProductAssetListSnapshot: typeof loadProductAssetListSnapshot
}

export type WorkspaceBootstrapSnapshot = {
  sessionResult: Awaited<ReturnType<typeof loadSession>>
  platformStatus: Awaited<ReturnType<typeof loadPlatformStatus>>
  generationSnapshot: Awaited<ReturnType<typeof loadGenerationSnapshot>> | null
  campaignAgentSnapshot: Awaited<ReturnType<typeof loadCampaignAgentSnapshot>> | null
  productAssetSnapshot: Awaited<ReturnType<typeof loadProductAssetListSnapshot>> | null
}

const defaultDependencies: WorkspaceBootstrapDependencies = {
  loadSession,
  loadPlatformStatus,
  loadGenerationSnapshot,
  loadCampaignAgentSnapshot,
  loadProductAssetListSnapshot
}

export function createWorkspaceBootstrapLoader(dependencies: WorkspaceBootstrapDependencies = defaultDependencies) {
  let inFlight: Promise<WorkspaceBootstrapSnapshot> | null = null

  return function loadWorkspaceBootstrap() {
    if (inFlight) return inFlight

    const request = Promise.all([
      dependencies.loadSession(),
      dependencies.loadPlatformStatus()
    ]).then(async ([sessionResult, platformStatus]): Promise<WorkspaceBootstrapSnapshot> => {
      if (!sessionResult.session) {
        return { sessionResult, platformStatus, generationSnapshot: null, campaignAgentSnapshot: null, productAssetSnapshot: null }
      }
      const [generationSnapshot, campaignAgentSnapshot, productAssetSnapshot] = await Promise.all([
        dependencies.loadGenerationSnapshot(sessionResult.session.currentWorkspace.id),
        dependencies.loadCampaignAgentSnapshot(),
        dependencies.loadProductAssetListSnapshot()
      ])
      return { sessionResult, platformStatus, generationSnapshot, campaignAgentSnapshot, productAssetSnapshot }
    })

    inFlight = request
    const clear = () => {
      if (inFlight === request) inFlight = null
    }
    void request.then(clear, clear)
    return request
  }
}
