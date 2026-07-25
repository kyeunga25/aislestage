import { Agent, callable, type Connection } from 'agents'
import { buildCampaignPlan, initialCampaignAgentState, sanitizeCampaignBrief } from '../lib/campaign-agent'
import { OpenAICampaignPlanningProvider } from '../lib/providers'
import type { CampaignAgentState, CampaignBrief } from '../lib/types'

type CampaignAgentEnv = {
  OPENAI_API_KEY?: string
  AGENT_MODE?: 'deterministic' | 'assisted'
}

function validState(state: CampaignAgentState) {
  return Number.isSafeInteger(state.revision)
    && state.revision >= 0
    && ['idle', 'needs-input', 'awaiting-approval', 'approved'].includes(state.stage)
    && state.summary.length <= 1_000
    && state.plan.length <= 3
    && state.checks.length <= 8
    && state.messages.length <= 12
}

export class CampaignAgent extends Agent<Cloudflare.Env, CampaignAgentState> {
  initialState = initialCampaignAgentState()

  validateStateChange(nextState: CampaignAgentState, source: Connection | 'server') {
    if (source !== 'server') throw new Error('Campaign Agent state can only be changed by server methods.')
    if (!validState(nextState)) throw new Error('Invalid Campaign Agent state.')
  }

  @callable()
  getPlan() {
    return this.state
  }

  @callable()
  async planBrief(input: unknown) {
    const brief = sanitizeCampaignBrief(input)
    const revision = this.state.revision + 1
    let next = buildCampaignPlan(brief, revision, 'deterministic')

    const bindings = this.env as CampaignAgentEnv
    if (bindings.AGENT_MODE === 'assisted' && bindings.OPENAI_API_KEY && next.stage === 'awaiting-approval') {
      const assisted = await new OpenAICampaignPlanningProvider(bindings.OPENAI_API_KEY).createPlan(brief)
      const rationaleById = new Map(assisted.recommendations.map((item) => [item.id, item.rationale.slice(0, 500)]))
      next = {
        ...next,
        mode: 'assisted',
        summary: assisted.summary.slice(0, 1_000),
        plan: next.plan.map((item) => ({ ...item, rationale: rationaleById.get(item.id) || item.rationale }))
      }
    }

    this.setState(next)
    return next
  }

  @callable()
  approvePlan(revision: number) {
    if (this.state.stage !== 'awaiting-approval') return { ok: false as const, error: 'This campaign plan is not ready for approval.' }
    if (revision !== this.state.revision) return { ok: false as const, error: 'The campaign plan changed. Review the latest revision before approving.' }
    const next: CampaignAgentState = {
      ...this.state,
      stage: 'approved',
      approvedAt: new Date().toISOString(),
      messages: [...this.state.messages, { id: `approved-${revision}`, role: 'user' as const, text: '已批准這個輸出計劃。' }].slice(-12)
    }
    this.setState(next)
    return { ok: true as const, state: next }
  }

  @callable()
  requestRevision(note: string) {
    const cleanNote = typeof note === 'string' ? note.trim().slice(0, 500) : ''
    if (!cleanNote) return { ok: false as const, error: 'Revision note is required.' }
    const next: CampaignAgentState = {
      ...this.state,
      stage: 'awaiting-approval',
      revision: this.state.revision + 1,
      approvedAt: null,
      summary: `已記錄調整要求：${cleanNote}`,
      messages: [...this.state.messages, { id: `revision-${this.state.revision + 1}`, role: 'user' as const, text: cleanNote }].slice(-12)
    }
    this.setState(next)
    return { ok: true as const, state: next }
  }

  @callable()
  resetPlan() {
    const next = initialCampaignAgentState()
    this.setState(next)
    return next
  }
}
