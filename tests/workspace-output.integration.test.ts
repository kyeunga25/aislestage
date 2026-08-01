import { env } from 'cloudflare:workers'
import { createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env, type GenerationMessage } from '../src/worker'
import { dispatch, generationInput, registerAccount } from './helpers'

function approvedAssistedEnv(envOverride: Env = env): Env {
  return {
    ...envOverride,
    GENERATION_MODE: 'assisted',
    AGENT_MODE: 'deterministic',
    ASSISTED_PROVIDER: 'openai',
    ASSISTED_DATA_POLICY: 'approved',
    ASSISTED_EVALUATION: 'approved',
    ASSISTED_BUDGET_MODE: 'approved',
    OPENAI_API_KEY: 'test-openai-key'
  }
}

async function createGeneration(cookie: string, input: ReturnType<typeof generationInput>, envOverride: Env = env) {
  return dispatch('/api/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: 'https://app.test' },
    body: JSON.stringify(input)
  }, envOverride)
}

async function createCampaignPack(cookie: string, input: Awaited<ReturnType<typeof approvedInput>>, idempotencyKey = crypto.randomUUID(), envOverride: Env = env) {
  return dispatch('/api/campaign-packs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: 'https://app.test' },
    body: JSON.stringify({
      idempotencyKey,
      workspaceId: input.workspaceId,
      approvedRevision: input.approvedRevision,
      intent: input.intent,
      brand: input.brand,
      product: input.product,
      referenceAssetIds: input.referenceAssetIds,
      outputs: [
        { workflowId: 'store-main', aspectRatio: '1:1' },
        { workflowId: 'meta-ad', aspectRatio: '4:5' },
        { workflowId: 'promo-poster', aspectRatio: '9:16' }
      ]
    })
  }, envOverride)
}

async function approvedInput(cookie: string, workspaceId: string) {
  const form = new FormData()
  form.set('file', new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], 'product.png', { type: 'image/png' }))
  const upload = await dispatch('/api/assets/product', { method: 'POST', headers: { cookie, origin: 'https://app.test' }, body: form })
  const { asset } = await upload.json() as { asset: { id: string } }
  const seed = generationInput(workspaceId, asset.id)
  const planned = await dispatch('/api/campaign-agent/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: 'https://app.test' },
    body: JSON.stringify({ brief: { assetId: asset.id, intent: seed.intent, brand: seed.brand, product: seed.product } })
  })
  const plan = await planned.json() as { state: { revision: number } }
  const approved = await dispatch('/api/campaign-agent/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: 'https://app.test' },
    body: JSON.stringify({ revision: plan.state.revision })
  })
  expect(approved.status).toBe(200)
  return generationInput(workspaceId, asset.id, plan.state.revision)
}

async function deliver(message: GenerationMessage, attempts = 1, messageId = crypto.randomUUID(), envOverride: Env = env) {
  const batch = createMessageBatch<GenerationMessage>('test-generation-queue', [{
    id: messageId,
    timestamp: new Date(),
    attempts,
    body: message
  }])
  const context = createExecutionContext()
  await worker.queue(batch, envOverride)
  return getQueueResult(batch, context)
}

async function balance(workspaceId: string) {
  return env.DB.prepare('SELECT available, reserved FROM output_allowances WHERE workspace_id = ?')
    .bind(workspaceId)
    .first<{ available: number; reserved: number }>()
}

async function ledgerCount(generationId: string, eventType: string) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM output_ledger WHERE generation_id = ? AND event_type = ?')
    .bind(generationId, eventType)
    .first<{ count: number }>()
  return row?.count ?? 0
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workspace authorization and output allowance integrity', () => {
  it('creates one atomic idempotent Campaign Pack with three reserved outputs', async () => {
    const account = await registerAccount('Atomic Pack')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const idempotencyKey = crypto.randomUUID()

    const created = await createCampaignPack(account.cookie, input, idempotencyKey)
    expect(created.status).toBe(202)
    const payload = await created.json() as { campaignPackId: string; generations: Array<{ id: string; campaignPackId: string; status: string }> }
    expect(payload.generations).toHaveLength(3)
    expect(new Set(payload.generations.map((item) => item.campaignPackId))).toEqual(new Set([payload.campaignPackId]))
    expect(payload.generations.every((item) => item.status === 'queued')).toBe(true)
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 0, reserved: 3 })

    const replayed = await createCampaignPack(account.cookie, input, idempotencyKey)
    expect(replayed.status).toBe(200)
    const replayPayload = await replayed.json() as { campaignPackId: string; generations: Array<{ id: string }>; replayed: boolean }
    expect(replayPayload).toMatchObject({ campaignPackId: payload.campaignPackId, replayed: true })
    expect(replayPayload.generations.map((item) => item.id)).toEqual(payload.generations.map((item) => item.id))
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 0, reserved: 3 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM output_ledger WHERE workspace_id = ? AND event_type = ?')
      .bind(account.currentWorkspace.id, 'reservation')
      .first<{ count: number }>()).toEqual({ count: 3 })
  })

  it('creates no partial pack when the output allowance is too low', async () => {
    const account = await registerAccount('Pack Allowance')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    await env.DB.prepare('UPDATE output_allowances SET available = 2 WHERE workspace_id = ?').bind(account.currentWorkspace.id).run()

    const response = await createCampaignPack(account.cookie, input)
    expect(response.status).toBe(409)
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 2, reserved: 0 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM campaign_packs WHERE workspace_id = ?').bind(account.currentWorkspace.id).first()).toEqual({ count: 0 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM generations WHERE workspace_id = ?').bind(account.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it('creates no partial pack when it would exceed the workspace active-output limit', async () => {
    const account = await registerAccount('Pack Active Limit')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const limitedEnv = { ...env, MAX_ACTIVE_GENERATIONS_PER_WORKSPACE: '2' }

    const response = await createCampaignPack(account.cookie, input, crypto.randomUUID(), limitedEnv)
    expect(response.status).toBe(429)
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 3, reserved: 0 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM campaign_packs WHERE workspace_id = ?').bind(account.currentWorkspace.id).first()).toEqual({ count: 0 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM generations WHERE workspace_id = ?').bind(account.currentWorkspace.id).first()).toEqual({ count: 0 })
  })

  it('creates only one pack when the same idempotency key arrives concurrently', async () => {
    const account = await registerAccount('Concurrent Pack')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const idempotencyKey = crypto.randomUUID()

    const responses = await Promise.all([
      createCampaignPack(account.cookie, input, idempotencyKey),
      createCampaignPack(account.cookie, input, idempotencyKey)
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 202])
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 0, reserved: 3 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM campaign_packs WHERE workspace_id = ?').bind(account.currentWorkspace.id).first()).toEqual({ count: 1 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM generations WHERE workspace_id = ?').bind(account.currentWorkspace.id).first()).toEqual({ count: 3 })
  })

  it('releases all three outputs when Campaign Pack enqueueing fails', async () => {
    const account = await registerAccount('Pack Queue Failure')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const failingQueue = {
      send: async () => { throw new Error('queue unavailable') },
      sendBatch: async () => { throw new Error('queue unavailable') }
    } as unknown as Queue<GenerationMessage>

    const response = await createCampaignPack(account.cookie, input, crypto.randomUUID(), { ...env, GENERATION_QUEUE: failingQueue })
    expect(response.status).toBe(503)
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 3, reserved: 0 })
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM generations WHERE workspace_id = ? AND status = 'failed'").bind(account.currentWorkspace.id).first()).toEqual({ count: 3 })
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM output_ledger WHERE workspace_id = ? AND event_type = 'release'").bind(account.currentWorkspace.id).first()).toEqual({ count: 3 })
  })

  it('prevents one workspace from listing, generating with, or reading another workspace assets', async () => {
    const ownerA = await registerAccount('Owner A')
    const ownerB = await registerAccount('Owner B')

    const list = await dispatch(`/api/generations?workspaceId=${ownerB.currentWorkspace.id}`, { headers: { cookie: ownerA.cookie } })
    expect(list.status).toBe(404)

    const create = await createGeneration(ownerA.cookie, generationInput(ownerB.currentWorkspace.id))
    expect(create.status).toBe(404)

    const generationId = crypto.randomUUID()
    const outputKey = `workspaces/${ownerB.currentWorkspace.id}/generations/${generationId}.png`
    await env.MEDIA_BUCKET.put(outputKey, 'private-image', { httpMetadata: { contentType: 'image/png' } })
    await env.DB.prepare(`
      INSERT INTO generations (id, workspace_id, workflow_id, aspect_ratio, status, output_cost, credit_cost, input_json, output_key, completed_at)
      VALUES (?, ?, 'store-main', '1:1', 'completed', 2, 2, '{}', ?, CURRENT_TIMESTAMP)
    `).bind(generationId, ownerB.currentWorkspace.id, outputKey).run()

    const forbiddenImage = await dispatch(`/api/generations/${generationId}/image`, { headers: { cookie: ownerA.cookie } })
    expect(forbiddenImage.status).toBe(404)

    const ownerImage = await dispatch(`/api/generations/${generationId}/image`, { headers: { cookie: ownerB.cookie } })
    expect(ownerImage.status).toBe(200)
    expect(new TextDecoder().decode(await ownerImage.arrayBuffer())).toBe('private-image')
    expect(ownerImage.headers.get('cache-control')).toBe('private, max-age=300')
    const forbiddenDelete = await dispatch(`/api/generations/${generationId}`, { method: 'DELETE', headers: { cookie: ownerA.cookie, origin: 'https://app.test' } })
    expect(forbiddenDelete.status).toBe(404)
  })

  it('does not reserve outputs when the allowance is insufficient', async () => {
    const account = await registerAccount('Low Allowance')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    await env.DB.prepare('UPDATE output_allowances SET available = 0 WHERE workspace_id = ?').bind(account.currentWorkspace.id).run()

    const response = await createGeneration(account.cookie, input)
    expect(response.status).toBe(409)
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 0, reserved: 0 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM output_ledger WHERE workspace_id = ?').bind(account.currentWorkspace.id).first<{ count: number }>()).toEqual({ count: 0 })
  })

  it('fails closed when an assisted release gate is missing', async () => {
    const account = await registerAccount('Closed Assisted Gate')
    const incompleteEnv = { ...approvedAssistedEnv(), ASSISTED_EVALUATION: 'disabled' }

    const response = await createGeneration(account.cookie, generationInput(account.currentWorkspace.id), incompleteEnv)
    expect(response.status).toBe(503)
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 3, reserved: 0 })
  })

  it('releases a reservation exactly once when enqueueing fails', async () => {
    const account = await registerAccount('Queue Failure')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const failingQueue = {
      send: async () => { throw new Error('queue unavailable') },
      sendBatch: async () => { throw new Error('queue unavailable') }
    } as unknown as Queue<GenerationMessage>

    const response = await createGeneration(account.cookie, input, { ...env, GENERATION_QUEUE: failingQueue })
    expect(response.status).toBe(503)
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 3, reserved: 0 })

    const generation = await env.DB.prepare('SELECT id, status FROM generations WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind(account.currentWorkspace.id)
      .first<{ id: string; status: string }>()
    expect(generation?.status).toBe('failed')
    expect(await ledgerCount(generation!.id, 'reservation')).toBe(1)
    expect(await ledgerCount(generation!.id, 'release')).toBe(1)
  })

  it('settles one successful generation once under duplicate queue delivery', async () => {
    const account = await registerAccount('Successful Queue')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const assistedEnv = approvedAssistedEnv()
    const queued = await createGeneration(account.cookie, input, assistedEnv)
    expect(queued.status).toBe(202)
    const { id } = await queued.json() as { id: string }

    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
      if (url.endsWith('/v1/responses')) {
        return Response.json({ output_text: JSON.stringify({ imagePrompt: 'A clean background', headline: 'Headline', body: 'Body', hashtags: ['#test'], cta: 'Buy' }) })
      }
      if (url.endsWith('/v1/images/generations')) {
        return Response.json({ data: [{ b64_json: btoa('fake-png') }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const message = { generationId: id, input }
    const messageId = crypto.randomUUID()
    const first = await deliver(message, 1, messageId, assistedEnv)
    expect(first.explicitAcks).toContain(messageId)

    const duplicate = await deliver(message, 2, messageId, assistedEnv)
    expect(duplicate.explicitAcks).toContain(messageId)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 2, reserved: 0 })
    expect(await ledgerCount(id, 'reservation')).toBe(1)
    expect(await ledgerCount(id, 'settlement')).toBe(1)
    expect(await ledgerCount(id, 'release')).toBe(0)

    const generation = await env.DB.prepare('SELECT status, output_key AS outputKey FROM generations WHERE id = ?')
      .bind(id)
      .first<{ status: string; outputKey: string }>()
    expect(generation?.status).toBe('completed')
    expect(generation?.outputKey).toMatch(/\.svg$/)
    const output = await env.MEDIA_BUCKET.get(generation!.outputKey)
    expect(output?.httpMetadata?.contentType).toBe('image/svg+xml')
    expect(await output?.text()).toContain('<svg')
  })

  it('builds a private deterministic SVG without contacting an external provider', async () => {
    const account = await registerAccount('Deterministic Output')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const deterministicEnv = { ...env, GENERATION_MODE: 'deterministic' as const, OPENAI_API_KEY: undefined }
    const queued = await createGeneration(account.cookie, input, deterministicEnv)
    expect(queued.status).toBe(202)
    const { id } = await queued.json() as { id: string }

    const fetchMock = vi.fn(async () => { throw new Error('External provider must not be called.') })
    vi.stubGlobal('fetch', fetchMock)
    const delivered = await deliver({ generationId: id, input }, 1, crypto.randomUUID(), deterministicEnv)
    expect(delivered.explicitAcks).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()

    const image = await dispatch(`/api/generations/${id}/image`, { headers: { cookie: account.cookie } }, deterministicEnv)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/svg+xml')
    expect(image.headers.get('content-security-policy')).toContain("default-src 'none'")
    const svg = await image.text()
    expect(svg).toContain('Test Product')
    expect(svg).toContain('HK$100')
    expect(svg).toContain('立即選購')
    expect(svg).toContain('data:image/png;base64,')

    const stored = await env.DB.prepare('SELECT output_key AS outputKey FROM generations WHERE id = ?').bind(id).first<{ outputKey: string }>()
    const deleted = await dispatch(`/api/generations/${id}`, { method: 'DELETE', headers: { cookie: account.cookie, origin: 'https://app.test' } }, deterministicEnv)
    expect(deleted.status).toBe(204)
    expect(await dispatch(`/api/generations/${id}/image`, { headers: { cookie: account.cookie } }, deterministicEnv).then((response) => response.status)).toBe(404)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM generations WHERE id = ?').bind(id).first()).toEqual({ count: 0 })
    expect(await env.MEDIA_BUCKET.get(stored!.outputKey)).toBeNull()
  })

  it('lets a later delivery attempt recover a generation left processing by a hard failure', async () => {
    const account = await registerAccount('Crash Recovery')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const queued = await createGeneration(account.cookie, input)
    expect(queued.status).toBe(202)
    const { id } = await queued.json() as { id: string }

    await env.DB.prepare("UPDATE generations SET status = 'processing', processing_attempt = 1 WHERE id = ?")
      .bind(id)
      .run()

    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
      if (url.endsWith('/v1/responses')) {
        return Response.json({ output_text: JSON.stringify({ imagePrompt: 'Recovered background', headline: 'Headline', body: 'Body', hashtags: [], cta: 'Buy' }) })
      }
      if (url.endsWith('/v1/images/generations')) {
        return Response.json({ data: [{ b64_json: btoa('recovered-png') }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await deliver({ generationId: id, input }, 2)
    expect(result.explicitAcks).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 2, reserved: 0 })
    expect(await ledgerCount(id, 'settlement')).toBe(1)
    expect(await env.DB.prepare('SELECT status, processing_attempt AS processingAttempt FROM generations WHERE id = ?')
      .bind(id)
      .first<{ status: string; processingAttempt: number }>()).toEqual({ status: 'completed', processingAttempt: 2 })
  })

  it('releases one failed generation once under duplicate queue delivery', async () => {
    const account = await registerAccount('Failed Queue')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const assistedEnv = approvedAssistedEnv()
    const queued = await createGeneration(account.cookie, input, assistedEnv)
    expect(queued.status).toBe(202)
    const { id } = await queued.json() as { id: string }

    const fetchMock = vi.fn(async () => new Response('provider unavailable', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const message = { generationId: id, input }
    const messageId = crypto.randomUUID()
    const first = await deliver(message, 4, messageId, assistedEnv)
    expect(first.explicitAcks).toContain(messageId)

    const duplicate = await deliver(message, 5, messageId, assistedEnv)
    expect(duplicate.explicitAcks).toContain(messageId)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 3, reserved: 0 })
    expect(await ledgerCount(id, 'reservation')).toBe(1)
    expect(await ledgerCount(id, 'release')).toBe(1)
    expect(await ledgerCount(id, 'settlement')).toBe(0)

    const generation = await env.DB.prepare('SELECT status, error_message AS errorMessage FROM generations WHERE id = ?')
      .bind(id)
      .first<{ status: string; errorMessage: string }>()
    expect(generation).toEqual({ status: 'failed', errorMessage: '素材未能完成，可用輸出數已自動退回。' })

    const listed = await dispatch(`/api/generations?workspaceId=${account.currentWorkspace.id}`, { headers: { cookie: account.cookie } })
    const payload = await listed.json() as { generations: Array<{ id: string; errorMessage: string }> }
    expect(payload.generations.find((item) => item.id === id)?.errorMessage).not.toContain('provider')
  })
})
