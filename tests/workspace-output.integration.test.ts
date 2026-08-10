import { env } from 'cloudflare:workers'
import { createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test'
import { getAgentByName } from 'agents'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env, type GenerationMessage } from '../src/worker'
import { dispatch, generationInput, registerAccount, validPngBytes } from './helpers'

const syntheticPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function bytesBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function sha256Base64Url(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return bytesBase64Url(digest)
}

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

function manuallyDeliveredAssistedEnv(): Env {
  const holdingQueue = {
    send: async () => undefined,
    sendBatch: async () => undefined
  } as unknown as Queue<GenerationMessage>
  return approvedAssistedEnv({ ...env, GENERATION_QUEUE: holdingQueue })
}

async function createGeneration(cookie: string, input: ReturnType<typeof generationInput>, envOverride: Env = env) {
  return dispatch('/api/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: 'https://app.test' },
    body: JSON.stringify(input)
  }, envOverride)
}

function campaignPackBody(input: Awaited<ReturnType<typeof approvedInput>>, idempotencyKey = crypto.randomUUID()) {
  return {
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
  }
}

async function createCampaignPack(cookie: string, input: Awaited<ReturnType<typeof approvedInput>>, idempotencyKey = crypto.randomUUID(), envOverride: Env = env) {
  return dispatch('/api/campaign-packs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: 'https://app.test' },
    body: JSON.stringify(campaignPackBody(input, idempotencyKey))
  }, envOverride)
}

async function approvedInput(cookie: string, workspaceId: string) {
  const form = new FormData()
  form.set('file', new File([validPngBytes()], 'product.png', { type: 'image/png' }))
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

async function expectTerminalGenerationState(
  account: Awaited<ReturnType<typeof registerAccount>>,
  generationId: string
) {
  expect(await env.DB.prepare('SELECT status, output_key AS outputKey FROM generations WHERE id = ?')
    .bind(generationId)
    .first<{ status: string; outputKey: string | null }>()).toEqual({ status: 'failed', outputKey: null })
  expect(await balance(account.currentWorkspace.id)).toEqual({ available: 3, reserved: 0 })
  expect(await ledgerCount(generationId, 'reservation')).toBe(1)
  expect(await ledgerCount(generationId, 'release')).toBe(1)
  expect(await ledgerCount(generationId, 'settlement')).toBe(0)
  expect(await env.MEDIA_BUCKET.get(`workspaces/${account.currentWorkspace.id}/generations/${generationId}.svg`)).toBeNull()
}

async function expectTerminalQueueFailure(
  account: Awaited<ReturnType<typeof registerAccount>>,
  generationId: string,
  queuedInput: ReturnType<typeof generationInput>,
  attempts = 1,
  envOverride: Env = approvedAssistedEnv()
) {
  const fetchMock = vi.fn(async () => { throw new Error('External providers must not be called for stale work.') })
  vi.stubGlobal('fetch', fetchMock)

  const result = await deliver({ generationId, input: queuedInput }, attempts, crypto.randomUUID(), envOverride)
  expect(result.explicitAcks).toHaveLength(1)
  expect(fetchMock).not.toHaveBeenCalled()
  await expectTerminalGenerationState(account, generationId)
}

async function completedDeterministicGeneration(
  account: Awaited<ReturnType<typeof registerAccount>>
) {
  const input = await approvedInput(account.cookie, account.currentWorkspace.id)
  const queued = await createGeneration(account.cookie, input)
  expect(queued.status).toBe(202)
  const { id } = await queued.json() as { id: string }
  const delivery = await deliver({ generationId: id, input })
  expect(delivery.explicitAcks).toHaveLength(1)
  return { id, input }
}

async function markApprovedForDeliveryTamperTest(generationId: string, userId: string) {
  await env.DB.prepare(`
    UPDATE generations
    SET review_status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by_user_id = ?
    WHERE id = ?
  `).bind(userId, generationId).run()
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

    for (const conflictingInput of [
      { ...input, approvedRevision: input.approvedRevision + 1 },
      { ...input, product: { ...input.product, price: 'HK$101' } }
    ]) {
      const conflict = await createCampaignPack(account.cookie, conflictingInput, idempotencyKey)
      expect(conflict.status).toBe(409)
      expect(await conflict.json()).toMatchObject({ error: expect.stringMatching(/idempotency key.*different Campaign Pack request/) })
      expect(await balance(account.currentWorkspace.id)).toEqual({ available: 0, reserved: 3 })
      expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM generations WHERE workspace_id = ? AND campaign_pack_id = ?')
        .bind(account.currentWorkspace.id, payload.campaignPackId)
        .first()).toEqual({ count: 3 })
      expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM output_ledger WHERE workspace_id = ? AND event_type = ?')
        .bind(account.currentWorkspace.id, 'reservation')
        .first()).toEqual({ count: 3 })
    }
  })

  it('rejects unknown Campaign Pack envelope fields without reserving outputs', async () => {
    const account = await registerAccount('Strict Campaign Pack Envelope')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const validBody = campaignPackBody(input)
    const malformedBodies = [
      { ...validBody, unexpected: true },
      { ...validBody, brand: { ...validBody.brand, unexpected: true } },
      { ...validBody, product: { ...validBody.product, unexpected: true } },
      {
        ...validBody,
        outputs: validBody.outputs.map((output, index) => index === 0 ? { ...output, unexpected: true } : output)
      }
    ]

    for (const body of malformedBodies) {
      const response = await dispatch('/api/campaign-packs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
        body: JSON.stringify(body)
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'Invalid Campaign Pack payload.' })
      expect(await balance(account.currentWorkspace.id)).toEqual({ available: 3, reserved: 0 })
      expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM campaign_packs WHERE workspace_id = ?')
        .bind(account.currentWorkspace.id)
        .first()).toEqual({ count: 0 })
      expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM generations WHERE workspace_id = ?')
        .bind(account.currentWorkspace.id)
        .first()).toEqual({ count: 0 })
      expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM output_ledger WHERE workspace_id = ?')
        .bind(account.currentWorkspace.id)
        .first()).toEqual({ count: 0 })
    }
  })

  it('rejects unknown single-generation fields without reserving outputs', async () => {
    const account = await registerAccount('Strict Generation Input')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const malformedInputs = [
      { ...input, unexpected: true },
      { ...input, brand: { ...input.brand, unexpected: true } },
      { ...input, product: { ...input.product, unexpected: true } }
    ]

    for (const malformedInput of malformedInputs) {
      const response = await dispatch('/api/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
        body: JSON.stringify(malformedInput)
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'Invalid generation payload.' })
      expect(await balance(account.currentWorkspace.id)).toEqual({ available: 3, reserved: 0 })
      expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM generations WHERE workspace_id = ?')
        .bind(account.currentWorkspace.id)
        .first()).toEqual({ count: 0 })
      expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM output_ledger WHERE workspace_id = ?')
        .bind(account.currentWorkspace.id)
        .first()).toEqual({ count: 0 })
    }
  })

  it('completes, privately reads, and explicitly deletes a synthetic three-ratio deterministic Campaign Pack', async () => {
    const account = await registerAccount('Synthetic Campaign Pack')
    const otherOwner = await registerAccount('Synthetic Other Owner')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const deterministicEnv = {
      ...env,
      GENERATION_MODE: 'deterministic' as const,
      AGENT_MODE: 'deterministic' as const,
      ASSISTED_PROVIDER: 'disabled',
      OPENAI_API_KEY: undefined
    }

    const created = await createCampaignPack(account.cookie, input, crypto.randomUUID(), deterministicEnv)
    expect(created.status).toBe(202)
    const payload = await created.json() as {
      generations: Array<{
        id: string
        workflowId: ReturnType<typeof generationInput>['workflowId']
        aspectRatio: ReturnType<typeof generationInput>['aspectRatio']
      }>
    }
    expect(payload.generations.map((item) => item.aspectRatio).sort()).toEqual(['1:1', '4:5', '9:16'])
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 0, reserved: 3 })

    const fetchMock = vi.fn(async () => { throw new Error('External providers must remain disabled.') })
    vi.stubGlobal('fetch', fetchMock)
    for (const generation of payload.generations) {
      const result = await deliver({
        generationId: generation.id,
        input: { ...input, workflowId: generation.workflowId, aspectRatio: generation.aspectRatio }
      }, 1, crypto.randomUUID(), deterministicEnv)
      expect(result.explicitAcks).toHaveLength(1)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 0, reserved: 0 })

    const listed = await dispatch(`/api/generations?workspaceId=${account.currentWorkspace.id}`, {
      headers: { cookie: account.cookie }
    }, deterministicEnv)
    expect(listed.status).toBe(200)
    const listedPayload = await listed.json() as { generations: Array<{ id: string; status: string; imageUrl: string }> }
    expect(listedPayload.generations).toHaveLength(3)
    expect(listedPayload.generations.every((item) => item.status === 'completed' && item.imageUrl)).toBe(true)
    for (const generation of listedPayload.generations) {
      expect(Object.keys(generation).sort()).toEqual([
        'approvedRevision', 'aspectRatio', 'campaignPackId', 'contentType', 'createdAt',
        'downloadUrl', 'errorMessage', 'id', 'imageUrl', 'provenance', 'reviewedAt',
        'reviewStatus', 'status', 'workflowId'
      ].sort())
      expect(JSON.stringify(generation)).not.toMatch(/output[_-]?key|storage|workspaces\//i)
    }

    const stored = await env.DB.prepare(`
      SELECT id, output_key AS outputKey
      FROM generations
      WHERE workspace_id = ?
    `).bind(account.currentWorkspace.id).all<{ id: string; outputKey: string }>()
    expect(stored.results).toHaveLength(3)

    for (const generation of listedPayload.generations) {
      const preview = await dispatch(generation.imageUrl, { headers: { cookie: account.cookie } }, deterministicEnv)
      expect(preview.status).toBe(200)
      expect(preview.headers.get('content-type')).toBe('image/svg+xml')
      expect(preview.headers.get('cache-control')).toBe('private, max-age=300')
      expect(await preview.text()).toContain('data:image/png;base64,')

      const crossWorkspace = await dispatch(generation.imageUrl, { headers: { cookie: otherOwner.cookie } }, deterministicEnv)
      expect(crossWorkspace.status).toBe(404)

      const deleted = await dispatch(`/api/generations/${generation.id}`, {
        method: 'DELETE',
        headers: { cookie: account.cookie, origin: 'https://app.test' }
      }, deterministicEnv)
      expect(deleted.status).toBe(204)
    }

    for (const output of stored.results) expect(await env.MEDIA_BUCKET.get(output.outputKey)).toBeNull()
    expect((await dispatch(`/api/generations?workspaceId=${account.currentWorkspace.id}`, {
      headers: { cookie: account.cookie }
    }, deterministicEnv).then((response) => response.json()) as { generations: unknown[] }).generations).toHaveLength(0)

    const assetId = input.referenceAssetIds[0]
    const deletedAsset = await dispatch(`/api/assets/${assetId}`, {
      method: 'DELETE',
      headers: { cookie: account.cookie, origin: 'https://app.test' }
    }, deterministicEnv)
    expect(deletedAsset.status).toBe(204)
    expect(await dispatch(`/api/assets/${assetId}`, { headers: { cookie: account.cookie } }, deterministicEnv).then((response) => response.status)).toBe(404)
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
    const outputKey = `workspaces/${ownerB.currentWorkspace.id}/generations/${generationId}.svg`
    const privateOutput = '<svg xmlns="http://www.w3.org/2000/svg"><text>private-output</text></svg>'
    const privateDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(privateOutput))
    const privateSha256 = await sha256Base64Url(privateOutput)
    await env.MEDIA_BUCKET.put(outputKey, privateOutput, {
      httpMetadata: { contentType: 'image/svg+xml' },
      customMetadata: {
        workflow: 'store-main',
        approvedRevision: '1',
        compositionVersion: 'deterministic-svg-v1',
        generationMode: 'deterministic'
      },
      sha256: privateDigest
    })
    await env.DB.prepare(`
      INSERT INTO generations (
        id, workspace_id, workflow_id, aspect_ratio, status, output_cost, credit_cost,
        input_json, output_key, output_content_type, approved_revision,
        composition_version, generation_mode, output_sha256, completed_at
      )
      VALUES (?, ?, 'store-main', '1:1', 'completed', 2, 2, '{}', ?, 'image/svg+xml', 1,
        'deterministic-svg-v1', 'deterministic', ?, CURRENT_TIMESTAMP)
    `).bind(generationId, ownerB.currentWorkspace.id, outputKey, privateSha256).run()

    const forbiddenImage = await dispatch(`/api/generations/${generationId}/image`, { headers: { cookie: ownerA.cookie } })
    expect(forbiddenImage.status).toBe(404)

    const ownerImage = await dispatch(`/api/generations/${generationId}/image`, { headers: { cookie: ownerB.cookie } })
    expect(ownerImage.status).toBe(200)
    expect(new TextDecoder().decode(await ownerImage.arrayBuffer())).toBe(privateOutput)
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
        return Response.json({ data: [{ b64_json: syntheticPngBase64 }] })
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

  it('terminally fails a queued generation after its approved brief is replanned', async () => {
    const account = await registerAccount('Queue Replan')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const assistedEnv = manuallyDeliveredAssistedEnv()
    const queued = await createGeneration(account.cookie, input, assistedEnv)
    expect(queued.status).toBe(202)
    const { id } = await queued.json() as { id: string }

    const replanned = await dispatch('/api/campaign-agent/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
      body: JSON.stringify({
        brief: {
          assetId: input.referenceAssetIds[0],
          intent: input.intent,
          brand: input.brand,
          product: { ...input.product, promotion: 'A changed, unapproved offer' }
        }
      })
    }, assistedEnv)
    expect(replanned.status).toBe(200)

    await expectTerminalQueueFailure(account, id, input, 1, assistedEnv)
  })

  it('revalidates approval on a retry and releases once after the Agent is reset', async () => {
    const account = await registerAccount('Queue Reset Retry')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const assistedEnv = manuallyDeliveredAssistedEnv()
    const queued = await createGeneration(account.cookie, input, assistedEnv)
    const { id } = await queued.json() as { id: string }
    await env.DB.prepare("UPDATE generations SET status = 'processing', processing_attempt = 1 WHERE id = ?").bind(id).run()

    const agent = await getAgentByName(env.CAMPAIGN_AGENT, account.currentWorkspace.id)
    await agent.resetPlan()
    await expectTerminalQueueFailure(account, id, input, 2, assistedEnv)

    const duplicate = await deliver({ generationId: id, input }, 3, crypto.randomUUID(), assistedEnv)
    expect(duplicate.explicitAcks).toHaveLength(1)
    expect(await ledgerCount(id, 'release')).toBe(1)
  })

  it('terminally fails claimed work when the canonical workspace is suspended', async () => {
    const account = await registerAccount('Queue Suspended Workspace')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const assistedEnv = manuallyDeliveredAssistedEnv()
    const queued = await createGeneration(account.cookie, input, assistedEnv)
    const { id } = await queued.json() as { id: string }
    await env.DB.prepare("UPDATE workspaces SET access_status = 'suspended' WHERE id = ?").bind(account.currentWorkspace.id).run()

    await expectTerminalQueueFailure(account, id, input, 1, assistedEnv)
  })

  it('terminally fails before provider or R2 work when the canonical source asset is gone', async () => {
    const account = await registerAccount('Queue Missing Source')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const assistedEnv = manuallyDeliveredAssistedEnv()
    const queued = await createGeneration(account.cookie, input, assistedEnv)
    const { id } = await queued.json() as { id: string }
    const asset = await env.DB.prepare('SELECT object_key AS objectKey FROM media_assets WHERE id = ? AND workspace_id = ?')
      .bind(input.referenceAssetIds[0], account.currentWorkspace.id)
      .first<{ objectKey: string }>()
    await env.DB.prepare('DELETE FROM media_assets WHERE id = ? AND workspace_id = ?').bind(input.referenceAssetIds[0], account.currentWorkspace.id).run()
    if (asset) await env.MEDIA_BUCKET.delete(asset.objectKey)

    await expectTerminalQueueFailure(account, id, input, 1, assistedEnv)
  })

  it('terminally fails before provider work when the canonical source asset bytes have changed', async () => {
    const account = await registerAccount('Queue Changed Source')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const assistedEnv = manuallyDeliveredAssistedEnv()
    const queued = await createGeneration(account.cookie, input, assistedEnv)
    const { id } = await queued.json() as { id: string }
    const asset = await env.DB.prepare('SELECT object_key AS objectKey FROM media_assets WHERE id = ? AND workspace_id = ?')
      .bind(input.referenceAssetIds[0], account.currentWorkspace.id)
      .first<{ objectKey: string }>()
    const original = asset?.objectKey ? await env.MEDIA_BUCKET.get(asset.objectKey) : null
    expect(original).not.toBeNull()
    const replacement = validPngBytes()
    replacement[replacement.byteLength - 1] ^= 1
    const replacementDigest = await crypto.subtle.digest('SHA-256', replacement)
    await env.MEDIA_BUCKET.put(asset!.objectKey, replacement, {
      httpMetadata: original!.httpMetadata,
      customMetadata: original!.customMetadata,
      sha256: replacementDigest
    })

    await expectTerminalQueueFailure(account, id, input, 1, assistedEnv)
  })

  it('rejects a queue message whose input does not match the canonical D1 input', async () => {
    const account = await registerAccount('Queue Message Identity')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const assistedEnv = manuallyDeliveredAssistedEnv()
    const queued = await createGeneration(account.cookie, input, assistedEnv)
    const { id } = await queued.json() as { id: string }
    const tampered = { ...input, product: { ...input.product, price: 'Unapproved queue value' } }

    await expectTerminalQueueFailure(account, id, tampered, 1, assistedEnv)
  })

  it('rechecks approval after copy egress and blocks image-provider egress after a concurrent replan', async () => {
    const account = await registerAccount('Queue Provider Replan')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const assistedEnv = manuallyDeliveredAssistedEnv()
    const queued = await createGeneration(account.cookie, input, assistedEnv)
    const { id } = await queued.json() as { id: string }

    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
      if (url.endsWith('/v1/responses')) {
        const agent = await getAgentByName(env.CAMPAIGN_AGENT, account.currentWorkspace.id)
        await agent.planBrief({
          assetId: input.referenceAssetIds[0],
          intent: input.intent,
          brand: input.brand,
          product: { ...input.product, promotion: 'Concurrent unapproved replan' }
        })
        return Response.json({ output_text: JSON.stringify({ imagePrompt: 'Background', headline: 'Headline', body: 'Body', hashtags: [], cta: 'Buy' }) })
      }
      if (url.endsWith('/v1/images/generations')) return Response.json({ data: [{ b64_json: syntheticPngBase64 }] })
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await deliver({ generationId: id, input }, 1, crypto.randomUUID(), assistedEnv)
    expect(result.explicitAcks).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expectTerminalGenerationState(account, id)
  })

  it('rechecks workspace activity immediately before R2 put after provider execution', async () => {
    const account = await registerAccount('Queue Provider Suspension')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const assistedEnv = manuallyDeliveredAssistedEnv()
    const queued = await createGeneration(account.cookie, input, assistedEnv)
    const { id } = await queued.json() as { id: string }

    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
      if (url.endsWith('/v1/responses')) {
        return Response.json({ output_text: JSON.stringify({ imagePrompt: 'Background', headline: 'Headline', body: 'Body', hashtags: [], cta: 'Buy' }) })
      }
      if (url.endsWith('/v1/images/generations')) {
        await env.DB.prepare("UPDATE workspaces SET access_status = 'suspended' WHERE id = ?").bind(account.currentWorkspace.id).run()
        return Response.json({ data: [{ b64_json: syntheticPngBase64 }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await deliver({ generationId: id, input }, 1, crypto.randomUUID(), assistedEnv)
    expect(result.explicitAcks).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expectTerminalGenerationState(account, id)
  })

  it('rechecks source ownership immediately before R2 put after provider execution', async () => {
    const account = await registerAccount('Queue Provider Source Delete')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const assistedEnv = manuallyDeliveredAssistedEnv()
    const queued = await createGeneration(account.cookie, input, assistedEnv)
    const { id } = await queued.json() as { id: string }
    const asset = await env.DB.prepare('SELECT object_key AS objectKey FROM media_assets WHERE id = ? AND workspace_id = ?')
      .bind(input.referenceAssetIds[0], account.currentWorkspace.id)
      .first<{ objectKey: string }>()

    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
      if (url.endsWith('/v1/responses')) {
        return Response.json({ output_text: JSON.stringify({ imagePrompt: 'Background', headline: 'Headline', body: 'Body', hashtags: [], cta: 'Buy' }) })
      }
      if (url.endsWith('/v1/images/generations')) {
        await env.DB.prepare('DELETE FROM media_assets WHERE id = ? AND workspace_id = ?').bind(input.referenceAssetIds[0], account.currentWorkspace.id).run()
        if (asset) await env.MEDIA_BUCKET.delete(asset.objectKey)
        return Response.json({ data: [{ b64_json: syntheticPngBase64 }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await deliver({ generationId: id, input }, 1, crypto.randomUUID(), assistedEnv)
    expect(result.explicitAcks).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expectTerminalGenerationState(account, id)
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
        return Response.json({ data: [{ b64_json: syntheticPngBase64 }] })
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

  it('retries a provider deadline without releasing allowance, then releases exactly once after the retry limit', async () => {
    const account = await registerAccount('Provider Deadline Retry')
    const input = await approvedInput(account.cookie, account.currentWorkspace.id)
    const assistedEnv = manuallyDeliveredAssistedEnv()
    const queued = await createGeneration(account.cookie, input, assistedEnv)
    expect(queued.status).toBe(202)
    const { id } = await queued.json() as { id: string }
    const messageId = crypto.randomUUID()
    const fetchMock = vi.fn(async () => { throw new TypeError('OpenAI copy request failed: 408') })
    vi.stubGlobal('fetch', fetchMock)

    const retry = await deliver({ generationId: id, input }, 1, messageId, assistedEnv)
    expect(retry.retryMessages).toEqual([{ msgId: messageId }])
    expect(retry.explicitAcks).toHaveLength(0)
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 2, reserved: 1 })
    expect(await ledgerCount(id, 'release')).toBe(0)
    expect(await env.DB.prepare('SELECT status, error_message AS errorMessage FROM generations WHERE id = ?')
      .bind(id)
      .first()).toEqual({ status: 'queued', errorMessage: '素材處理暫時未能完成，系統會自動重試。' })

    const terminal = await deliver({ generationId: id, input }, 4, messageId, assistedEnv)
    expect(terminal.explicitAcks).toEqual([messageId])
    expect(terminal.retryMessages).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 3, reserved: 0 })
    expect(await ledgerCount(id, 'reservation')).toBe(1)
    expect(await ledgerCount(id, 'settlement')).toBe(0)
    expect(await ledgerCount(id, 'release')).toBe(1)
    expect(await env.DB.prepare('SELECT status, error_message AS errorMessage FROM generations WHERE id = ?')
      .bind(id)
      .first()).toEqual({ status: 'failed', errorMessage: '素材未能完成，可用輸出數已自動退回。' })
  })
})

describe('human output review and controlled delivery', () => {
  it('keeps completed output as a private draft until an idempotent human approval unlocks download', async () => {
    const account = await registerAccount('Output Reviewer')
    const otherOwner = await registerAccount('Other Output Reviewer')
    const fetchMock = vi.fn(async () => { throw new Error('Deterministic review must not call an external provider.') })
    vi.stubGlobal('fetch', fetchMock)

    const { id, input } = await completedDeterministicGeneration(account)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 2, reserved: 0 })
    const integrity = await env.DB.prepare('SELECT output_key AS outputKey, output_sha256 AS outputSha256 FROM generations WHERE id = ?')
      .bind(id)
      .first<{ outputKey: string; outputSha256: string }>()
    const stored = integrity?.outputKey ? await env.MEDIA_BUCKET.head(integrity.outputKey) : null
    expect(integrity?.outputSha256).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(stored?.checksums.sha256).toBeDefined()
    expect(bytesBase64Url(new Uint8Array(stored!.checksums.sha256!))).toBe(integrity?.outputSha256)

    const listed = await dispatch(`/api/generations?workspaceId=${account.currentWorkspace.id}`, {
      headers: { cookie: account.cookie }
    })
    expect(listed.status).toBe(200)
    const listedPayload = await listed.json() as {
      generations: Array<{
        id: string
        reviewStatus: string
        reviewedAt: string | null
        imageUrl: string | null
        downloadUrl: string | null
        provenance: { approvedRevision: number; compositionVersion: string | null; generationMode: string | null }
      }>
    }
    const draft = listedPayload.generations.find((item) => item.id === id)
    expect(draft).toMatchObject({
      reviewStatus: 'draft',
      reviewedAt: null,
      imageUrl: `/api/generations/${id}/image`,
      downloadUrl: null,
      provenance: {
        approvedRevision: input.approvedRevision,
        compositionVersion: 'deterministic-svg-v1',
        generationMode: 'deterministic'
      }
    })

    const preview = await dispatch(`/api/generations/${id}/image`, { headers: { cookie: account.cookie } })
    expect(preview.status).toBe(200)
    expect(preview.headers.get('content-disposition')).toBe('inline')
    const blockedDownload = await dispatch(`/api/generations/${id}/download`, { headers: { cookie: account.cookie } })
    expect(blockedDownload.status).toBe(409)

    const approved = await dispatch(`/api/generations/${id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ decision: 'approve', expectedApprovedRevision: input.approvedRevision })
    })
    expect(approved.status).toBe(200)
    expect(await approved.json()).toMatchObject({
      generation: { id, reviewStatus: 'approved', downloadUrl: `/api/generations/${id}/download` },
      replayed: false
    })

    const replayed = await dispatch(`/api/generations/${id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ decision: 'approve', expectedApprovedRevision: input.approvedRevision })
    })
    expect(replayed.status).toBe(200)
    expect(await replayed.json()).toMatchObject({ generation: { reviewStatus: 'approved' }, replayed: true })
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 2, reserved: 0 })
    expect(await ledgerCount(id, 'settlement')).toBe(1)

    const crossWorkspace = await dispatch(`/api/generations/${id}/download`, { headers: { cookie: otherOwner.cookie } })
    expect(crossWorkspace.status).toBe(404)
    const download = await dispatch(`/api/generations/${id}/download`, { headers: { cookie: account.cookie } })
    expect(download.status).toBe(200)
    expect(download.headers.get('content-type')).toBe('image/svg+xml')
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="aislestage-1x1.svg"')
    expect(await download.text()).toContain('Test Product')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when private R2 output metadata no longer matches the canonical SVG format', async () => {
    const account = await registerAccount('R2 Output Format Guard')
    const { id, input } = await completedDeterministicGeneration(account)
    const row = await env.DB.prepare('SELECT output_key AS outputKey FROM generations WHERE id = ?')
      .bind(id)
      .first<{ outputKey: string }>()
    expect(row?.outputKey).toBeTruthy()
    const original = await env.MEDIA_BUCKET.get(row!.outputKey)
    expect(original).not.toBeNull()
    await env.MEDIA_BUCKET.put(row!.outputKey, '<html><script>synthetic active content</script></html>', {
      httpMetadata: { contentType: 'text/html' },
      customMetadata: original!.customMetadata
    })

    const preview = await dispatch(`/api/generations/${id}/image`, { headers: { cookie: account.cookie } })
    expect(preview.status).toBe(409)
    expect(preview.headers.get('content-type')).toContain('application/json')
    expect(await preview.text()).not.toContain('synthetic active content')

    const approved = await dispatch(`/api/generations/${id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ decision: 'approve', expectedApprovedRevision: input.approvedRevision })
    })
    expect(approved.status).toBe(409)
    expect(await env.DB.prepare('SELECT review_status AS reviewStatus FROM generations WHERE id = ?').bind(id).first())
      .toEqual({ reviewStatus: 'draft' })
    await markApprovedForDeliveryTamperTest(id, account.user.id)
    const download = await dispatch(`/api/generations/${id}/download`, { headers: { cookie: account.cookie } })
    expect(download.status).toBe(409)
    expect(download.headers.get('content-type')).toContain('application/json')
    expect(await download.text()).not.toContain('synthetic active content')
  })

  it('fails closed when the canonical D1 output format is not the supported SVG contract', async () => {
    const account = await registerAccount('D1 Output Format Guard')
    const { id, input } = await completedDeterministicGeneration(account)
    await env.DB.prepare("UPDATE generations SET output_content_type = 'text/html' WHERE id = ?")
      .bind(id)
      .run()

    const preview = await dispatch(`/api/generations/${id}/image`, { headers: { cookie: account.cookie } })
    expect(preview.status).toBe(409)
    expect(preview.headers.get('content-type')).toContain('application/json')

    const approved = await dispatch(`/api/generations/${id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ decision: 'approve', expectedApprovedRevision: input.approvedRevision })
    })
    expect(approved.status).toBe(409)
    expect(await env.DB.prepare('SELECT review_status AS reviewStatus FROM generations WHERE id = ?').bind(id).first())
      .toEqual({ reviewStatus: 'draft' })
    await markApprovedForDeliveryTamperTest(id, account.user.id)
    const download = await dispatch(`/api/generations/${id}/download`, { headers: { cookie: account.cookie } })
    expect(download.status).toBe(409)
    expect(download.headers.get('content-type')).toContain('application/json')
  })

  it('fails closed when private R2 provenance metadata no longer matches D1', async () => {
    const account = await registerAccount('R2 Output Provenance Guard')
    const { id, input } = await completedDeterministicGeneration(account)
    const row = await env.DB.prepare('SELECT output_key AS outputKey FROM generations WHERE id = ?')
      .bind(id)
      .first<{ outputKey: string }>()
    const original = row?.outputKey ? await env.MEDIA_BUCKET.get(row.outputKey) : null
    expect(original).not.toBeNull()
    const originalBody = await original!.text()
    await env.MEDIA_BUCKET.put(row!.outputKey, originalBody, {
      httpMetadata: { contentType: 'image/svg+xml' },
      customMetadata: { ...original!.customMetadata, approvedRevision: String(input.approvedRevision + 1) }
    })

    const preview = await dispatch(`/api/generations/${id}/image`, { headers: { cookie: account.cookie } })
    expect(preview.status).toBe(409)
    expect(preview.headers.get('content-type')).toContain('application/json')

    const approved = await dispatch(`/api/generations/${id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ decision: 'approve', expectedApprovedRevision: input.approvedRevision })
    })
    expect(approved.status).toBe(409)
    expect(await env.DB.prepare('SELECT review_status AS reviewStatus FROM generations WHERE id = ?').bind(id).first())
      .toEqual({ reviewStatus: 'draft' })
    await markApprovedForDeliveryTamperTest(id, account.user.id)
    const download = await dispatch(`/api/generations/${id}/download`, { headers: { cookie: account.cookie } })
    expect(download.status).toBe(409)
    expect(download.headers.get('content-type')).toContain('application/json')
  })

  it('fails closed when private R2 output bytes change while all metadata remains canonical', async () => {
    const account = await registerAccount('R2 Output Digest Guard')
    const { id, input } = await completedDeterministicGeneration(account)
    const row = await env.DB.prepare('SELECT output_key AS outputKey FROM generations WHERE id = ?')
      .bind(id)
      .first<{ outputKey: string }>()
    const original = row?.outputKey ? await env.MEDIA_BUCKET.get(row.outputKey) : null
    expect(original).not.toBeNull()
    const replacement = '<svg xmlns="http://www.w3.org/2000/svg"><text>synthetic replacement body</text></svg>'
    const replacementDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(replacement))
    await env.MEDIA_BUCKET.put(row!.outputKey, replacement, {
      httpMetadata: original!.httpMetadata,
      customMetadata: original!.customMetadata,
      sha256: replacementDigest
    })

    const preview = await dispatch(`/api/generations/${id}/image`, { headers: { cookie: account.cookie } })
    expect(preview.status).toBe(409)
    expect(preview.headers.get('content-type')).toContain('application/json')
    expect(await preview.text()).not.toContain('synthetic replacement body')

    const approved = await dispatch(`/api/generations/${id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ decision: 'approve', expectedApprovedRevision: input.approvedRevision })
    })
    expect(approved.status).toBe(409)
    expect(await env.DB.prepare('SELECT review_status AS reviewStatus FROM generations WHERE id = ?').bind(id).first())
      .toEqual({ reviewStatus: 'draft' })

    await markApprovedForDeliveryTamperTest(id, account.user.id)
    const download = await dispatch(`/api/generations/${id}/download`, { headers: { cookie: account.cookie } })
    expect(download.status).toBe(409)
    expect(download.headers.get('content-type')).toContain('application/json')
    expect(await download.text()).not.toContain('synthetic replacement body')
  })

  it('rejects unauthorized, stale, malformed, and oversized review decisions without changing the draft', async () => {
    const account = await registerAccount('Bounded Reviewer')
    const otherOwner = await registerAccount('Cross Workspace Reviewer')
    const { id, input } = await completedDeterministicGeneration(account)
    const reviewPath = `/api/generations/${id}/review`

    const crossWorkspace = await dispatch(reviewPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: otherOwner.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ decision: 'approve', expectedApprovedRevision: input.approvedRevision })
    })
    expect(crossWorkspace.status).toBe(404)

    const malformed = await dispatch(reviewPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ decision: 'publish' })
    })
    expect(malformed.status).toBe(400)

    const stale = await dispatch(reviewPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ decision: 'approve', expectedApprovedRevision: input.approvedRevision + 1 })
    })
    expect(stale.status).toBe(409)

    const oversized = await dispatch(reviewPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ decision: 'approve', expectedApprovedRevision: input.approvedRevision, padding: 'x'.repeat(2_048) })
    })
    expect(oversized.status).toBe(413)

    await env.DB.prepare("UPDATE workspace_memberships SET role = 'member' WHERE workspace_id = ? AND user_id = ?")
      .bind(account.currentWorkspace.id, account.user.id)
      .run()
    const memberReview = await dispatch(reviewPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ decision: 'approve', expectedApprovedRevision: input.approvedRevision })
    })
    expect(memberReview.status).toBe(403)

    expect(await env.DB.prepare('SELECT review_status AS reviewStatus, reviewed_at AS reviewedAt FROM generations WHERE id = ?')
      .bind(id)
      .first()).toEqual({ reviewStatus: 'draft', reviewedAt: null })
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 2, reserved: 0 })
  })

  it('allows exactly one immutable decision when approve and reject race', async () => {
    const account = await registerAccount('Concurrent Reviewer')
    const { id, input } = await completedDeterministicGeneration(account)
    const review = (decision: 'approve' | 'reject') => dispatch(`/api/generations/${id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie, origin: 'https://app.test' },
      body: JSON.stringify({ decision, expectedApprovedRevision: input.approvedRevision })
    })

    const responses = await Promise.all([review('approve'), review('reject')])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const row = await env.DB.prepare('SELECT review_status AS reviewStatus, reviewed_at AS reviewedAt, reviewed_by_user_id AS reviewedByUserId FROM generations WHERE id = ?')
      .bind(id)
      .first<{ reviewStatus: string; reviewedAt: string | null; reviewedByUserId: string | null }>()
    expect(['approved', 'rejected']).toContain(row?.reviewStatus)
    expect(row?.reviewedAt).toBeTruthy()
    expect(row?.reviewedByUserId).toBe(account.user.id)

    const download = await dispatch(`/api/generations/${id}/download`, { headers: { cookie: account.cookie } })
    expect(download.status).toBe(row?.reviewStatus === 'approved' ? 200 : 409)
    expect(await balance(account.currentWorkspace.id)).toEqual({ available: 2, reserved: 0 })
  })
})
