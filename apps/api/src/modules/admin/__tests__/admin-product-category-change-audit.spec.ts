/**
 * AdminController.updateProduct — category-change audit-log entry
 * (Size-Charts Hardening D).
 *
 * Pre-hardening: re-categorising a product silently changed the
 * customer-visible size guide (different category → different chart
 * via tier 2/3 fallback) without leaving any audit trail. If a
 * customer later disputed the size on an old order, no one could
 * tell when the chart had been swapped.
 *
 * Post-hardening: every category change writes a PRODUCTS_CATEGORY_CHANGED
 * row that includes both the category names AND the chart names
 * (before → after) so the admin can correlate "chart looks different
 * today" with "I moved the product to a different category last week".
 *
 * Construction: AdminController has 21 injected services. Most aren't
 * touched by updateProduct, so we use the same Array(21) positional
 * pattern as admin-settings-parity.spec.ts. Only the slots we use are
 * filled with mocks.
 */

import { AdminController } from '../admin.controller'

describe('AdminController.updateProduct — category change audit (Hardening D)', () => {
  let controller: AdminController
  let auditMock: any
  let prismaMock: any
  let sizingMock: any
  let productsMock: any

  beforeEach(() => {
    auditMock = { log: jest.fn().mockResolvedValue(undefined) }
    prismaMock = {
      product: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      category: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      productTranslation: { upsert: jest.fn() },
      // C4: updateProduct wraps writes in prisma.$transaction for dual-
      // write atomicity with ChannelProductListing. Tests here don't
      // exercise channel transitions (body omits channel* flags), so
      // the `tx` received by the callback is this mock itself.
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      channelProductListing: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((fn: any) => fn(prismaMock)),
    }
    sizingMock = {
      previewChartForCategory: jest.fn(),
    }
    productsMock = { findOne: jest.fn().mockResolvedValue({ id: 'p1' }) }

    // Position the mocks at the right constructor indices.
    // From admin.controller.ts constructor order:
    //   0=dashboard, 1=orders, 2=users, 3=products, 4=inventory,
    //   5=returns, 6=staff, 7=audit, 8=email, 9=prisma, 10=storage,
    //   11=finance, 12=invoiceService, 13=marketing, 14=notification,
    //   15=suppliers, 16=translation, 17=campaigns, 18=shipments,
    //   19=payments, 20=sizing
    const ctorArgs = Array(21).fill(null)
    ctorArgs[3] = productsMock
    ctorArgs[7] = auditMock
    ctorArgs[9] = prismaMock
    ctorArgs[20] = sizingMock
    controller = new (AdminController as any)(...ctorArgs)
  })

  it('writes PRODUCTS_CATEGORY_CHANGED with category + chart name diff', async () => {
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'p1',
      categoryId: 'cat-old',
      deletedAt: null,
    })
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'cat-new',
      isActive: true,
      slug: 'damen-tops',
      translations: [{ language: 'de', name: 'Damen Tops' }],
    })
    prismaMock.category.findUnique.mockResolvedValue({
      id: 'cat-old',
      slug: 'herren-tops',
      translations: [{ language: 'de', name: 'Herren Tops' }],
    })
    sizingMock.previewChartForCategory.mockResolvedValue({
      current: { id: 'chart-A', name: 'Original Chart', chartType: 'tops' },
      preview: { id: 'chart-B', name: 'Damen Chart 2026', chartType: 'tops' },
      willChange: true,
    })

    const req = { user: { id: 'admin-1' } }
    await (controller as any).updateProduct(
      'p1',
      { categoryId: 'cat-new' },
      req,
      '127.0.0.1',
    )

    expect(auditMock.log).toHaveBeenCalledTimes(1)
    const auditCall = auditMock.log.mock.calls[0][0]
    expect(auditCall.action).toBe('PRODUCTS_CATEGORY_CHANGED')
    expect(auditCall.entityType).toBe('product')
    expect(auditCall.entityId).toBe('p1')
    expect(auditCall.changes.before).toEqual({
      categoryId: 'cat-old',
      categoryName: 'Herren Tops',
      chartName: 'Original Chart',
    })
    expect(auditCall.changes.after).toEqual({
      categoryId: 'cat-new',
      categoryName: 'Damen Tops',
      chartName: 'Damen Chart 2026',
    })
    expect(auditCall.adminId).toBe('admin-1')
  })

  it('does NOT write audit entry when categoryId stays the same', async () => {
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'p1',
      categoryId: 'cat-1',
      deletedAt: null,
    })

    await (controller as any).updateProduct(
      'p1',
      { categoryId: 'cat-1', basePrice: 50 }, // identical category
      { user: { id: 'admin-1' } },
      '127.0.0.1',
    )

    // No category change → no audit row.
    expect(auditMock.log).not.toHaveBeenCalled()
    // sizing service is also not called when no diff
    expect(sizingMock.previewChartForCategory).not.toHaveBeenCalled()
  })

  it('still writes audit when categoryId changes but no chart resolves either side', async () => {
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'p1',
      categoryId: 'cat-old',
      deletedAt: null,
    })
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'cat-new',
      isActive: true,
      slug: 'misc',
      translations: [],
    })
    prismaMock.category.findUnique.mockResolvedValue({
      id: 'cat-old',
      slug: 'old-cat',
      translations: [],
    })
    sizingMock.previewChartForCategory.mockResolvedValue({
      current: null,
      preview: null,
      willChange: false,
    })

    await (controller as any).updateProduct(
      'p1',
      { categoryId: 'cat-new' },
      { user: { id: 'admin-1' } },
      '127.0.0.1',
    )

    // Audit STILL fires — admins want to know about category moves
    // even when no size chart is involved.
    expect(auditMock.log).toHaveBeenCalledTimes(1)
    const auditCall = auditMock.log.mock.calls[0][0]
    expect(auditCall.changes.before.chartName).toBeNull()
    expect(auditCall.changes.after.chartName).toBeNull()
  })
})
