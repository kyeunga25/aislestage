import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CampaignWorkspace } from '../src/components/CampaignWorkspace'
import { buildCampaignPlan, campaignBriefLimits, campaignStateAfterAssetDeletion, initialCampaignAgentState, validateCampaignBrief } from '../src/lib/campaign-agent'
import { emptyBrand, emptyProduct, starterBrand, starterProduct } from '../src/lib/demo-data'

describe('Campaign Workspace product contract', () => {
  it('renders the required product category field used by generation validation', () => {
    const markup = renderToStaticMarkup(<CampaignWorkspace
      brand={emptyBrand}
      product={{ ...emptyProduct, category: 'synthetic-category' }}
      intent="新品推廣"
      image={{ name: 'synthetic.png', url: '', asset: null, status: 'error', error: '' }}
      agentState={initialCampaignAgentState()}
      agentBusy={false}
      generationAvailable={true}
      onBrandChange={vi.fn()}
      onProductChange={vi.fn()}
      onIntentChange={vi.fn()}
      onImageSelected={vi.fn()}
      onImageDelete={vi.fn()}
      onPlan={vi.fn()}
      onApprove={vi.fn()}
      onGenerate={vi.fn()}
    />)

    expect(markup).toContain('商品類別')
    expect(markup).toContain('value="synthetic-category"')
    expect(markup).toContain(`maxLength="${campaignBriefLimits.product.category}" value="synthetic-category"`)
  })

  it('locks every product-image mutation control while an upload is in progress', () => {
    const markup = renderToStaticMarkup(<CampaignWorkspace
      brand={starterBrand}
      product={starterProduct}
      intent="新品推廣"
      image={{ name: 'synthetic-upload.png', url: 'blob:synthetic-upload', asset: null, status: 'uploading', error: '' }}
      agentState={initialCampaignAgentState()}
      agentBusy={false}
      generationAvailable={true}
      onBrandChange={vi.fn()}
      onProductChange={vi.fn()}
      onIntentChange={vi.fn()}
      onImageSelected={vi.fn()}
      onImageDelete={vi.fn()}
      onPlan={vi.fn()}
      onApprove={vi.fn()}
      onGenerate={vi.fn()}
    />)

    expect(markup.match(/disabled=""/g)).toHaveLength(4)
    expect(markup).toMatch(/<input[^>]+type="file"[^>]+disabled=""/)
    expect(markup).toMatch(/<button[^>]+aria-label="更換圖片"[^>]+disabled=""/)
    expect(markup).toMatch(/<button[^>]+aria-label="刪除圖片"[^>]+disabled=""/)
  })

  it('locks every product-image mutation control while a deletion is in progress', () => {
    const markup = renderToStaticMarkup(<CampaignWorkspace
      brand={starterBrand}
      product={starterProduct}
      intent="新品推廣"
      image={{ name: 'synthetic-private.png', url: '/api/assets/123e4567-e89b-42d3-a456-426614174000', asset: null, status: 'ready', error: '' }}
      imageDeleteBusy
      agentState={initialCampaignAgentState()}
      agentBusy={false}
      generationAvailable={true}
      onBrandChange={vi.fn()}
      onProductChange={vi.fn()}
      onIntentChange={vi.fn()}
      onImageSelected={vi.fn()}
      onImageDelete={vi.fn()}
      onPlan={vi.fn()}
      onApprove={vi.fn()}
      onGenerate={vi.fn()}
    />)

    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('正在安全刪除… Deleting securely…')
    expect(markup).toContain('正在刪除這張私人商品圖片 · Deleting this private product image')
    expect(markup.match(/disabled=""/g)).toHaveLength(4)
    expect(markup).toMatch(/<button[^>]+aria-label="正在刪除圖片 · Deleting image"[^>]+disabled=""/)
  })

  it('locks the approved brief, source image, and duplicate create actions while a Campaign Pack is in progress', () => {
    const planned = buildCampaignPlan({
      assetId: 'synthetic-asset',
      intent: '新品推廣',
      brand: starterBrand,
      product: starterProduct
    })
    const markup = renderToStaticMarkup(<CampaignWorkspace
      brand={starterBrand}
      product={starterProduct}
      intent="新品推廣"
      image={{ name: 'synthetic.png', url: '/synthetic.png', asset: null, status: 'demo', error: '' }}
      generationBusy
      agentState={{ ...planned, stage: 'approved', approvedAt: '2026-08-10T00:00:00.000Z' }}
      agentBusy={false}
      generationAvailable={true}
      onBrandChange={vi.fn()}
      onProductChange={vi.fn()}
      onIntentChange={vi.fn()}
      onImageSelected={vi.fn()}
      onImageDelete={vi.fn()}
      onPlan={vi.fn()}
      onApprove={vi.fn()}
      onGenerate={vi.fn()}
    />)

    expect(markup).toMatch(/<fieldset[^>]+class="compact-fields"[^>]+disabled=""/)
    expect(markup).toContain('素材包建立中… Pack creation in progress…')
    expect(markup).toContain('商品圖片已鎖定至正在建立的素材包 · Product image locked to the Campaign Pack in progress')
    expect(markup).toContain('正在建立 Campaign Pack… <span class="visually-hidden">Creating Campaign Pack…</span>')
    expect(markup).toMatch(/<button[^>]+aria-label="更換圖片"[^>]+disabled=""/)
    expect(markup).toMatch(/<button[^>]+aria-label="刪除圖片"[^>]+disabled=""/)
  })

  it('locks the submitted brief and source image while an Agent action is in progress', () => {
    const planned = buildCampaignPlan({
      assetId: 'synthetic-asset',
      intent: '新品推廣',
      brand: starterBrand,
      product: starterProduct
    })
    const markup = renderToStaticMarkup(<CampaignWorkspace
      brand={starterBrand}
      product={starterProduct}
      intent="新品推廣"
      image={{ name: 'synthetic.png', url: '/synthetic.png', asset: null, status: 'demo', error: '' }}
      agentState={planned}
      agentBusy
      generationAvailable={true}
      onBrandChange={vi.fn()}
      onProductChange={vi.fn()}
      onIntentChange={vi.fn()}
      onImageSelected={vi.fn()}
      onImageDelete={vi.fn()}
      onPlan={vi.fn()}
      onApprove={vi.fn()}
      onGenerate={vi.fn()}
    />)

    expect(markup).toMatch(/<fieldset[^>]+class="compact-fields"[^>]+disabled=""/)
    expect(markup).toContain('Agent 正在處理… Agent action in progress…')
    expect(markup).toContain('商品圖片已鎖定至 Agent 動作 · Product image locked to the Agent action')
    expect(markup).toContain('正在批准…')
    expect(markup).toMatch(/<button[^>]+aria-label="更換圖片"[^>]+disabled=""/)
    expect(markup).toMatch(/<button[^>]+aria-label="刪除圖片"[^>]+disabled=""/)
  })

  it('keeps the Agent at needs-input until the required category is present', () => {
    const state = buildCampaignPlan({
      assetId: 'synthetic-asset',
      intent: '新品推廣',
      brand: starterBrand,
      product: { ...starterProduct, category: '' }
    })

    expect(state.stage).toBe('needs-input')
    expect(state.checks.find((check) => check.id === 'facts')?.detail).toContain('商品類別')
  })

  it('accepts exact shared Campaign Brief boundaries', () => {
    expect(validateCampaignBrief({
      assetId: 'a'.repeat(campaignBriefLimits.assetId),
      intent: 'i'.repeat(campaignBriefLimits.intent),
      brand: {
        name: 'b'.repeat(campaignBriefLimits.brand.name),
        colors: Array.from({ length: campaignBriefLimits.brand.colors.items }, () => 'c'.repeat(campaignBriefLimits.brand.colors.itemLength)),
        locale: 'en'
      },
      product: {
        price: '9'.repeat(campaignBriefLimits.product.price),
        benefits: Array.from({ length: campaignBriefLimits.product.benefits.items }, () => 'x'.repeat(campaignBriefLimits.product.benefits.itemLength))
      }
    })).toEqual([])
  })

  it('rejects unknown Campaign Brief, brand, and product fields', () => {
    for (const value of [
      { unexpected: true },
      { brand: { unexpected: true } },
      { product: { unexpected: true } }
    ]) {
      expect(validateCampaignBrief(value)).toEqual([
        expect.stringMatching(/不支援.*not supported/i)
      ])
    }
  })

  it('shows the composition correction and withholds approval in the workspace', () => {
    const product = { ...starterProduct, price: 'HK$ 12,345,678,900' }
    const agentState = buildCampaignPlan({ assetId: 'synthetic-asset', intent: '新品推廣', brand: starterBrand, product })
    const markup = renderToStaticMarkup(<CampaignWorkspace
      brand={starterBrand}
      product={product}
      intent="新品推廣"
      image={{ name: 'synthetic.png', url: '/synthetic.png', asset: null, status: 'demo', error: '' }}
      agentState={agentState}
      agentBusy={false}
      generationAvailable={true}
      onBrandChange={vi.fn()}
      onProductChange={vi.fn()}
      onIntentChange={vi.fn()}
      onImageSelected={vi.fn()}
      onImageDelete={vi.fn()}
      onPlan={vi.fn()}
      onApprove={vi.fn()}
      onGenerate={vi.fn()}
    />)

    expect(markup).toContain('商業文字需要調整')
    expect(markup).toContain('Price exceeds the composition safe area')
    expect(markup).toContain('重新檢查資料')
    expect(markup).not.toContain('批准輸出計劃')
  })

  it('resets local Agent state only when the deleted asset is the planned source', () => {
    const state = buildCampaignPlan({
      assetId: 'planned-asset',
      intent: '新品推廣',
      brand: starterBrand,
      product: starterProduct
    })

    expect(campaignStateAfterAssetDeletion(state, 'unrelated-asset')).toBe(state)
    expect(campaignStateAfterAssetDeletion(state, 'planned-asset')).toMatchObject({ stage: 'idle', revision: 0, brief: null })
  })
})
