/**
 * SizingService unit tests — Size-Charts Hardening (Gruppe).
 *
 * Covers the four service-level invariants that the audit flagged:
 *   1. Soft-deleted products no longer resolve a chart (returns null).
 *      Pre-hardening, customers viewing an old order detail page for a
 *      now-deleted product would see a stale size guide.
 *   2. Tier-3 fallback (any chart for the category, no default set) uses
 *      `orderBy: { createdAt: 'asc' }` so the result is stable across
 *      requests. Pre-hardening, customers could see different charts on
 *      page refresh when a category had multiple non-default charts.
 *   3. previewChartForCategory shape — admin UI uses this to warn before
 *      a category-change save flips the customer's size guide.
 *   4. listCategoriesWithChartConflicts surfaces categories with the
 *      tier-3 ambiguity (>1 chart, no default) so the admin sizing page
 *      can flag them with a warning badge.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { SizingService } from '../sizing.service'
import { PrismaService } from '../../../prisma/prisma.service'

function buildPrisma() {
  return {
    product: { findFirst: jest.fn() },
    productVariant: { findFirst: jest.fn() },
    supplierDeliveryItem: { findFirst: jest.fn() },
    sizeChart: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
  }
}

async function makeService(prisma: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SizingService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile()
  return module.get(SizingService)
}

describe('SizingService — soft-delete filter (Hardening F)', () => {
  it('returns null for soft-deleted product (deletedAt set)', async () => {
    const prisma = buildPrisma()
    // findFirst with WHERE deletedAt: null returns nothing for soft-deleted.
    prisma.product.findFirst.mockResolvedValue(null)
    const service = await makeService(prisma)

    const result = await service.findChartForProduct('product-soft-deleted')

    expect(result).toBeNull()
    // CRITICAL: must include deletedAt: null in the query so soft-deleted
    // rows are excluded. If this passes only because the chart pool is
    // empty, the meta-verify would not catch the regression.
    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    )
  })

  it('still resolves chart for active product (deletedAt: null)', async () => {
    const prisma = buildPrisma()
    prisma.product.findFirst.mockResolvedValue({ categoryId: 'cat-1' })
    prisma.productVariant.findFirst.mockResolvedValue(null)
    prisma.sizeChart.findFirst
      .mockResolvedValueOnce(null) // tier 2: no default
      .mockResolvedValueOnce({ id: 'chart-1', name: 'Tops Default', entries: [] }) // tier 3
    const service = await makeService(prisma)

    const result = await service.findChartForProduct('product-active')

    expect(result).toEqual({ id: 'chart-1', name: 'Tops Default', entries: [] })
  })
})

describe('SizingService — deterministic tier-3 fallback (Hardening E)', () => {
  it('uses orderBy createdAt:asc when falling through to tier 3', async () => {
    const prisma = buildPrisma()
    prisma.product.findFirst.mockResolvedValue({ categoryId: 'cat-1' })
    prisma.productVariant.findFirst.mockResolvedValue(null)
    prisma.sizeChart.findFirst
      .mockResolvedValueOnce(null) // tier 2: no default
      .mockResolvedValueOnce({ id: 'oldest-chart', name: 'Original', entries: [] }) // tier 3
    const service = await makeService(prisma)

    await service.findChartForProduct('product-1')

    // The tier-3 call (3rd findFirst, but only 2nd reached when supplier
    // path skipped) must include orderBy createdAt asc. Without this,
    // multiple charts in the same category would cause non-deterministic
    // results across requests — the audit's flagged "different chart on
    // refresh" bug.
    const tier3Call = prisma.sizeChart.findFirst.mock.calls[1][0]
    expect(tier3Call).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          categoryId: 'cat-1',
          isActive: true,
        }),
        orderBy: { createdAt: 'asc' },
      }),
    )
  })
})

describe('SizingService.previewChartForCategory (Hardening D)', () => {
  it('returns { current, preview, willChange:true } when chart will switch', async () => {
    const prisma = buildPrisma()
    // findChartForProduct call (current) — supplier path not taken
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', categoryId: 'cat-current' })
    prisma.productVariant.findFirst.mockResolvedValue(null)
    prisma.sizeChart.findFirst
      .mockResolvedValueOnce(null) // current: tier 2
      .mockResolvedValueOnce({ id: 'chart-A', name: 'Damen Tops', chartType: 'tops', entries: [] }) // current tier 3
      .mockResolvedValueOnce(null) // preview: tier 2
      .mockResolvedValueOnce({ id: 'chart-B', name: 'Herren Tops', chartType: 'tops' }) // preview tier 3
    const service = await makeService(prisma)

    const result = await service.previewChartForCategory('p1', 'cat-target')

    expect(result.willChange).toBe(true)
    expect(result.current?.name).toBe('Damen Tops')
    expect(result.preview?.name).toBe('Herren Tops')
  })

  it('returns willChange:false when the same chart resolves for both', async () => {
    const prisma = buildPrisma()
    // Both current and preview resolve to the same chart-id (e.g. moving
    // between two categories that share a chart via supplier-match).
    prisma.product.findFirst.mockResolvedValue({ id: 'p1', categoryId: 'cat-current' })
    prisma.productVariant.findFirst.mockResolvedValue(null)
    const sameChart = { id: 'chart-shared', name: 'Shared', chartType: 'tops', entries: [] }
    prisma.sizeChart.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sameChart)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'chart-shared', name: 'Shared', chartType: 'tops' })
    const service = await makeService(prisma)

    const result = await service.previewChartForCategory('p1', 'cat-target')

    expect(result.willChange).toBe(false)
  })

  it('returns null safely when product missing', async () => {
    const prisma = buildPrisma()
    prisma.product.findFirst.mockResolvedValue(null)
    const service = await makeService(prisma)

    const result = await service.previewChartForCategory('missing', 'cat-target')

    expect(result).toEqual({ current: null, preview: null, willChange: false })
  })
})

describe('SizingService.listCategoriesWithChartConflicts (Hardening E)', () => {
  it('flags categories with multiple charts and no default set', async () => {
    const prisma = buildPrisma()
    prisma.sizeChart.groupBy.mockResolvedValue([
      { categoryId: 'cat-conflict', _count: { id: 3 } },
      { categoryId: 'cat-resolved', _count: { id: 2 } },
    ])
    // cat-conflict: 3 charts, none default → conflict
    // cat-resolved: 2 charts, one is default → not a conflict
    prisma.sizeChart.findMany
      .mockResolvedValueOnce([
        { id: 'a', name: 'Chart A', isDefault: false },
        { id: 'b', name: 'Chart B', isDefault: false },
        { id: 'c', name: 'Chart C', isDefault: false },
      ])
      .mockResolvedValueOnce([
        { id: 'd', name: 'Chart D', isDefault: true },
        { id: 'e', name: 'Chart E', isDefault: false },
      ])
    const service = await makeService(prisma)

    const result = await service.listCategoriesWithChartConflicts()

    expect(result.count).toBe(1)
    expect(result.conflicts[0].categoryId).toBe('cat-conflict')
    expect(result.conflicts[0].chartCount).toBe(3)
    expect(result.conflicts[0].chartNames).toEqual(['Chart A', 'Chart B', 'Chart C'])
  })

  it('returns empty list when all multi-chart categories have a default', async () => {
    const prisma = buildPrisma()
    prisma.sizeChart.groupBy.mockResolvedValue([
      { categoryId: 'cat-1', _count: { id: 2 } },
    ])
    prisma.sizeChart.findMany.mockResolvedValueOnce([
      { id: 'a', name: 'Default Chart', isDefault: true },
      { id: 'b', name: 'Alt Chart', isDefault: false },
    ])
    const service = await makeService(prisma)

    const result = await service.listCategoriesWithChartConflicts()

    expect(result.count).toBe(0)
    expect(result.conflicts).toEqual([])
  })
})
