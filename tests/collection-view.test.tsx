import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CollectionView } from '../src/components/CollectionView'
import { starterBrand, starterProduct } from '../src/lib/demo-data'
import type { GenerationResult, ProductAssetListItem } from '../src/lib/types'

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

const productAssets: ProductAssetListItem[] = [
  {
    id: '123e4567-e89b-42d3-a456-426614174010',
    name: 'product-image.png',
    contentType: 'image/png',
    sizeBytes: 1024,
    previewUrl: '/api/assets/123e4567-e89b-42d3-a456-426614174010',
    createdAt: '2026-08-30T05:00:00Z'
  },
  {
    id: '123e4567-e89b-42d3-a456-426614174011',
    name: 'product-image.webp',
    contentType: 'image/webp',
    sizeBytes: 2048,
    previewUrl: '/api/assets/123e4567-e89b-42d3-a456-426614174011',
    createdAt: '2026-08-30T05:05:00Z'
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

  it('keeps the last trusted rows visible while a serialized refresh is unavailable', () => {
    const markup = renderToStaticMarkup(<CollectionView
      section="campaigns"
      brand={starterBrand}
      product={starterProduct}
      results={results}
      imageUrl=""
      isRefreshingResults
      notice="輸出清單暫時無法讀取。 Generation list is temporarily unavailable."
      onRefreshResults={vi.fn()}
      onBack={vi.fn()}
      onDeleteResult={vi.fn()}
    />)

    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('aria-label="正在重新載入私人輸出 · Reloading private outputs"')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('class="lucide lucide-refresh-cw spin"')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Generation list is temporarily unavailable.')
    expect(markup).toContain('Campaign Pack · 2 個輸出')
  })

  it('renders reusable private product sources with serialized selection and deletion controls', () => {
    const markup = renderToStaticMarkup(<CollectionView
      section="products"
      brand={starterBrand}
      product={starterProduct}
      results={results}
      imageUrl={productAssets[0].previewUrl}
      productAssets={productAssets}
      selectedProductAssetId={productAssets[0].id}
      deletingProductAssetId={productAssets[1].id}
      isRefreshingProductAssets
      productAssetNotice="私人商品來源圖暫時無法讀取。 Private product sources are temporarily unavailable."
      onRefreshProductAssets={vi.fn()}
      onSelectProductAsset={vi.fn()}
      onDeleteProductAsset={vi.fn()}
      onBack={vi.fn()}
      onDeleteResult={vi.fn()}
    />)

    expect(markup).toContain('已保存來源圖')
    expect(markup).toContain('Private source images')
    expect(markup).toContain('2 張')
    expect(markup).toContain('PNG')
    expect(markup).toContain('WebP')
    expect(markup).toContain('目前使用第 1 張私人商品圖')
    expect(markup).toContain('使用第 2 張私人商品圖')
    expect(markup).toContain('正在刪除第 2 張私人商品圖 · Deleting private product source 2')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Private product sources are temporarily unavailable.')
  })
})
