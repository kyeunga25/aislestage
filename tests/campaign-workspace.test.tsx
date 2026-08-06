import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CampaignWorkspace } from '../src/components/CampaignWorkspace'
import { buildCampaignPlan, initialCampaignAgentState } from '../src/lib/campaign-agent'
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
})
