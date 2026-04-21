/**
 * Guard test — validateCanPublishToChannel (C4).
 *
 * Covers the 3-language error + the no-op-on-success path.
 */

import { BadRequestException } from '@nestjs/common'
import { validateCanPublishToChannel } from '../channel-listing-guard'

function mockPrisma(activeVariantCount: number) {
  return {
    productVariant: {
      count: jest.fn(async () => activeVariantCount),
    },
  } as any
}

describe('validateCanPublishToChannel', () => {
  it('resolves silently when product has >= 1 active variant', async () => {
    await expect(
      validateCanPublishToChannel(mockPrisma(1), 'p1'),
    ).resolves.toBeUndefined()
  })

  it('resolves silently for multi-variant products', async () => {
    await expect(
      validateCanPublishToChannel(mockPrisma(18), 'p1'),
    ).resolves.toBeUndefined()
  })

  it('throws BadRequestException with 3-language message when 0 variants', async () => {
    try {
      await validateCanPublishToChannel(mockPrisma(0), 'p-empty')
      throw new Error('expected throw')
    } catch (err: any) {
      expect(err).toBeInstanceOf(BadRequestException)
      const res = err.getResponse()
      expect(res.error).toBe('ProductHasNoActiveVariants')
      expect(res.statusCode).toBe(400)
      // 3-language message
      expect(res.message.de).toMatch(/aktive Variante/i)
      expect(res.message.en).toMatch(/active variant/i)
      expect(res.message.ar).toMatch(/متغير/) // Arabic "variant"
      // Context data
      expect(res.data).toEqual({ productId: 'p-empty', activeVariantCount: 0 })
    }
  })

  it('filters by isActive (inactive variants do not count)', async () => {
    // Helper delegates the filter to prisma.count — just verify the
    // call arguments so we know the query uses isActive: true.
    const prisma = mockPrisma(0)
    await expect(
      validateCanPublishToChannel(prisma, 'p1'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.productVariant.count).toHaveBeenCalledWith({
      where: { productId: 'p1', isActive: true },
    })
  })
})
