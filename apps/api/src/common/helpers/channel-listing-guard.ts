/**
 * Guard: validates that a product can be published to a sales channel.
 *
 * Rule (per Phase-1 A3 decision): Malak's catalog is clothing + shoes.
 * Every product MUST have at least one ACTIVE variant before it can
 * be listed on any sales channel (shop, Facebook, TikTok, Google,
 * WhatsApp, eBay, …). Zero-variant publishing is forbidden.
 *
 * This helper is called from two places (defense-in-depth, Q1(c)):
 *   1. AdminController.updateProduct (HTTP-boundary, primary gate)
 *   2. AdminProductsService — if any internal code path ever writes
 *      a ChannelProductListing row (none do today, future-proof)
 *
 * Throws a BadRequestException with a 3-language structured message
 * matching the project convention (de/en/ar object), so the admin UI
 * can render it in the user's locale without additional lookup.
 */

import { BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

export async function validateCanPublishToChannel(
  prisma: PrismaService,
  productId: string,
): Promise<void> {
  const count = await prisma.productVariant.count({
    where: { productId, isActive: true },
  })
  if (count === 0) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'ProductHasNoActiveVariants',
      message: {
        de: 'Produkt muss mindestens eine aktive Variante haben bevor es auf einem Sales-Channel veröffentlicht werden kann.',
        en: 'Product must have at least one active variant before it can be published to a sales channel.',
        ar: 'يجب أن يحتوي المنتج على متغير واحد نشط على الأقل قبل نشره على قناة بيع.',
      },
      data: { productId, activeVariantCount: count },
    })
  }
}
