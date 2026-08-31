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
      briefFileNotice="合成匯入狀態 · Synthetic import status"
      onBrandChange={vi.fn()}
      onProductChange={vi.fn()}
      onIntentChange={vi.fn()}
      onBriefFileImport={vi.fn()}
      onBriefFileExport={vi.fn()}
      onImageSelected={vi.fn()}
      onImageDelete={vi.fn()}
      onPlan={vi.fn()}
      onApprove={vi.fn()}
      onGenerate={vi.fn()}
    />)

    expect(markup).toContain('商品類別')
    expect(markup).toContain('商品規格（選填）')
    expect(markup).toContain('品牌色、限制字詞與渠道')
    expect(markup).toContain('Brand controls')
    expect(markup).toMatch(/<select[^>]+aria-label="主要語言"/)
    expect(markup).toMatch(/<input[^>]+type="color"[^>]+aria-label="品牌色 1"[^>]+value="#155eef"/)
    expect(markup).toMatch(new RegExp(`<textarea[^>]+maxLength="${campaignBriefLimits.brand.forbiddenWords}"[^>]+aria-label="限制字詞"`))
    expect(markup).toMatch(/<input[^>]+aria-label="渠道 1"/)
    expect(markup).toMatch(/<button[^>]+aria-label="新增品牌色"/)
    expect(markup).toMatch(/<button[^>]+aria-label="新增渠道"/)
    expect(markup).toContain('不會自動發佈或改變固定三個輸出')
    expect(markup).toMatch(new RegExp(`<textarea[^>]+maxLength="${campaignBriefLimits.product.specifications}"`))
    expect(markup).toContain('value="synthetic-category"')
    expect(markup).toContain(`maxLength="${campaignBriefLimits.product.category}" value="synthetic-category"`)
    expect(markup).toContain('我確認擁有或已取得必要權利')
    expect(markup).toContain('I have the necessary rights')
    expect(markup).toContain('Campaign Brief 檔案')
    expect(markup).toContain('本機匯入／匯出，不含圖片或工作區識別')
    expect(markup).toContain('合成匯入狀態 · Synthetic import status')
    expect(markup).toMatch(/<button[^>]+aria-label="匯入 Campaign Brief JSON"/)
    expect(markup).toMatch(/<button[^>]+aria-label="匯出 Campaign Brief JSON"/)
    expect(markup).toMatch(/<input[^>]+type="file"[^>]+accept="\.json,application\/json,text\/json"/)
    expect(markup).toContain('先在本機預檢 · Local preflight first')
    expect(markup).toMatch(/<input[^>]+type="checkbox"/)
    expect(markup).toMatch(/<button[^>]+class="upload-zone"[^>]+disabled=""/)
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

    expect(markup).toContain('正在檢查並安全上載… · Checking and uploading securely…')
    expect(markup.match(/disabled=""/g)).toHaveLength(5)
    expect(markup).toMatch(/<input[^>]+type="file"[^>]+disabled=""/)
    expect(markup).toMatch(/<button[^>]+aria-label="更換圖片"[^>]+disabled=""/)
    expect(markup).toMatch(/<button[^>]+aria-label="刪除圖片"[^>]+disabled=""/)
  })

  it('locks the brief, file controls, and product-image mutations while a local brief import is in progress', () => {
    const markup = renderToStaticMarkup(<CampaignWorkspace
      brand={starterBrand}
      product={starterProduct}
      intent="新品推廣"
      image={{ name: 'synthetic.png', url: '/synthetic.png', asset: null, status: 'demo', error: '' }}
      agentState={initialCampaignAgentState()}
      agentBusy={false}
      generationAvailable={true}
      briefFileBusy
      onBrandChange={vi.fn()}
      onProductChange={vi.fn()}
      onIntentChange={vi.fn()}
      onBriefFileImport={vi.fn()}
      onBriefFileExport={vi.fn()}
      onImageSelected={vi.fn()}
      onImageDelete={vi.fn()}
      onPlan={vi.fn()}
      onApprove={vi.fn()}
      onGenerate={vi.fn()}
    />)

    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('匯入中…')
    expect(markup).toMatch(/<fieldset[^>]+class="compact-fields"[^>]+disabled=""/)
    expect(markup).toMatch(/<button[^>]+aria-label="匯入 Campaign Brief JSON"[^>]+disabled=""/)
    expect(markup).toMatch(/<button[^>]+aria-label="匯出 Campaign Brief JSON"[^>]+disabled=""/)
    expect(markup).toMatch(/<input[^>]+accept="\.json,application\/json,text\/json"[^>]+disabled=""/)
    expect(markup).toMatch(/<button[^>]+class="upload-zone"[^>]+disabled=""/)
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
    expect(markup.match(/disabled=""/g)).toHaveLength(5)
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
        colors: Array.from({ length: campaignBriefLimits.brand.colors.items }, (_, index) => `#${index.toString(16).padStart(6, '0')}`),
        locale: 'en'
      },
      product: {
        price: '9'.repeat(campaignBriefLimits.product.price),
        benefits: Array.from({ length: campaignBriefLimits.product.benefits.items }, () => 'x'.repeat(campaignBriefLimits.product.benefits.itemLength))
      }
    })).toEqual([])
  })

  it('rejects empty or non-hex brand colors and withholds local plan approval', () => {
    for (const colors of [[], ['url(//example.test/color)'], ['#fff'], ['#155eef ']]) {
      expect(validateCampaignBrief({ brand: { colors } })).toEqual(expect.arrayContaining([
        expect.stringMatching(/品牌顏色.*#RRGGBB|brand color.*#RRGGBB/i)
      ]))
    }

    const state = buildCampaignPlan({
      assetId: 'synthetic-asset',
      intent: '新品推廣',
      brand: { ...starterBrand, colors: ['url(//example.test/color)'] },
      product: starterProduct
    })
    expect(state.stage).toBe('needs-input')
    expect(state.checks.find((check) => check.id === 'claims')).toMatchObject({
      status: 'action',
      detail: expect.stringMatching(/品牌顏色.*#RRGGBB|brand color.*#RRGGBB/i)
    })

    const { colors: _colors, ...brandWithoutColors } = starterBrand
    const missingColorState = buildCampaignPlan({
      assetId: 'synthetic-asset',
      intent: '新品推廣',
      brand: brandWithoutColors,
      product: starterProduct
    })
    expect(missingColorState.stage).toBe('needs-input')
    expect(missingColorState.checks.find((check) => check.id === 'claims')?.detail).toMatch(/品牌顏色.*#RRGGBB|brand color.*#RRGGBB/i)
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
