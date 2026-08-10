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
