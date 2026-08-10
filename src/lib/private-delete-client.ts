export type PrivateResourceKind = 'product-asset' | 'generation'

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
  }
}

const resourceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

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

  let response: Response
  try {
    response = await fetch(`${config.path}/${encodeURIComponent(resourceId)}`, {
      method: 'DELETE',
      credentials: 'same-origin'
    })
  } catch {
    throw new Error(config.unavailableMessage)
  }
  if (response.status === 204) return
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined)
    return
  }
  await response.body?.cancel().catch(() => undefined)
  if (response.ok) throw new Error(config.invalidResponseMessage)
  throw new Error(deleteFailureMessage(kind, response.status))
}
