import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CollectionView } from '../src/components/CollectionView'
import { starterBrand, starterProduct } from '../src/lib/demo-data'
import type { GenerationResult } from '../src/lib/types'

const results: GenerationResult[] = [
  {
    id: '123e4567-e89b-42d3-a456-426614174000',
    campaignPackId: '123e4567-e89b-42d3-a456-426614174001',
    workspaceId: '123e4567-e89b-42d3-a456-426614174002',
    title: 'Synthetic square draft',
    aspectRatio: '1:1',
    workflowId: 'product-hero',
    status: 'completed',
    reviewStatus: 'draft',
    imageUrl: '/api/generations/123e4567-e89b-42d3-a456-426614174000/preview',
    downloadUrl: null,
    contentType: 'image/svg+xml',
    byteSize: 1024,
    approvedRevision: 1,
    createdAt: '2026-08-10T00:00:00.000Z',
    errorMessage: null,
    provenance: null
  },
  {
    id: '123e4567-e89b-42d3-a456-426614174003',
    campaignPackId: '123e4567-e89b-42d3-a456-426614174001',
    workspaceId: '123e4567-e89b-42d3-a456-426614174002',
    title: 'Synthetic portrait draft',
    aspectRatio: '4:5',
    workflowId: 'social-ad',
    status: 'completed',
    reviewStatus: 'draft',
    imageUrl: '/api/generations/123e4567-e89b-42d3-a456-426614174003/preview',
    downloadUrl: null,
    contentType: 'image/svg+xml',
    byteSize: 1024,
    approvedRevision: 1,
    createdAt: '2026-08-10T00:00:00.000Z',
    errorMessage: null,
    provenance: null
  }
]

describe('Collection View private output deletion state', () => {
  it('serializes delete controls and identifies the output being deleted', () => {
    const markup = renderToStaticMarkup(<CollectionView
      section="assets"
      brand={starterBrand}
      product={starterProduct}
      results={results}
      imageUrl=""
      deletingResultId={results[0].id}
      onBack={vi.fn()}
      onDeleteResult={vi.fn()}
    />)

    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('aria-label="正在刪除 Synthetic square draft · Deleting Synthetic square draft"')
    expect(markup).toContain('刪除中…<span class="visually-hidden"> Deleting…</span>')
    expect(markup.match(/disabled=""/g)).toHaveLength(2)
  })
})
