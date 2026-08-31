import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ResultsPanel } from '../src/components/ResultsPanel'
import { initialCampaignAgentState } from '../src/lib/campaign-agent'
import { starterBrand, starterProduct } from '../src/lib/demo-data'
import type { GenerationResult } from '../src/lib/types'

const approvedAgentState = {
  ...initialCampaignAgentState(),
  stage: 'approved' as const,
  revision: 2,
  approvedAt: '2026-08-10T00:00:00.000Z'
}

function renderResults(
  results: GenerationResult[],
  canReview = true,
  reviewingId: string | null = null,
  reviewingDecision: 'approve' | 'reject' | null = null
) {
  return renderToStaticMarkup(<ResultsPanel
    results={results}
    product={starterProduct}
    cta={starterBrand.cta}
    ctaEn={starterBrand.ctaEn}
    agentState={approvedAgentState}
    isGenerating={false}
    generationAvailable={true}
    demoMode={false}
    canReview={canReview}
    reviewingId={reviewingId}
    reviewingDecision={reviewingDecision}
    onGenerate={vi.fn()}
    onReview={vi.fn()}
  />)
}

function renderResult(result: GenerationResult, canReview = true) {
  return renderResults([result], canReview)
}

const completedResult: GenerationResult = {
  id: 'synthetic-output',
  campaignPackId: 'synthetic-pack',
  workflowId: 'store-main',
  aspectRatio: '1:1',
  imageUrl: '/api/generations/synthetic-output/image',
  downloadUrl: null,
  title: '1:1 · 商品主圖',
  status: 'completed',
  contentType: 'image/svg+xml',
  approvedRevision: 2,
  reviewStatus: 'draft',
  reviewedAt: null,
  provenance: {
    approvedRevision: 2,
    compositionVersion: 'deterministic-svg-v1',
    generationMode: 'deterministic'
  }
}

describe('ResultsPanel human review boundary', () => {
  it('shows draft approval controls without exposing a download link', () => {
    const markup = renderResult(completedResult)

    expect(markup).toContain('草稿待審核')
    expect(markup).toContain('核准 1:1 商品主圖')
    expect(markup).toContain('標記 1:1 商品主圖需要修改')
    expect(markup).not.toContain('/api/generations/synthetic-output/download')
    expect(markup).toContain('deterministic-svg-v1')
  })

  it('exposes the controlled download only after approval', () => {
    const markup = renderResult({
      ...completedResult,
      reviewStatus: 'approved',
      reviewedAt: '2026-08-10 00:02:00',
      downloadUrl: '/api/generations/synthetic-output/download'
    })

    expect(markup).toContain('已核准')
    expect(markup).toContain('href="/api/generations/synthetic-output/download"')
    expect(markup).toContain('download="aislestage-1x1.svg"')
    expect(markup).toContain('下載 SVG 原件')
    expect(markup).toContain('另存本機 PNG')
    expect(markup).toContain('PNG 只在此瀏覽器從已核准 SVG 建立')
    expect(markup).not.toContain('標記 1:1 商品主圖需要修改')
  })

  it('does not offer local conversion for an unverified or non-SVG output', () => {
    const markup = renderResults([{
      ...completedResult,
      reviewStatus: 'approved',
      reviewedAt: '2026-08-10 00:02:00',
      contentType: 'image/png',
      downloadUrl: '/api/generations/synthetic-output/download'
    }, {
      ...completedResult,
      id: 'legacy-svg-output',
      workflowId: 'meta-ad',
      aspectRatio: '4:5',
      imageUrl: '/api/generations/legacy-svg-output/image',
      title: '4:5 · 社交廣告',
      reviewStatus: 'approved',
      reviewedAt: '2026-08-10 00:03:00',
      downloadUrl: '/api/generations/legacy-svg-output/download',
      provenance: { ...completedResult.provenance!, compositionVersion: 'legacy-composition' }
    }])

    expect(markup).toContain('下載已核准 PNG')
    expect(markup).toContain('下載 SVG 原件')
    expect(markup).not.toContain('另存本機 PNG')
  })

  it('keeps review controls unavailable to a member role', () => {
    const markup = renderResult(completedResult, false)

    expect(markup).toContain('等待 owner 或 admin 核准')
    expect(markup).not.toContain('核准 1:1 商品主圖')
    expect(markup).not.toContain('標記 1:1 商品主圖需要修改')
  })

  it('serializes review controls and marks the selected immutable decision as busy', () => {
    const portraitResult: GenerationResult = {
      ...completedResult,
      id: 'synthetic-portrait-output',
      workflowId: 'meta-ad',
      aspectRatio: '4:5',
      imageUrl: '/api/generations/synthetic-portrait-output/image',
      title: '4:5 · 社交廣告'
    }
    const markup = renderResults([completedResult, portraitResult], true, completedResult.id, 'reject')

    expect(markup).toContain('aria-busy="true"')
    expect(markup.match(/disabled=""/g)).toHaveLength(4)
    expect(markup).toContain('處理中…<span class="visually-hidden"> Processing…</span>')
  })
})
