import { describe, expect, it } from 'vitest'
import { agentMode, assistedExecutionApproved, generationMode, maxActiveGenerations } from '../src/lib/runtime-policy'

const approvedAssistedEnv = {
  GENERATION_MODE: 'assisted',
  AGENT_MODE: 'assisted',
  ASSISTED_PROVIDER: 'openai',
  ASSISTED_DATA_POLICY: 'approved',
  ASSISTED_EVALUATION: 'approved',
  ASSISTED_BUDGET_MODE: 'approved',
  OPENAI_API_KEY: 'test-key'
}

describe('runtime release policy', () => {
  it('keeps assisted execution closed until every independent gate passes', () => {
    expect(assistedExecutionApproved(approvedAssistedEnv)).toBe(true)
    expect(generationMode(approvedAssistedEnv)).toBe('assisted')
    expect(agentMode(approvedAssistedEnv)).toBe('assisted')

    for (const key of ['ASSISTED_PROVIDER', 'ASSISTED_DATA_POLICY', 'ASSISTED_EVALUATION', 'ASSISTED_BUDGET_MODE', 'OPENAI_API_KEY'] as const) {
      const incomplete = { ...approvedAssistedEnv, [key]: key === 'OPENAI_API_KEY' ? '' : 'disabled' }
      expect(assistedExecutionApproved(incomplete)).toBe(false)
      expect(generationMode(incomplete)).toBe('disabled')
      expect(agentMode(incomplete)).toBe('deterministic')
    }
  })

  it('supports deterministic output without provider approval', () => {
    expect(generationMode({ GENERATION_MODE: 'deterministic' })).toBe('deterministic')
    expect(agentMode({ GENERATION_MODE: 'deterministic', AGENT_MODE: 'assisted', OPENAI_API_KEY: 'test-key' })).toBe('deterministic')
    expect(generationMode({ GENERATION_MODE: 'enabled', OPENAI_API_KEY: 'test-key' })).toBe('disabled')
  })

  it('bounds workspace concurrency to a small safe range', () => {
    expect(maxActiveGenerations({})).toBe(3)
    expect(maxActiveGenerations({ MAX_ACTIVE_GENERATIONS_PER_WORKSPACE: '6' })).toBe(6)
    expect(maxActiveGenerations({ MAX_ACTIVE_GENERATIONS_PER_WORKSPACE: '0' })).toBe(3)
    expect(maxActiveGenerations({ MAX_ACTIVE_GENERATIONS_PER_WORKSPACE: '100' })).toBe(3)
    expect(maxActiveGenerations({ MAX_ACTIVE_GENERATIONS_PER_WORKSPACE: 'three' })).toBe(3)
  })
})
