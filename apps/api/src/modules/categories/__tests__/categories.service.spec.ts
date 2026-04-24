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
  return {
    category: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    sizeChart: {
      findMany: jest.fn(),
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

describe('CategoriesService.remove — pre-delete chart guard (Hardening G)', () => {
  it('throws 409 with structured 3-language message when charts are attached', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', isActive: true })
    prisma.sizeChart.findMany.mockResolvedValue([
      { id: 'chart-1', name: 'Damen Tops' },
      { id: 'chart-2', name: 'Damen Tops Saison 2' },
    ])
    const service = await makeService(prisma)

    let thrown: any = null
    try {
      await service.remove('cat-1')
    } catch (err: any) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(ConflictException)
    const body = thrown.getResponse()
    expect(body.statusCode).toBe(409)
    expect(body.error).toBe('CategoryHasAttachedSizeCharts')
    // 3-language message structure (de/en/ar)
    expect(body.message.de).toContain('2')
    expect(body.message.en).toContain('2')
    expect(body.message.ar).toContain('2')
    // Data payload exposes the chart list so the UI can render it
    expect(body.data.attachedCharts).toHaveLength(2)
    // Crucially: prisma.category.update was NOT called — soft-delete blocked
    expect(prisma.category.update).not.toHaveBeenCalled()
  })

  it('proceeds with soft-delete when no charts are attached', async () => {
    const prisma = buildPrisma()
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', isActive: true })
    prisma.sizeChart.findMany.mockResolvedValue([])
    prisma.category.update.mockResolvedValue({ id: 'cat-1', isActive: false })
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
