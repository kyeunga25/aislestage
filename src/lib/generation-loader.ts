import type { GenerationResult, WorkflowId } from './types'
import { workflowById } from './workflows'

export const generationListUnavailableMessage = '輸出清單暫時無法讀取。 Generation list is temporarily unavailable.'

export async function loadGenerations(workspaceId: string) {
  let response: Response
  try {
    response = await fetch(`/api/generations?workspaceId=${encodeURIComponent(workspaceId)}`, { credentials: 'same-origin' })
  } catch {
    throw new Error(generationListUnavailableMessage)
  }
  const data = await response.json().catch(() => null) as {
    generations?: Array<Omit<GenerationResult, 'title'> & { workflowId: WorkflowId }>
  } | null
  if (!response.ok) throw new Error(generationListUnavailableMessage)
  if (!Array.isArray(data?.generations)) throw new Error(generationListUnavailableMessage)
  return data.generations.map((item) => ({ ...item, title: `${item.aspectRatio} · ${workflowById(item.workflowId).title}` }))
}

export async function loadGenerationSnapshot(workspaceId: string): Promise<{
  results: GenerationResult[] | null
  error: string | null
}> {
  try {
    return { results: await loadGenerations(workspaceId), error: null }
  } catch (error) {
    return {
      results: null,
      error: error instanceof Error ? error.message : generationListUnavailableMessage
    }
  }
}
