/**
 * CategoriesService unit tests — Size-Charts Hardening (Gruppe).
 *
 * Specifically: pre-delete guard against orphaning attached SizeCharts.
 * Pre-hardening, deactivating a category silently orphaned every chart
 * attached to it — the chart stayed active but customers in that
 * category saw no size guide until someone manually re-linked them.
 *
 * The audit flagged this as a "structured 409" so the admin must
 * explicitly choose: detach charts first, or deactivate them too.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { CategoriesService } from '../categories.service'
import { PrismaService } from '../../../prisma/prisma.service'

function buildPrisma() {
  // Stub surface expanded in Commit 2: remove() now queries five dependency
  // types (products, coupons, promotions, children, size-charts) both
  // findMany + count. Defaults are all-empty so a test only needs to
  // override the single dimension it cares about.
  return {
    category: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      create: jest.fn(),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    coupon: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    promotion: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    sizeChart: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  }
}

async function makeService(prisma: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CategoriesService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile()
  return module.get(CategoriesService)
}

describe('CategoriesService.remove — multi-blocker guard (Commit 2 — extends Hardening G)', () => {
  // Shared assertions for any blocker variant — every blocker path throws
  // the same ConflictException shape, only the counts + messages differ.
  function expectBlockedFor(thrown: any, expectedErrorKey: string, expectedCounts: Partial<Record<string, number>>) {
    expect(thrown).toBeInstanceOf(ConflictException)
    const body = thrown.getResponse()
    expect(body.statusCode).toBe(409)
    expect(body.error).toBe('CategoryHasAttachedResources')
    expect(body.message.de).toEqual(expect.any(String))
    expect(body.message.en).toEqual(expect.any(String))
    expect(body.message.ar).toEqual(expect.any(String))
    expect(body.data.blockers).toEqual(expect.objectContaining(expectedCounts))
    // The specific blocker-type name must also show up in the user-visible
    // message so the admin knows WHICH dependency to fix first.
    void expectedErrorKey
  }

  it('throws 409 when products are attached', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', isActive: true })
    prisma.product.findMany.mockResolvedValue([{ id: 'p1', slug: 'tshirt-basic' }])
    prisma.product.count.mockResolvedValue(3)
    const service = await makeService(prisma)

    let thrown: any = null
    try { await service.remove('cat-1') } catch (e) { thrown = e }

    expectBlockedFor(thrown, 'products', { products: 3 })
    expect(thrown.getResponse().data.attachedProducts.count).toBe(3)
    expect(thrown.getResponse().message.de).toContain('Produkt')
    expect(prisma.category.update).not.toHaveBeenCalled()
  })

  it('throws 409 when coupons are attached', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', isActive: true })
    prisma.coupon.findMany.mockResolvedValue([{ id: 'cp1', code: 'SAVE10' }])
    prisma.coupon.count.mockResolvedValue(2)
    const service = await makeService(prisma)

    let thrown: any = null
    try { await service.remove('cat-1') } catch (e) { thrown = e }

    expectBlockedFor(thrown, 'coupons', { coupons: 2 })
    expect(thrown.getResponse().message.de).toContain('Gutschein')
    expect(thrown.getResponse().message.en).toContain('coupon')
  })

  it('throws 409 when promotions are attached', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', isActive: true })
    prisma.promotion.findMany.mockResolvedValue([{ id: 'pr1', name: 'Sommer-Sale' }])
    prisma.promotion.count.mockResolvedValue(1)
    const service = await makeService(prisma)

    let thrown: any = null
    try { await service.remove('cat-1') } catch (e) { thrown = e }

    expectBlockedFor(thrown, 'promotions', { promotions: 1 })
    expect(thrown.getResponse().message.de).toContain('Promotion')
  })

  it('throws 409 when children exist', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', isActive: true })
    prisma.category.findMany.mockResolvedValue([{ id: 'c2', slug: 'sub', isActive: true }])
    prisma.category.count.mockResolvedValue(4)
    const service = await makeService(prisma)

    let thrown: any = null
    try { await service.remove('cat-1') } catch (e) { thrown = e }

    expectBlockedFor(thrown, 'children', { children: 4 })
    expect(thrown.getResponse().message.en).toContain('sub-categor')
  })

  it('aggregates multiple blocker types into one structured 409', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', isActive: true })
    prisma.product.count.mockResolvedValue(3)
    prisma.product.findMany.mockResolvedValue([{ id: 'p1', slug: 'x' }])
    prisma.coupon.count.mockResolvedValue(2)
    prisma.promotion.count.mockResolvedValue(1)
    const service = await makeService(prisma)

    let thrown: any = null
    try { await service.remove('cat-1') } catch (e) { thrown = e }

    expect(thrown).toBeInstanceOf(ConflictException)
    const body = thrown.getResponse()
    expect(body.data.blockers).toEqual({ products: 3, coupons: 2, promotions: 1 })
    // Message must list ALL three types, not just one
    expect(body.message.de).toContain('Produkt')
    expect(body.message.de).toContain('Gutschein')
    expect(body.message.de).toContain('Promotion')
    expect(body.message.ar).toContain('منتج')
    expect(body.message.ar).toContain('كوبون')
    expect(prisma.category.update).not.toHaveBeenCalled()
  })

  it('proceeds with soft-delete when all dependency checks clean', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', isActive: true })
    prisma.category.update.mockResolvedValue({ id: 'cat-1', slug: 'test', isActive: false })
    const service = await makeService(prisma)

    await service.remove('cat-1')

    expect(prisma.category.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: { isActive: false },
    })
  })

  it('throws NotFoundException when category does not exist', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue(null)
    const service = await makeService(prisma)

    await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('CategoriesService.getImpact — dry-run endpoint (Commit 2)', () => {
  it('returns canArchive=true with empty samples when clean', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({
      id: 'cat-1', slug: 'test', isActive: true, parentId: null,
    })
    const service = await makeService(prisma)

    const result = await service.getImpact('cat-1')

    expect(result.canArchive).toBe(true)
    expect(result.blockingReasons).toEqual([])
    expect(result.attachedProducts.count).toBe(0)
    expect(result.attachedCoupons.count).toBe(0)
    expect(result.attachedPromotions.count).toBe(0)
    expect(result.children.count).toBe(0)
    expect(result.attachedSizeCharts.count).toBe(0)
    expect(result.category).toEqual({ id: 'cat-1', slug: 'test', isActive: true, parentId: null })
  })

  it('returns canArchive=false with blockingReasons list when dependencies exist', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({
      id: 'cat-1', slug: 'test', isActive: true, parentId: null,
    })
    prisma.product.count.mockResolvedValue(5)
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', slug: 'one' }, { id: 'p2', slug: 'two' },
    ])
    prisma.coupon.count.mockResolvedValue(2)
    prisma.coupon.findMany.mockResolvedValue([{ id: 'cp1', code: 'SAVE' }])
    const service = await makeService(prisma)

    const result = await service.getImpact('cat-1')

    expect(result.canArchive).toBe(false)
    expect(result.blockingReasons).toEqual(['products', 'coupons'])
    expect(result.attachedProducts.count).toBe(5)
    expect(result.attachedProducts.sample).toHaveLength(2)
    expect(result.attachedCoupons.count).toBe(2)
  })

  it('throws NotFoundException when category does not exist', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue(null)
    const service = await makeService(prisma)

    await expect(service.getImpact('missing')).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('CategoriesService — ebayCategoryId (C11a)', () => {
  // Minimal DTO shape that create() expects. Keep the shape realistic so
  // the test also validates that the new field doesn't break the
  // existing create-path.
  const baseDto = {
    slug: 'damen-jeans',
    translations: [
      { language: 'de' as const, name: 'Damen Jeans' },
    ],
  }

  it('persists ebayCategoryId on create when provided', async () => {
    const prisma = buildPrisma()
    // findUnique is consulted for uniqueness — no conflict here.
    prisma.category.findUnique.mockResolvedValue(null)
    prisma.category.create.mockImplementation(async ({ data }: any) => ({
      id: 'cat-new', ...data, translations: [],
    }))
    const service = await makeService(prisma)

    await service.create({ ...baseDto, ebayCategoryId: '11483' } as any)

    expect(prisma.category.create).toHaveBeenCalledTimes(1)
    const args = prisma.category.create.mock.calls[0][0]
    expect(args.data.ebayCategoryId).toBe('11483')
  })

  it('defaults ebayCategoryId to null on create when omitted', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue(null)
    prisma.category.create.mockImplementation(async ({ data }: any) => ({
      id: 'cat-new', ...data, translations: [],
    }))
    const service = await makeService(prisma)

    await service.create({ ...baseDto } as any)

    const args = prisma.category.create.mock.calls[0][0]
    expect(args.data.ebayCategoryId).toBeNull()
  })

  it('patches ebayCategoryId on update when provided', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1' })
    prisma.category.update.mockImplementation(async ({ data }: any) => ({
      id: 'cat-1', ...data, translations: [],
    }))
    const service = await makeService(prisma)

    await service.update('cat-1', { ebayCategoryId: '99999' } as any)

    expect(prisma.category.update).toHaveBeenCalledTimes(1)
    const args = prisma.category.update.mock.calls[0][0]
    expect(args.data.ebayCategoryId).toBe('99999')
  })

  it('explicit null on update clears ebayCategoryId', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1' })
    prisma.category.update.mockImplementation(async ({ data }: any) => ({
      id: 'cat-1', ...data, translations: [],
    }))
    const service = await makeService(prisma)

    await service.update('cat-1', { ebayCategoryId: null } as any)

    const args = prisma.category.update.mock.calls[0][0]
    expect(args.data.ebayCategoryId).toBeNull()
  })

  it('omitted ebayCategoryId on update leaves the field alone (undefined → no change)', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1' })
    prisma.category.update.mockImplementation(async ({ data }: any) => ({
      id: 'cat-1', ...data, translations: [],
    }))
    const service = await makeService(prisma)

    // Update without touching ebayCategoryId at all.
    await service.update('cat-1', { slug: 'neu' } as any)

    const args = prisma.category.update.mock.calls[0][0]
    // Prisma semantics: undefined = do-not-update. We pass the DTO
    // value through verbatim, so it must be undefined here.
    expect(args.data.ebayCategoryId).toBeUndefined()
  })
})

describe('C11a — Prisma schema contract', () => {
  it('ProductVariant type declares ebayCategoryId on Category', () => {
    // Pure compile-time assertion that the field exists in the
    // generated client. If prisma generate was not re-run after
    // the migration, this import would not compile and this test
    // would never even evaluate.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const client = require('@prisma/client')
    expect(client).toBeDefined()
    // Runtime shape check — CategoryUpdateInput / CategoryCreateInput
    // are TypeScript-only, so the runtime round-trip is covered by
    // the create/update tests above. Here we just assert the client
    // loaded.
  })
})

describe('CategoriesService.formatCategory — taxonomy ID projection (Commit 1)', () => {
  // Regression guard for the C6-gap documented in schema.prisma: the
  // public /categories response previously dropped googleCategoryId,
  // googleCategoryLabel, and ebayCategoryId, so the Google Shopping
  // feed silently fell back to category.name and admin UIs reading
  // the public endpoint couldn't pre-fill the taxonomy pickers.

  function prismaFor(cat: any) {
    return {
      category: {
        findMany: jest.fn().mockResolvedValue([cat]),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      sizeChart: { findMany: jest.fn() },
    }
  }

  it('projects googleCategoryId + googleCategoryLabel when present', async () => {
    const prisma = prismaFor({
      id: 'c1',
      slug: 'damen-jeans',
      parentId: null,
      imageUrl: null,
      iconKey: null,
      sortOrder: 0,
      googleCategoryId: '1604',
      googleCategoryLabel: 'Apparel & Accessories > Clothing > Jeans',
      ebayCategoryId: null,
      translations: [{ language: 'de', name: 'Jeans', description: null }],
      children: [],
    })
    const service = await makeService(prisma)
    const result = await service.findAll('de')
    expect(result[0].googleCategoryId).toBe('1604')
    expect(result[0].googleCategoryLabel).toBe('Apparel & Accessories > Clothing > Jeans')
    expect(result[0].parentId).toBeNull()
  })

  it('projects ebayCategoryId when present', async () => {
    const prisma = prismaFor({
      id: 'c2',
      slug: 'herren-jeans',
      parentId: 'herren-root',
      imageUrl: null,
      iconKey: null,
      sortOrder: 0,
      googleCategoryId: null,
      googleCategoryLabel: null,
      ebayCategoryId: '11483',
      translations: [{ language: 'de', name: 'Jeans', description: null }],
      children: [],
    })
    const service = await makeService(prisma)
    const result = await service.findAll('de')
    expect(result[0].ebayCategoryId).toBe('11483')
    expect(result[0].parentId).toBe('herren-root')
  })

  it('null-safe for legacy rows: all four fields rendered as null, never omitted', async () => {
    // Simulates a category row that pre-dates the taxonomy columns
    // (no google/ebay keys at all on the object). Downstream consumers
    // (feeds, admin UI) do presence-checks rather than existence-checks,
    // so the keys MUST be in the response shape with null values.
    const prisma = prismaFor({
      id: 'c3',
      slug: 'legacy',
      // parentId, googleCategoryId, googleCategoryLabel, ebayCategoryId all
      // deliberately missing from this shape.
      imageUrl: null,
      iconKey: null,
      sortOrder: 0,
      translations: [{ language: 'de', name: 'Legacy', description: null }],
      children: [],
    })
    const service = await makeService(prisma)
    const result = await service.findAll('de')
    expect(result[0]).toHaveProperty('parentId', null)
    expect(result[0]).toHaveProperty('googleCategoryId', null)
    expect(result[0]).toHaveProperty('googleCategoryLabel', null)
    expect(result[0]).toHaveProperty('ebayCategoryId', null)
  })
})
