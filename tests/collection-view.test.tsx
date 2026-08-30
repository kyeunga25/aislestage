import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CollectionView } from '../src/components/CollectionView'
import { starterBrand, starterProduct } from '../src/lib/demo-data'
import type { GenerationResult, ProductAssetListItem, SavedBrandPack, SavedProductProfile } from '../src/lib/types'

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
    provenance: {
      approvedRevision: 1,
      compositionVersion: 'deterministic-svg-v1',
      generationMode: 'deterministic'
    }
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

const approvedResult: GenerationResult = {
  ...results[1],
  id: '123e4567-e89b-42d3-a456-426614174004',
  title: 'Synthetic portrait approved',
  reviewStatus: 'approved',
  reviewedAt: '2026-08-10T00:05:00.000Z',
  imageUrl: '/api/generations/123e4567-e89b-42d3-a456-426614174004/preview',
  downloadUrl: '/api/generations/123e4567-e89b-42d3-a456-426614174004/download',
  provenance: {
    approvedRevision: 1,
    compositionVersion: 'deterministic-svg-v1',
    generationMode: 'deterministic'
  }
}

const historicalApprovedResult: GenerationResult = {
  ...approvedResult,
  id: '123e4567-e89b-42d3-a456-426614174005',
  campaignPackId: '123e4567-e89b-42d3-a456-426614174006',
  title: 'Historical approved output',
  aspectRatio: '9:16',
  imageUrl: '/api/generations/123e4567-e89b-42d3-a456-426614174005/preview',
  downloadUrl: '/api/generations/123e4567-e89b-42d3-a456-426614174005/download',
  createdAt: '2026-08-09T00:00:00.000Z'
}

const productAssets: ProductAssetListItem[] = [
  {
    id: '123e4567-e89b-42d3-a456-426614174010',
    name: 'product-image.png',
    contentType: 'image/png',
    sizeBytes: 1024,
    widthPx: 1024,
    heightPx: 1024,
    previewUrl: '/api/assets/123e4567-e89b-42d3-a456-426614174010',
    createdAt: '2026-08-30T05:00:00Z'
  },
  {
    id: '123e4567-e89b-42d3-a456-426614174011',
    name: 'product-image.webp',
    contentType: 'image/webp',
    sizeBytes: 2048,
    widthPx: null,
    heightPx: null,
    previewUrl: '/api/assets/123e4567-e89b-42d3-a456-426614174011',
    createdAt: '2026-08-30T05:05:00Z'
  }
]

const brandPacks: SavedBrandPack[] = [{
  ...starterBrand,
  id: '123e4567-e89b-42d3-a456-426614174020',
  approvedRevision: 2,
  createdAt: '2026-08-30T05:10:00Z'
}, {
  ...starterBrand,
  id: '123e4567-e89b-42d3-a456-426614174021',
  name: 'Secondary Brand',
  approvedRevision: 3,
  createdAt: '2026-08-30T05:15:00Z'
}]

const productProfiles: SavedProductProfile[] = [{
  ...starterProduct,
  id: '123e4567-e89b-42d3-a456-426614174030',
  approvedRevision: 2,
  createdAt: '2026-08-30T06:10:00Z'
}, {
  ...starterProduct,
  id: '123e4567-e89b-42d3-a456-426614174031',
  name: 'Secondary Product',
  nameEn: 'Secondary Product',
  approvedRevision: 3,
  createdAt: '2026-08-30T06:15:00Z'
}]

describe('Collection View private output deletion state', () => {
  it('opens the latest Campaign Pack and exposes its authorized review workflow', () => {
    const markup = renderToStaticMarkup(<CollectionView
      section="campaigns"
      brand={starterBrand}
      product={starterProduct}
      results={[...results, historicalApprovedResult]}
      imageUrl=""
      canReview
      onReviewResult={vi.fn()}
      onBack={vi.fn()}
      onDeleteResult={vi.fn()}
    />)

    expect(markup.match(/aria-expanded="true"/g)).toHaveLength(1)
    expect(markup.match(/aria-expanded="false"/g)).toHaveLength(1)
    expect(markup).toContain('Campaign Pack · 2 個輸出')
    expect(markup).toContain('Campaign Pack · 1 個輸出')
    expect(markup).toContain('核准 1:1 Synthetic square draft')
    expect(markup).toContain('標記 4:5 Synthetic portrait draft需要修改')
    expect(markup).toContain('deterministic-svg-v1 · deterministic · plan v1')
    expect(markup).not.toContain('Historical approved output')
  })

  it('makes saved assets reviewable and exposes controlled downloads only after approval', () => {
    const markup = renderToStaticMarkup(<CollectionView
      section="assets"
      brand={starterBrand}
      product={starterProduct}
      results={[results[0], approvedResult]}
      imageUrl=""
      canReview
      onReviewResult={vi.fn()}
      onBack={vi.fn()}
      onDeleteResult={vi.fn()}
    />)

    expect(markup).toContain('草稿待審核')
    expect(markup).toContain('核准 1:1 Synthetic square draft')
    expect(markup).toContain('已核准')
    expect(markup).toContain('href="/api/generations/123e4567-e89b-42d3-a456-426614174004/download"')
    expect(markup).toContain('download="aislestage-4x5.svg"')
    expect(markup).toContain('下載已核准素材')
  })

  it('serializes historical review and delete mutations across all visible outputs', () => {
    const markup = renderToStaticMarkup(<CollectionView
      section="assets"
      brand={starterBrand}
      product={starterProduct}
      results={[results[0], approvedResult]}
      imageUrl=""
      canReview
      reviewingId={results[0].id}
      reviewingDecision="approve"
      onReviewResult={vi.fn()}
      onBack={vi.fn()}
      onDeleteResult={vi.fn()}
    />)

    expect(markup).toContain('aria-busy="true"')
    expect(markup.match(/disabled=""/g)).toHaveLength(4)
    expect(markup).toContain('處理中…<span class="visually-hidden"> Processing…</span>')
  })

  it('keeps historical draft review unavailable to a member role', () => {
    const markup = renderToStaticMarkup(<CollectionView
      section="assets"
      brand={starterBrand}
      product={starterProduct}
      results={[results[0]]}
      imageUrl=""
      canReview={false}
      onReviewResult={vi.fn()}
      onBack={vi.fn()}
      onDeleteResult={vi.fn()}
    />)

    expect(markup).toContain('等待 owner 或 admin 核准')
    expect(markup).not.toContain('核准 1:1 Synthetic square draft')
  })

  it('labels local demo outputs as previews instead of private review drafts', () => {
    const markup = renderToStaticMarkup(<CollectionView
      section="campaigns"
      brand={starterBrand}
      product={starterProduct}
      results={results}
      imageUrl=""
      demoMode
      onBack={vi.fn()}
      onDeleteResult={vi.fn()}
    />)

    expect(markup).toContain('示範預覽')
    expect(markup).not.toContain('草稿待審核')
    expect(markup).not.toContain('>待審核<')
  })

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
    expect(markup).toContain('1024 × 1024 px')
    expect(markup).toContain('尺寸未記錄 · Dimensions unavailable')
    expect(markup).toContain('目前使用第 1 張私人商品圖')
    expect(markup).toContain('使用第 2 張私人商品圖')
    expect(markup).toContain('正在刪除第 2 張私人商品圖 · Deleting private product source 2')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Private product sources are temporarily unavailable.')
  })

  it('renders approved reusable brand snapshots with serialized save, select, and delete controls', () => {
    const markup = renderToStaticMarkup(<CollectionView
      section="brands"
      brand={starterBrand}
      product={starterProduct}
      results={results}
      imageUrl=""
      brandPacks={brandPacks}
      selectedBrandPackId={brandPacks[0].id}
      deletingBrandPackId={brandPacks[1].id}
      isSavingBrandPack
      isRefreshingBrandPacks
      canSaveBrandPack
      brandPackNotice="私人品牌資料暫時無法讀取。 Private brand library is temporarily unavailable."
      onSaveBrandPack={vi.fn()}
      onRefreshBrandPacks={vi.fn()}
      onSelectBrandPack={vi.fn()}
      onDeleteBrandPack={vi.fn()}
      onBack={vi.fn()}
      onDeleteResult={vi.fn()}
    />)

    expect(markup).toContain('已保存品牌快照')
    expect(markup).toContain('Approved brand snapshots')
    expect(markup).toContain('2 個')
    expect(markup).toContain('儲存已核准品牌')
    expect(markup).toContain('目前使用第 1 個品牌快照')
    expect(markup).toContain('使用第 2 個品牌快照')
    expect(markup).toContain('正在刪除第 2 個品牌快照 · Deleting brand snapshot 2')
    expect(markup).toContain('Private brand library is temporarily unavailable.')
  })

  it('renders approved reusable product profiles alongside private source images', () => {
    const markup = renderToStaticMarkup(<CollectionView
      section="products"
      brand={starterBrand}
      product={starterProduct}
      results={results}
      imageUrl="/api/assets/product-source"
      productAssets={productAssets}
      productProfiles={productProfiles}
      selectedProductProfileId={productProfiles[0].id}
      deletingProductProfileId={productProfiles[1].id}
      isSavingProductProfile
      isRefreshingProductProfiles
      canSaveProductProfile
      productProfileNotice="私人商品資料暫時無法讀取。 Private product library is temporarily unavailable."
      onSaveProductProfile={vi.fn()}
      onSelectProductProfile={vi.fn()}
      onDeleteProductProfile={vi.fn()}
      onBack={vi.fn()}
      onDeleteResult={vi.fn()}
    />)

    expect(markup).toContain('已保存商品資料')
    expect(markup).toContain('Approved product profiles')
    expect(markup).toContain('2 個')
    expect(markup).toContain('儲存已核准商品')
    expect(markup).toContain('目前使用第 1 個商品資料快照')
    expect(markup).toContain('使用第 2 個商品資料快照')
    expect(markup).toContain('正在刪除第 2 個商品資料快照 · Deleting product profile 2')
    expect(markup).toContain('Private product library is temporarily unavailable.')
    expect(markup).toContain('已保存來源圖')
  })
})
