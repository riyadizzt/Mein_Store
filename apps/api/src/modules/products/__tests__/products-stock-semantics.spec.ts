/**
 * Verifies the "max-per-warehouse" stock semantic introduced to fix
 * the 409 Conflict at checkout when stock is split across warehouses.
 *
 * Context: the checkout flow in orders.service.ts:649-651 expects ONE
 * warehouse per cart line and fails if no single warehouse has enough
 * stock for the requested quantity. Historically `formatProduct(Detail)`
 * returned `stock = sum(perWarehouse)` which over-promised. Fix: `stock`
 * is now the max across warehouses, so the storefront UI never shows an
 * orderable quantity that a single warehouse cannot fulfil.
 *
 * These tests drive the private formatter methods directly via bracket
 * access. We only need the formatter to be pure over the input shape
 * (variants/inventory) — no DB, no DI needed.
 */
import { ProductsService } from '../products.service'

function makeService(): ProductsService {
  // ProductsService requires PrismaService + ConfigService + Optional webhook.
  // The private formatters don't touch `this.prisma` or config, so we pass
  // minimal stubs. Cast via `any` to skip public constructor signature check.
  const Svc: any = ProductsService
  return new Svc({}, { get: () => undefined }, undefined)
}

describe('ProductsService stock semantics (max-per-warehouse)', () => {
  const svc = makeService()

  describe('formatProductDetail — variant.stock', () => {
    const variantBase = {
      id: 'v1',
      sku: 'MAL-TEST-001',
      barcode: 'MAL-TEST-001',
      color: 'Grün',
      colorHex: null,
      size: 'S',
      sizeSystem: null,
      isActive: true,
      priceModifier: 0,
      weightGrams: null,
    }

    const productBase = {
      id: 'p1',
      slug: 'test',
      brand: null,
      gender: null,
      basePrice: 10,
      salePrice: null,
      taxRate: 19,
      isFeatured: false,
      publishedAt: null,
      excludeFromReturns: false,
      returnExclusionReason: null,
      translations: [{ language: 'de', name: 'Test', description: 'x' }],
      images: [],
      category: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    it('returns max across warehouses when stock is split (2 + 0 + 1)', () => {
      const input = {
        ...productBase,
        variants: [
          {
            ...variantBase,
            inventory: [
              { quantityOnHand: 2, quantityReserved: 0 },
              { quantityOnHand: 0, quantityReserved: 0 },
              { quantityOnHand: 1, quantityReserved: 0 },
            ],
          },
        ],
      }
      const out = (svc as any).formatProductDetail(input, 'de')
      expect(out.variants[0].stock).toBe(2)
      expect(out.variants[0].isInStock).toBe(true)
    })

    it('returns max across warehouses when stock is split unevenly (36 + 12 + 1)', () => {
      const input = {
        ...productBase,
        variants: [
          {
            ...variantBase,
            inventory: [
              { quantityOnHand: 36, quantityReserved: 0 },
              { quantityOnHand: 12, quantityReserved: 0 },
              { quantityOnHand: 1, quantityReserved: 0 },
            ],
          },
        ],
      }
      const out = (svc as any).formatProductDetail(input, 'de')
      expect(out.variants[0].stock).toBe(36)
      expect(out.variants[0].isInStock).toBe(true)
    })

    it('subtracts reservations per warehouse before taking the max', () => {
      // Marzahn has 10 on-hand but 9 reserved → only 1 available there.
      // Small warehouse has 3 on-hand, 0 reserved → 3 available there.
      // Max orderable in ONE order = 3 (the small warehouse).
      const input = {
        ...productBase,
        variants: [
          {
            ...variantBase,
            inventory: [
              { quantityOnHand: 10, quantityReserved: 9 },
              { quantityOnHand: 3, quantityReserved: 0 },
            ],
          },
        ],
      }
      const out = (svc as any).formatProductDetail(input, 'de')
      expect(out.variants[0].stock).toBe(3)
    })

    it('returns 0 when every warehouse is fully reserved', () => {
      const input = {
        ...productBase,
        variants: [
          {
            ...variantBase,
            inventory: [
              { quantityOnHand: 5, quantityReserved: 5 },
              { quantityOnHand: 3, quantityReserved: 3 },
            ],
          },
        ],
      }
      const out = (svc as any).formatProductDetail(input, 'de')
      expect(out.variants[0].stock).toBe(0)
      expect(out.variants[0].isInStock).toBe(false)
    })

    it('stays identical for a single-warehouse variant (no split to lose to)', () => {
      const input = {
        ...productBase,
        variants: [
          {
            ...variantBase,
            inventory: [{ quantityOnHand: 43, quantityReserved: 0 }],
          },
        ],
      }
      const out = (svc as any).formatProductDetail(input, 'de')
      expect(out.variants[0].stock).toBe(43)
    })

    it('returns 0 when a variant has no inventory rows at all', () => {
      const input = {
        ...productBase,
        variants: [{ ...variantBase, inventory: [] }],
      }
      const out = (svc as any).formatProductDetail(input, 'de')
      expect(out.variants[0].stock).toBe(0)
      expect(out.variants[0].isInStock).toBe(false)
    })
  })

  describe('formatProduct — totalStock (list view badges)', () => {
    const base = {
      id: 'p1',
      slug: 'x',
      brand: null,
      gender: null,
      basePrice: 10,
      salePrice: null,
      taxRate: 19,
      isFeatured: false,
      translations: [{ name: 'T' }],
      images: [],
      category: null,
      createdAt: new Date(),
    }

    it('sums max-per-warehouse across variants', () => {
      // V1: split 2+0+1  → max = 2
      // V2: split 3+2    → max = 3
      // V3: single 10    → max = 10
      // totalStock = 2 + 3 + 10 = 15  (vs. old sum-of-sums = 3+5+10 = 18)
      const input = {
        ...base,
        variants: [
          {
            inventory: [
              { quantityOnHand: 2, quantityReserved: 0 },
              { quantityOnHand: 0, quantityReserved: 0 },
              { quantityOnHand: 1, quantityReserved: 0 },
            ],
          },
          {
            inventory: [
              { quantityOnHand: 3, quantityReserved: 0 },
              { quantityOnHand: 2, quantityReserved: 0 },
            ],
          },
          {
            inventory: [{ quantityOnHand: 10, quantityReserved: 0 }],
          },
        ],
      }
      const out = (svc as any).formatProduct(input)
      expect(out.totalStock).toBe(15)
    })

    it('equals 0 when no variant has any available inventory', () => {
      const input = {
        ...base,
        variants: [
          { inventory: [{ quantityOnHand: 2, quantityReserved: 2 }] },
          { inventory: [] },
        ],
      }
      const out = (svc as any).formatProduct(input)
      expect(out.totalStock).toBe(0)
    })
  })
})
