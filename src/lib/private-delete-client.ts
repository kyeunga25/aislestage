import { fetchWithTimeout } from './fetch-with-timeout'

export type PrivateResourceKind = 'product-asset' | 'generation' | 'brand-pack'

type ResourceConfig = {
  path: string
  invalidIdentityMessage: string
  invalidResponseMessage: string
  unavailableMessage: string
}

const resourceConfigs: Record<PrivateResourceKind, ResourceConfig> = {
  'product-asset': {
    path: '/api/assets',
    invalidIdentityMessage: '商品圖片識別資料無效，請重新載入。 Product image identity is invalid; reload it.',
    invalidResponseMessage: '未能確認商品圖片刪除結果。 Unable to verify the product image deletion.',
    unavailableMessage: '商品圖片刪除暫時無法使用。 Product image deletion is temporarily unavailable.'
  },
  generation: {
    path: '/api/generations',
    invalidIdentityMessage: '私人輸出識別資料無效，請重新載入。 Private output identity is invalid; reload it.',
    invalidResponseMessage: '未能確認私人輸出刪除結果。 Unable to verify the private output deletion.',
    unavailableMessage: '私人輸出刪除暫時無法使用。 Private output deletion is temporarily unavailable.'
  },
  'brand-pack': {
    path: '/api/brand-packs',
    invalidIdentityMessage: '品牌快照識別資料無效，請重新載入。 Brand snapshot identity is invalid; reload it.',
    invalidResponseMessage: '未能確認品牌快照刪除結果。 Unable to verify the brand snapshot deletion.',
    unavailableMessage: '品牌快照刪除暫時無法使用。 Brand snapshot deletion is temporarily unavailable.'
  }
}

const resourceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const PRIVATE_DELETE_TIMEOUT_MS = 15_000

function deleteFailureMessage(kind: PrivateResourceKind, status: number) {
  if (status === 401 || status === 403) {
    return '工作區授權已改變，請重新登入。 Workspace authorization changed; please sign in again.'
  }
  if (kind === 'generation' && status === 409) {
    return '輸出仍在處理中，完成後才可刪除。 The output is still processing and can be deleted after completion.'
  }
  return resourceConfigs[kind].unavailableMessage
}

export async function deletePrivateResource(kind: PrivateResourceKind, resourceId: string) {
  const config = resourceConfigs[kind]
  if (!config || typeof resourceId !== 'string' || !resourceIdPattern.test(resourceId)) {
    throw new Error(config?.invalidIdentityMessage || '私人資產識別資料無效，請重新載入。 Private resource identity is invalid; reload it.')
  }

  let outcome: { status: number; ok: boolean }
  try {
    outcome = await fetchWithTimeout(
      `${config.path}/${encodeURIComponent(resourceId)}`,
      {
        method: 'DELETE',
        credentials: 'same-origin'
      },
      PRIVATE_DELETE_TIMEOUT_MS,
      async (response) => {
        const result = { status: response.status, ok: response.ok }
        await response.body?.cancel().catch(() => undefined)
        return result
      }
    )
  } catch {
    throw new Error(config.unavailableMessage)
  }
  if (outcome.status === 204 || outcome.status === 404) return
  if (outcome.ok) throw new Error(config.invalidResponseMessage)
  throw new Error(deleteFailureMessage(kind, outcome.status))
}
