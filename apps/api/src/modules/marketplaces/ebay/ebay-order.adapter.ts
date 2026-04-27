/**
 * EbayOrderAdapter (C12.2).
 *
 * Implements the IOrderImporter contract from C9. Consumed by the
 * OrderImportFlow (also C9). The C12.6 glue-service drives:
 *
 *   1. flow.run(event) → adapter hooks fire here
 *   2. on FlowOutcome.status='imported': glue calls
 *      OrdersService.createFromMarketplace(draft, buyer)
 *   3. on success: store.markImported(importId, localOrderId, metadata)
 *
 * This adapter does NOT call OrdersService and does NOT mutate
 * MarketplaceOrderImport directly. Pure adapter responsibility:
 * translate raw eBay payload → MarketplaceOrderDraft + MarketplaceBuyer.
 *
 * Throws MappingError for any structural problem in the payload.
 * Does NOT throw InsufficientStockForMarketplaceOrderError — stock
 * verification happens later in C12.3 (createFromMarketplace).
 */

import { Injectable, Logger } from '@nestjs/common'
import type { IOrderImporter } from '../core/adapter.interfaces'
import type {
  MarketplaceImportEvent,
  MarketplaceBuyer,
  MarketplaceOrderDraft,
} from '../core/types'
import { MappingError } from '../core/errors'
import { PrismaService } from '../../../prisma/prisma.service'
import {
  parseEbayOrderPayload,
  isInternalRedirectAddress,
  splitFullName,
  splitDeAddress,
  buildSyntheticEmail,
  verifyMarketplaceAndCurrency,
  verifyTotalsMatch,
} from './ebay-order-mapping'

@Injectable()
export class EbayOrderAdapter implements IOrderImporter {
  private readonly logger = new Logger(EbayOrderAdapter.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cheap synchronous parse. The flow calls this BEFORE the
   * idempotency-gate, so it must not perform any I/O.
   */
  async extractExternalId(event: MarketplaceImportEvent): Promise<string> {
    const payload = parseEbayOrderPayload(event.rawEventPayload)
    return payload.orderId
  }

  /**
   * Translate eBay buyer + shipTo into our canonical MarketplaceBuyer.
   * eBay never exposes real buyer email (always proxy), so we always
   * synthesize. eBay also gives fullName as single string — we split.
   */
  async resolveBuyer(event: MarketplaceImportEvent): Promise<MarketplaceBuyer> {
    const payload = parseEbayOrderPayload(event.rawEventPayload)
    const externalBuyerRef = payload.buyer.username
    const shipTo =
      payload.fulfillmentStartInstructions[0]?.shippingStep?.shipTo
    const { firstName, lastName } = splitFullName(shipTo?.fullName)
    return {
      email: buildSyntheticEmail(externalBuyerRef),
      isSynthetic: true,
      externalBuyerRef,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      // EBAY_DE → 'de' hardcoded per Phase-2 Frage Q3.
      // eBay does not expose buyer.locale; assume German for German marketplace.
      locale: 'de',
    }
  }

  /**
   * Full mapping to MarketplaceOrderDraft. Order of operations:
   *   1. parse + structural validation
   *   2. internal-redirect-sentinel reject
   *   3. marketplace + currency enforce (DE/EUR)
   *   4. country reject (DE-only pre-launch)
   *   5. address split (3-stage hybrid; '' fallback + warn)
   *   6. SKU → variantId resolution (single Prisma query)
   *   7. line-item mapping
   *   8. totals verify (1-cent tolerance)
   *   9. compose draft
   */
  async mapToOrderDraft(
    event: MarketplaceImportEvent,
    buyer: MarketplaceBuyer,
  ): Promise<MarketplaceOrderDraft> {
    const payload = parseEbayOrderPayload(event.rawEventPayload)
    const shipTo =
      payload.fulfillmentStartInstructions[0].shippingStep.shipTo

    // Step 2 — sentinel reject
    if (isInternalRedirectAddress(shipTo.contactAddress.addressLine1)) {
      throw new MappingError(
        `addressLine1 is eBay internal redirect ('${shipTo.contactAddress.addressLine1.slice(0, 40)}') — manual review required`,
      )
    }

    // Steps 3 + 4 — marketplace/currency/country guards
    verifyMarketplaceAndCurrency(payload)
    if (shipTo.contactAddress.countryCode !== 'DE') {
      throw new MappingError(
        `countryCode='${shipTo.contactAddress.countryCode}' not supported (DE-only pre-launch)`,
      )
    }

    // Step 5 — address split
    const { street, houseNumber } = splitDeAddress(
      shipTo.contactAddress.addressLine1,
    )
    if (!houseNumber) {
      this.logger.warn(
        `splitDeAddress fallback — order=${payload.orderId} addressLine1='${shipTo.contactAddress.addressLine1}' — admin must fix label manually before shipment`,
      )
    }

    // Step 6 — SKU → variantId resolution. SKU is OPTIONAL in eBay
    // schema but we emit it on every C11-published listing, so for
    // OUR orders it's mandatory. Missing SKU → MappingError.
    const skus: string[] = []
    for (const li of payload.lineItems) {
      if (!li.sku) {
        throw new MappingError(
          `lineItem ${li.lineItemId} on order ${payload.orderId} has no SKU`,
        )
      }
      skus.push(li.sku)
    }
    const variants = await this.prisma.productVariant.findMany({
      where: { sku: { in: skus }, isActive: true },
      select: { id: true, sku: true },
    })
    const skuToId = new Map(variants.map((v) => [v.sku, v.id]))

    // Step 7 — line-item mapping
    const lines = payload.lineItems.map((li) => {
      const variantId = skuToId.get(li.sku!)
      if (!variantId) {
        throw new MappingError(
          `SKU '${li.sku}' on order ${payload.orderId} not found in product_variants (or inactive)`,
        )
      }
      // unitPriceGross = lineItemCost.value / quantity (eBay gives line total)
      const lineTotal = Number(li.lineItemCost.value)
      const unitPriceGross = (lineTotal / li.quantity).toFixed(2)
      return {
        variantId,
        externalSkuRef: li.sku!,
        externalListingId: li.legacyItemId,
        quantity: li.quantity,
        unitPriceGross,
        // Capture eBay's title as snapshot — preserves what the buyer
        // saw at purchase. Falls back to SKU if eBay omits title (rare).
        snapshotName: (li.title ?? '').trim() || li.sku!,
      }
    })

    // Step 8 — totals verify
    verifyTotalsMatch(payload)

    // Step 9 — compose draft. priceDiscount sign-convention is
    // unstable per Phase-B audit (gist sample showed negative);
    // Math.abs() defensively. eBay has no order-level coupon code
    // — line-level promotions go to notes.
    const discount = payload.pricingSummary.priceDiscount
      ? Math.abs(Number(payload.pricingSummary.priceDiscount.value))
      : 0

    return {
      lines,
      shippingAddress: {
        firstName: buyer.firstName ?? '',
        lastName: buyer.lastName ?? '',
        street,
        houseNumber,
        addressLine2: shipTo.contactAddress.addressLine2,
        postalCode: shipTo.contactAddress.postalCode,
        city: shipTo.contactAddress.city,
        country: shipTo.contactAddress.countryCode,
      },
      subtotalGross: payload.pricingSummary.priceSubtotal.value,
      shippingCostGross: payload.pricingSummary.deliveryCost.value,
      totalGross: payload.pricingSummary.total.value,
      currency: 'EUR',
      notes: discount > 0 ? `eBay applied discount: €${discount.toFixed(2)}` : undefined,
    }
  }
}
