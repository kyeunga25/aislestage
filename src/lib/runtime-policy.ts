export type GenerationRuntimeMode = 'disabled' | 'deterministic' | 'assisted'
export type AgentRuntimeMode = 'deterministic' | 'assisted'

export type RuntimePolicyEnv = {
  GENERATION_MODE?: string
  AGENT_MODE?: string
  ASSISTED_PROVIDER?: string
  ASSISTED_DATA_POLICY?: string
  ASSISTED_EVALUATION?: string
  ASSISTED_BUDGET_MODE?: string
  OPENAI_API_KEY?: string
  MAX_ACTIVE_GENERATIONS_PER_WORKSPACE?: string
}

export function assistedExecutionApproved(env: RuntimePolicyEnv) {
  return env.GENERATION_MODE === 'assisted'
    && env.ASSISTED_PROVIDER === 'openai'
    && env.ASSISTED_DATA_POLICY === 'approved'
    && env.ASSISTED_EVALUATION === 'approved'
    && env.ASSISTED_BUDGET_MODE === 'approved'
    && Boolean(env.OPENAI_API_KEY?.trim())
}

export function generationMode(env: RuntimePolicyEnv): GenerationRuntimeMode {
  if (env.GENERATION_MODE === 'deterministic') return 'deterministic'
  if (assistedExecutionApproved(env)) return 'assisted'
  return 'disabled'
}

export function agentMode(env: RuntimePolicyEnv): AgentRuntimeMode {
  return env.AGENT_MODE === 'assisted' && assistedExecutionApproved(env) ? 'assisted' : 'deterministic'
}

export function maxActiveGenerations(env: RuntimePolicyEnv) {
  const value = Number(env.MAX_ACTIVE_GENERATIONS_PER_WORKSPACE)
  return Number.isSafeInteger(value) && value >= 1 && value <= 12 ? value : 3
}
