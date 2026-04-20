/**
 * Unit tests for checkBarcodeUniqueness — the shared pre-write gate that
 * catches EAN/barcode collisions BEFORE they trip Prisma's @unique P2002
 * and give the admin a cryptic 500.
 *
 * Bug B7 from the 2026-04-20 audit: barcode collisions raised bare
 * PrismaClientKnownRequestError at write time. Now: collision is
 * detected pre-write and translated into a 400 BadRequest with the
 * conflicting product's name, so the admin sees a clear UX message.
 */

import { checkBarcodeUniqueness } from '../barcode-uniqueness'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJest = jest.Mock<any, any>

function buildClient(findFirstImpl: (args: any) => Promise<any>) {
  return {
    productVariant: {
      findFirst: jest.fn().mockImplementation(findFirstImpl) as AnyJest,
    },
  }
}

describe('checkBarcodeUniqueness (Gruppe 2, B7)', () => {
  it('#1 null/undefined barcode → { ok: true } no DB call', async () => {
    const client = buildClient(async () => {
      throw new Error('should not be called for null barcode')
    })
    expect(await checkBarcodeUniqueness(client as any, null)).toEqual({ ok: true })
    expect(await checkBarcodeUniqueness(client as any, undefined)).toEqual({ ok: true })
    expect(client.productVariant.findFirst).not.toHaveBeenCalled()
  })

  it('#2 empty / whitespace barcode → { ok: true } no DB call', async () => {
    const client = buildClient(async () => { throw new Error('should not call') })
    expect(await checkBarcodeUniqueness(client as any, '')).toEqual({ ok: true })
    expect(await checkBarcodeUniqueness(client as any, '   ')).toEqual({ ok: true })
    expect(client.productVariant.findFirst).not.toHaveBeenCalled()
  })

  it('#3 no existing variant with that barcode → { ok: true }', async () => {
    const client = buildClient(async () => null)
    const result = await checkBarcodeUniqueness(client as any, '4006381333931')
    expect(result.ok).toBe(true)
    expect(client.productVariant.findFirst).toHaveBeenCalledTimes(1)
  })

  it('#4 collision found → { ok: false } with product name from DE translation', async () => {
    const client = buildClient(async () => ({
      id: 'v-conflict',
      sku: 'MAL-050-ROT-M',
      product: {
        translations: [
          { language: 'de', name: 'Shirt Rot' },
          { language: 'en', name: 'Shirt Red' },
          { language: 'ar', name: 'قميص أحمر' },
        ],
      },
    }))
    const result = await checkBarcodeUniqueness(client as any, '4006381333931')
    expect(result.ok).toBe(false)
    expect(result.conflictVariantId).toBe('v-conflict')
    expect(result.conflictSku).toBe('MAL-050-ROT-M')
    expect(result.conflictProductName).toBe('Shirt Rot')  // prefers DE
  })

  it('#5 collision with no DE translation → falls back to first available', async () => {
    const client = buildClient(async () => ({
      id: 'v-conflict',
      sku: 'MAL-050-ROT-M',
      product: {
        translations: [
          { language: 'en', name: 'Shirt Red' },
          { language: 'ar', name: 'قميص أحمر' },
        ],
      },
    }))
    const result = await checkBarcodeUniqueness(client as any, '4006381333931')
    expect(result.ok).toBe(false)
    expect(result.conflictProductName).toBe('Shirt Red')
  })

  it('#6 excludeVariantId skips the variant being updated (no-op edits OK)', async () => {
    // An update that keeps the same barcode must not reject itself.
    // The helper passes NOT: { id: excludeVariantId } to findFirst so
    // the current row is invisible to the lookup.
    const client = buildClient(async (args: any) => {
      // Assert the exclusion was actually passed through
      expect(args.where.NOT).toEqual({ id: 'v-current' })
      return null  // no OTHER variant has this barcode
    })
    const result = await checkBarcodeUniqueness(client as any, '4006381333931', 'v-current')
    expect(result.ok).toBe(true)
  })

  it('#7 trims whitespace before comparing', async () => {
    // Admin pastes a barcode with trailing whitespace — we should still
    // catch a collision on the trimmed value.
    const client = buildClient(async (args: any) => {
      // The helper must query on the trimmed value, not the raw input
      expect(args.where.barcode).toBe('4006381333931')
      return null
    })
    const result = await checkBarcodeUniqueness(client as any, '  4006381333931  ')
    expect(result.ok).toBe(true)
    expect(client.productVariant.findFirst).toHaveBeenCalledTimes(1)
  })
})
