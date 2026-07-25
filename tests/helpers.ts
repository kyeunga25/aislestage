import { env } from 'cloudflare:workers'
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import worker, { type Env } from '../src/worker'

const APP_ORIGIN = 'https://app.test'

export type RegisteredAccount = {
  cookie: string
  user: { id: string; email: string; name: string }
  currentWorkspace: {
    id: string
    name: string
    role: 'owner' | 'admin' | 'member'
    planStatus: string
    availableCredits: number
    reservedCredits: number
  }
}

export async function dispatch(path: string, init: RequestInit = {}, envOverride: Env = env) {
  const context = createExecutionContext()
  const request = new Request(`${APP_ORIGIN}${path}`, init) as Parameters<typeof worker.fetch>[0]
  const response = await worker.fetch(request, envOverride, context)
  await waitOnExecutionContext(context)
  return response
}

export function cookieFrom(response: Response) {
  const value = response.headers.get('set-cookie')
  if (!value) throw new Error('Expected response to set a cookie.')
  return value.split(';', 1)[0]
}

export async function registerAccount(label: string): Promise<RegisteredAccount> {
  const emailLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'user'
  const response = await dispatch('/api/auth/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
      origin: APP_ORIGIN
    },
    body: JSON.stringify({
      email: `${emailLabel}-${crypto.randomUUID()}@example.test`,
      password: 'SecurePass123!',
      name: label,
      workspaceName: `${label} Workspace`
    })
  })
  if (response.status !== 201) throw new Error(`Registration failed with ${response.status}: ${await response.text()}`)
  const data = await response.json() as Omit<RegisteredAccount, 'cookie'>
  return { ...data, cookie: cookieFrom(response) }
}

export function generationInput(workspaceId: string) {
  return {
    workspaceId,
    workflowId: 'store-main' as const,
    aspectRatio: '1:1' as const,
    brand: {
      name: 'Test Brand',
      tone: 'clean',
      colors: ['#155eef'],
      forbiddenWords: '',
      locale: 'zh-Hant' as const,
      cta: '立即選購'
    },
    product: {
      name: 'Test Product',
      category: 'electronics',
      benefits: ['Verified benefit'],
      specifications: 'Verified specification',
      price: 'HK$100',
      promotion: '測試優惠',
      channels: ['web']
    },
    referenceImageUrls: []
  }
}
