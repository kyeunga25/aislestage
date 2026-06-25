import { OpenAICopyProvider, OpenAIImageProvider, WonderBillingProvider } from './lib/providers'
import { workflowById } from './lib/workflows'
import type { GenerationInput } from './lib/types'

type Env = {
  DB: D1Database
  MEDIA_BUCKET: R2Bucket
  GENERATION_QUEUE: Queue<GenerationMessage>
  OPENAI_API_KEY?: string
  WONDER_WEBHOOK_PUBLIC_KEY?: string
}

type GenerationMessage = { generationId: string; input: GenerationInput }
const CREDIT_COST = 2

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers } })

function validInput(value: unknown): value is GenerationInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<GenerationInput>
  return typeof input.workspaceId === 'string' && typeof input.workflowId === 'string' && typeof input.aspectRatio === 'string' && Boolean(input.brand?.name) && Boolean(input.product?.name) && Array.isArray(input.referenceImageUrls)
}

async function reserveCredits(env: Env, workspaceId: string, generationId: string) {
  const result = await env.DB.prepare('UPDATE credit_balances SET available = available - ?, reserved = reserved + ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND available >= ?').bind(CREDIT_COST, CREDIT_COST, workspaceId, CREDIT_COST).run()
  if (!result.meta.changes) throw new Error('INSUFFICIENT_CREDITS')
  await env.DB.prepare('INSERT INTO credit_ledger (id, workspace_id, generation_id, event_type, amount, note) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), workspaceId, generationId, 'reservation', -CREDIT_COST, 'Generation credit reservation').run()
}

async function releaseCredits(env: Env, workspaceId: string, generationId: string, reason: string) {
  await env.DB.batch([
    env.DB.prepare('UPDATE credit_balances SET available = available + ?, reserved = MAX(reserved - ?, 0), updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ?').bind(CREDIT_COST, CREDIT_COST, workspaceId),
    env.DB.prepare('INSERT INTO credit_ledger (id, workspace_id, generation_id, event_type, amount, note) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), workspaceId, generationId, 'release', CREDIT_COST, reason)
  ])
}

async function settleCredits(env: Env, workspaceId: string, generationId: string) {
  await env.DB.batch([
    env.DB.prepare('UPDATE credit_balances SET reserved = MAX(reserved - ?, 0), updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ?').bind(CREDIT_COST, workspaceId),
    env.DB.prepare('INSERT INTO credit_ledger (id, workspace_id, generation_id, event_type, amount, note) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), workspaceId, generationId, 'settlement', 0, 'Generation completed')
  ])
}

async function createGeneration(request: Request, env: Env) {
  const input = await request.json().catch(() => null)
  if (!validInput(input)) return json({ error: 'Invalid generation payload.' }, { status: 400 })
  const workflow = workflowById(input.workflowId)
  if (!workflow.ratios.includes(input.aspectRatio)) return json({ error: 'The selected ratio is not available for this workflow.' }, { status: 400 })
  const id = crypto.randomUUID()
  try {
    await reserveCredits(env, input.workspaceId, id)
    await env.DB.prepare('INSERT INTO generations (id, workspace_id, workflow_id, aspect_ratio, status, credit_cost, input_json) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, input.workspaceId, input.workflowId, input.aspectRatio, 'queued', CREDIT_COST, JSON.stringify(input)).run()
    await env.GENERATION_QUEUE.send({ generationId: id, input })
    return json({ id, status: 'queued', reservedCredits: CREDIT_COST }, { status: 202 })
  } catch (error) {
    if (error instanceof Error && error.message === 'INSUFFICIENT_CREDITS') return json({ error: 'Insufficient credits.' }, { status: 402 })
    return json({ error: 'Unable to queue generation.' }, { status: 503 })
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/health') return json({ status: 'ok', service: 'motive-worker' })
    if (url.pathname === '/api/workflows' && request.method === 'GET') return json({ workflows: ['store-main', 'detail-banner', 'promo-poster', 'meta-ad', 'package-showcase'] })
    if (url.pathname === '/api/generations' && request.method === 'POST') return createGeneration(request, env)
    if (url.pathname === '/api/wonder/webhook' && request.method === 'POST') {
      try {
        const event = await new WonderBillingProvider().verifyWebhook(request)
        await env.DB.prepare('INSERT INTO payment_events (provider_event_id, provider, event_type, payload_json) VALUES (?, ?, ?, ?)').bind(event.eventId, 'wonder', event.type, JSON.stringify(event.data)).run()
        return json({ received: true })
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Webhook rejected.' }, { status: 401 })
      }
    }
    return json({ error: 'Not found.' }, { status: 404 })
  },

  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      const { generationId, input } = message.body as GenerationMessage
      try {
        await env.DB.prepare('UPDATE generations SET status = ? WHERE id = ? AND status = ?').bind('processing', generationId, 'queued').run()
        if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured.')
        const workflow = workflowById(input.workflowId)
        const copy = await new OpenAICopyProvider(env.OPENAI_API_KEY).createCopy({ brand: input.brand, product: input.product, workflowTitle: workflow.title, aspectRatio: input.aspectRatio })
        const generated = await new OpenAIImageProvider(env.OPENAI_API_KEY).generate({ prompt: copy.imagePrompt, aspectRatio: input.aspectRatio, referenceImageUrls: input.referenceImageUrls })
        const key = `workspaces/${input.workspaceId}/generations/${generationId}.png`
        await env.MEDIA_BUCKET.put(key, Uint8Array.from(atob(generated.imageBase64), (char) => char.charCodeAt(0)), { httpMetadata: { contentType: 'image/png' }, customMetadata: { workflow: input.workflowId } })
        await env.DB.prepare('UPDATE generations SET status = ?, output_key = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').bind('completed', key, generationId).run()
        await settleCredits(env, input.workspaceId, generationId)
        message.ack()
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Generation failed.'
        await env.DB.prepare('UPDATE generations SET status = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').bind('failed', reason, generationId).run()
        await releaseCredits(env, input.workspaceId, generationId, reason)
        message.ack()
      }
    }
  }
} satisfies ExportedHandler<Env, GenerationMessage>
