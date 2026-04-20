import {
  Injectable,
  Logger,
  ConflictException,
  BadRequestException,
  Inject,
} from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { randomUUID } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { IdempotencyService } from './idempotency.service'
import { ShippingCalculator, SHIPPING_CALCULATOR } from './shipping/shipping-calculator.interface'
import { CreateOrderDto } from './dto/create-order.dto'
import { UpdateOrderStatusDto } from './dto/update-order-status.dto'
import { QueryOrdersDto } from './dto/query-orders.dto'
import {
  ORDER_EVENTS,
  OrderCreatedEvent,
  OrderConfirmedEvent,
  OrderCancelledEvent,
  OrderStatusChangedEvent,
} from './events/order.events'
import { OrderNotFoundException } from './exceptions/order-not-found.exception'
import { InvalidOrderStateException } from './exceptions/invalid-order-state.exception'
import { DuplicateOrderException } from './exceptions/duplicate-order.exception'
import { AdminMarketingService } from '../admin/services/admin-marketing.service'

// ── Zustandsmaschine ──────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending:         ['pending_payment', 'confirmed', 'cancelled'],
  pending_payment: ['confirmed', 'cancelled'],
  confirmed:       ['processing', 'cancelled', 'disputed'],
  processing:      ['shipped', 'cancelled', 'disputed'],
  shipped:         ['delivered', 'disputed'],
  delivered:       ['returned', 'refunded', 'disputed'],
  cancelled:       [],
  returned:        ['refunded'],
  refunded:        [],
  disputed:        ['refunded', 'confirmed'], // resolved dispute can return to confirmed
}

// ── Cursor Helper ─────────────────────────────────────────────

interface CursorPayload { id: string; createdAt: string }

function encodeCursor(id: string, createdAt: Date): string {
  return Buffer.from(JSON.stringify({ id, createdAt: createdAt.toISOString() })).toString('base64')
}

function decodeCursor(cursor: string): CursorPayload {
  return JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'))
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly idempotencyService: IdempotencyService,
    @Inject(SHIPPING_CALCULATOR)
    private readonly shippingCalculator: ShippingCalculator,
    // Single source of truth for coupon validation. OrdersModule → AdminModule
    // is already a one-way import (AdminModule does NOT import OrdersModule),
    // so no forwardRef needed. Re-using the shared validateCoupon prevents
    // the divergence that caused the 18.04 incident (silent drop because the
    // order-create's own weak validation missed onePerCustomer + startAt).
    private readonly marketingService: AdminMarketingService,
  ) {}

  // ── REUSE: find an existing pending order for the same cart ──
  //
  // Why this exists: when a customer clicks "Bestellen" with payment method A,
  // gets redirected to the gateway, comes back, and tries again with method B,
  // we should NOT create a second order. We reuse the existing pending one and
  // let payments.service swap the payment intent in place. Otherwise:
  //   - duplicate orders show up in the admin
  //   - stock is reserved twice (silently!)
  //   - customer's account is cluttered with abandoned orders
  //
  // STRICT match: only reuse if EVERYTHING matches — items, address, coupon,
  // user, freshness. Anything different = new order (correct behaviour).
  // Any payment that's already authorized/captured = treat as final, never reuse.
  private readonly REUSE_WINDOW_MINUTES = 15

  private async findReusableOrder(
    dto: CreateOrderDto,
    userId: string | null,
  ): Promise<{ id: string; orderNumber: string } | null> {
    // No identity → cannot match (anonymous orders without guest email are rare)
    const guestEmail = dto.guestEmail?.toLowerCase()
    if (!userId && !guestEmail) return null

    const cutoff = new Date()
    cutoff.setMinutes(cutoff.getMinutes() - this.REUSE_WINDOW_MINUTES)

    // Identity resolution for reuse lookup.
    //
    // Since 14.04.2026 Bug-Hunt 2B, guest checkouts create a stub user and
    // store the order with userId=<stub> + guestEmail=NULL. Matching purely
    // by guestEmail therefore misses all post-2B guest orders. We look up
    // the stub user by email and match EITHER the legacy guestEmail field
    // OR the stub user's ID, so both pre-2B and post-2B guest orders reuse
    // correctly. Real users (passwordHash set) are not treated as stubs —
    // a logged-out checkout with a real user's email is kept separate from
    // that user's authenticated orders for safety.
    let identityWhere: any
    if (userId) {
      identityWhere = { userId }
    } else if (guestEmail) {
      const stubUser = await this.prisma.user.findUnique({
        where: { email: guestEmail },
        select: { id: true, passwordHash: true },
      })
      if (stubUser && !stubUser.passwordHash) {
        identityWhere = { OR: [{ guestEmail }, { userId: stubUser.id }] }
      } else {
        identityWhere = { guestEmail }
      }
    } else {
      return null
    }

    const candidates = await this.prisma.order.findMany({
      where: {
        deletedAt: null,
        status: { in: ['pending', 'pending_payment'] },
        createdAt: { gte: cutoff },
        ...identityWhere,
      },
      include: {
        items: { select: { variantId: true, quantity: true } },
        payment: { select: { status: true } },
        shippingAddress: {
          select: {
            firstName: true, lastName: true, street: true, houseNumber: true,
            postalCode: true, city: true, country: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5, // Defensive cap — should be 1 in practice
    })

    if (candidates.length === 0) return null

    // ── Build a normalized fingerprint for the incoming cart ──
    const incomingItems = [...dto.items]
      .map((i) => `${i.variantId}:${i.quantity}`)
      .sort()
      .join('|')
    const incomingCoupon = dto.couponCode ?? null
    const incomingAddrId = dto.shippingAddressId ?? null
    const incomingAddrFields = dto.shippingAddress
      ? [
          dto.shippingAddress.firstName, dto.shippingAddress.lastName,
          dto.shippingAddress.street, dto.shippingAddress.houseNumber,
          dto.shippingAddress.postalCode, dto.shippingAddress.city,
          dto.shippingAddress.country,
        ].join('|')
      : null

    for (const order of candidates) {
      // Skip if payment already authorized/captured — money is in flight, hands off
      if (order.payment && ['authorized', 'captured'].includes(order.payment.status)) {
        continue
      }

      // Items must match exactly (count + ids + quantities)
      const orderItems = order.items
        .filter((i) => i.variantId)
        .map((i) => `${i.variantId}:${i.quantity}`)
        .sort()
        .join('|')
      if (orderItems !== incomingItems) continue

      // Coupon must match
      if ((order.couponCode ?? null) !== incomingCoupon) continue

      // Address must match (either same saved-address id, or same inline fields)
      if (incomingAddrId) {
        if (order.shippingAddressId !== incomingAddrId) continue
      } else if (incomingAddrFields) {
        const a = order.shippingAddress
        if (!a) continue
        const orderAddrFields = [
          a.firstName, a.lastName, a.street, a.houseNumber,
          a.postalCode, a.city, a.country,
        ].join('|')
        if (orderAddrFields !== incomingAddrFields) continue
      } else {
        // Incoming has neither id nor inline → skip reuse to be safe
        continue
      }

      this.logger.log(
        `[reuse] Reusing pending order ${order.orderNumber} (id=${order.id.slice(0, 8)}) for ${userId ?? guestEmail}`,
      )
      return { id: order.id, orderNumber: order.orderNumber }
    }

    return null
  }

  // ── CREATE ────────────────────────────────────────────────────

  async create(
    dto: CreateOrderDto,
    userId: string | null,
    correlationId: string,
    idempotencyKey?: string,
  ) {
    const endpoint = 'POST:/orders'
    const requestHash = this.idempotencyService.hashBody({ ...dto, userId })

    // 1. Idempotency-Check (highest priority — exact retry)
    if (idempotencyKey) {
      const cached = await this.idempotencyService.get(idempotencyKey, endpoint, requestHash)
      if (cached) {
        if (cached.statusCode === 102) {
          throw new ConflictException('Diese Bestellung wird gerade verarbeitet')
        }
        throw new DuplicateOrderException(idempotencyKey)
      }
      await this.idempotencyService.reserve(idempotencyKey, endpoint, requestHash, userId ?? undefined)
    }

    // 1a. Hard guard: orders MUST have a shipping address. The DTO marks both
    //     shippingAddressId and shippingAddress as optional, so the validator
    //     does not catch this — a direct API call with neither field would
    //     silently create an order with no billing info, producing garbage
    //     invoices and broken DHL labels. 32 historical testdata invoices
    //     already had this problem; this defensive check stops the next one.
    if (!dto.shippingAddressId && !dto.shippingAddress) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'ShippingAddressRequired',
        message: {
          de: 'Eine Lieferadresse ist erforderlich.',
          en: 'A shipping address is required.',
          ar: 'عنوان التوصيل مطلوب.',
        },
      })
    }

    // 1a-bis. Hard guard: guest checkouts MUST provide an email.
    //     Background: on 14.04.2026 a customer retried Stripe 5 times in
    //     90 seconds because the frontend checkout-store was not persisted
    //     across browser inactivity and dropped guestEmail back to ''. The
    //     frontend then silently omitted the guestEmail field from the
    //     POST, and the backend happily created 5 fully anonymous orders
    //     (userId=null + guestEmail=null). Every retry hit Stripe with
    //     receipt_email:'' which is "Invalid email address". We now refuse
    //     the order at the gate so the frontend is forced to surface the
    //     missing-email state to the user.
    const trimmedGuestEmail = dto.guestEmail?.trim()
    if (!userId && !trimmedGuestEmail) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'GuestEmailRequired',
        message: {
          de: 'Eine E-Mail-Adresse ist für den Gast-Checkout erforderlich.',
          en: 'An email address is required for guest checkout.',
          ar: 'البريد الإلكتروني مطلوب للشراء كزائر.',
        },
      })
    }

    // 1b. Reuse-Check: same cart, same address, same user, fresh pending order?
    //     Returns the EXISTING order so the caller can issue a new payment intent
    //     against it instead of creating a duplicate.
    try {
      const reusable = await this.findReusableOrder(dto, userId)
      if (reusable) {
        // Cache the idempotency key to the existing order so the next retry sees it too
        if (idempotencyKey) {
          const fullOrder = await this.prisma.order.findUnique({
            where: { id: reusable.id },
            include: { items: true },
          })
          if (fullOrder) {
            await this.idempotencyService.save(idempotencyKey, endpoint, requestHash, fullOrder, 200, userId ?? undefined)
            return fullOrder
          }
        }
        const fullOrder = await this.prisma.order.findUnique({
          where: { id: reusable.id },
          include: { items: true },
        })
        if (fullOrder) return fullOrder
      }
    } catch (reuseErr: any) {
      // Reuse failures must NEVER block order creation. Log and fall through.
      this.logger.warn(`[${correlationId}] Reuse check failed (falling back to new order): ${reuseErr?.message ?? reuseErr}`)
    }

    try {
      // 2. Auto-resolve warehouse: pick the warehouse that has AVAILABLE stock
      const defaultWarehouse = await this.prisma.warehouse.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } })
      const defaultWarehouseId = defaultWarehouse?.id
      for (const item of dto.items) {
        if (!item.warehouseId) {
          // Find ALL active warehouses with inventory for this variant
          const inventories = await this.prisma.inventory.findMany({
            where: {
              variantId: item.variantId,
              warehouse: { isActive: true },
            },
            include: { warehouse: { select: { isDefault: true } } },
          })

          // Calculate available stock per warehouse and pick the best one
          let bestWarehouseId: string | null = null
          let bestAvailable = 0
          let bestIsDefault = false

          for (const inv of inventories) {
            const available = inv.quantityOnHand - inv.quantityReserved
            if (available >= item.quantity) {
              // Prefer: 1) has enough stock, 2) is default warehouse, 3) highest available
              if (!bestWarehouseId || (inv.warehouse.isDefault && !bestIsDefault) || (!bestIsDefault && available > bestAvailable)) {
                bestWarehouseId = inv.warehouseId
                bestAvailable = available
                bestIsDefault = inv.warehouse.isDefault
              }
            }
          }

          if (bestWarehouseId) {
            item.warehouseId = bestWarehouseId
          } else {
            // No warehouse has enough stock — use default (stock check in step 3 will reject the order)
            item.warehouseId = defaultWarehouseId ?? ''
          }
        }
      }

      // 3. STOCK CHECK — Block overselling BEFORE creating order.
      //
      // R3 Gap 1: MAX-per-warehouse semantics, NOT SUM-over-all.
      //
      // The stock-check must agree with the Auto-Resolve logic above: reserve()
      // runs against ONE warehouse, so a split stock of 5+5 cannot fulfill a
      // single line of qty=6 — the Auto-Resolve would find no warehouse and
      // leave item.warehouseId pointing at the default with insufficient stock,
      // causing a cryptic downstream 409 inside the reserve() transaction.
      //
      // Summing quantityOnHand across warehouses (the old behaviour) passed the
      // check (sum=10>=6) and let the order proceed — only to explode later.
      // Switching to max-per-warehouse agrees with what reserve() can actually
      // do and surfaces the error right here with a clean structured message.
      //
      // R3 Gap 2: structured 3-language error with machine-readable payload.
      //   error   : 'InsufficientStockInAnyWarehouse'
      //   message : { de, en, ar }   — frontend picks admin/customer locale
      //   data    : { variantId, sku, requested, maxAvailable }
      //
      // We deliberately do NOT leak per-warehouse availability to the client —
      // that would invite brute-force availability scanning across locations.
      // Only the single largest available figure is returned, which matches
      // "how many could a customer still buy without changing the cart".
      const locale = dto.locale ?? 'de'
      for (const item of dto.items) {
        const inventories = await this.prisma.inventory.findMany({
          where: { variantId: item.variantId, warehouse: { isActive: true } },
          select: { quantityOnHand: true, quantityReserved: true },
        })
        let maxAvailable = 0
        for (const inv of inventories) {
          const avail = inv.quantityOnHand - inv.quantityReserved
          if (avail > maxAvailable) maxAvailable = avail
        }

        if (maxAvailable < item.quantity) {
          const variant = await this.prisma.productVariant.findUnique({
            where: { id: item.variantId },
            select: {
              sku: true,
              color: true,
              size: true,
              product: { select: { translations: { select: { language: true, name: true } } } },
            },
          })
          const translations = variant?.product?.translations ?? []
          const nameDe = translations.find((t: any) => t.language === 'de')?.name ?? variant?.sku ?? ''
          const nameEn = translations.find((t: any) => t.language === 'en')?.name ?? nameDe
          const nameAr = translations.find((t: any) => t.language === 'ar')?.name ?? nameDe
          const detail = [variant?.color, variant?.size].filter(Boolean).join(' / ')

          const outOfStock = maxAvailable <= 0
          throw new ConflictException({
            statusCode: 409,
            error: 'InsufficientStockInAnyWarehouse',
            message: {
              de: outOfStock
                ? `"${nameDe}" (${detail}) ist leider nicht mehr verfügbar.`
                : `Nur noch ${maxAvailable} Stück von "${nameDe}" (${detail}) aus einem Lager verfügbar — bitte Menge reduzieren.`,
              en: outOfStock
                ? `Sorry, "${nameEn}" (${detail}) is currently out of stock.`
                : `Only ${maxAvailable} piece(s) of "${nameEn}" (${detail}) available from a single warehouse — please reduce quantity.`,
              ar: outOfStock
                ? `عذراً، "${nameAr}" (${detail}) غير متوفر حالياً.`
                : `يتوفر فقط ${maxAvailable} قطعة من "${nameAr}" (${detail}) من مستودع واحد — يرجى تقليل الكمية.`,
            },
            data: {
              variantId: item.variantId,
              sku: variant?.sku ?? null,
              requested: item.quantity,
              maxAvailable,
              locale,
            },
          })
        }
      }

      // 4. Varianten validieren + Preise snapshot-en
      const variantIds = dto.items.map((i) => i.variantId)
      const variants = await this.prisma.productVariant.findMany({
        where: { id: { in: variantIds }, isActive: true },
        include: {
          product: { select: { basePrice: true, salePrice: true, taxRate: true, translations: { where: { language: 'de' as any }, take: 1 } } },
        },
      })

      if (variants.length !== variantIds.length) {
        throw new BadRequestException('Eine oder mehrere Varianten nicht gefunden oder inaktiv')
      }

      const variantMap = new Map(variants.map((v) => [v.id, v]))

      // 3. Gesamtgewicht berechnen
      const totalWeightGrams = dto.items.reduce((sum, item) => {
        const v = variantMap.get(item.variantId)!
        return sum + (v.weightGrams ?? 0) * item.quantity
      }, 0)

      // 4. Subtotal + Steuern berechnen
      // WICHTIG: Alle Preise sind BRUTTO (inkl. MwSt) — deutsches Recht.
      // MwSt wird aus dem Bruttopreis HERAUSGERECHNET, nicht draufaddiert.
      // Formel: MwSt = Brutto - (Brutto / (1 + Steuersatz/100))
      let subtotal = 0
      let taxAmount = 0

      const itemData = dto.items.map((item) => {
        const v = variantMap.get(item.variantId)!
        const unitPrice = Number(v.product.salePrice ?? v.product.basePrice) + Number(v.priceModifier)
        const taxRate = Number(v.product.taxRate)
        const itemTotal = unitPrice * item.quantity
        // MwSt aus Brutto RAUSRECHNEN (nicht draufaddieren!)
        const itemNet = itemTotal / (1 + taxRate / 100)
        const itemTax = itemTotal - itemNet

        subtotal += itemTotal
        taxAmount += itemTax

        return {
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice,
          taxRate,
          totalPrice: itemTotal,
          snapshotName: v.product.translations[0]?.name ?? v.sku,
          snapshotSku: v.sku,
        }
      })

      // 5. Versandkosten berechnen
      const countryCode = await this.resolveCountryCode(dto, userId)
      const shipping = await this.shippingCalculator.calculate({
        countryCode,
        weightGrams: totalWeightGrams,
        subtotal,
      })

      // 6. Coupon validieren + Rabatt berechnen
      //
      // Delegates to the shared AdminMarketingService.validateCoupon() so this
      // code path enforces the exact same rules as the public /coupons/validate
      // endpoint: onePerCustomer, startAt, expiresAt, maxUsage, email-abuse,
      // minOrder. The previous in-line check missed onePerCustomer + startAt
      // entirely and fell through silently on any rejection — letting a user
      // submit an invalid-coupon order with discountAmount=0 and no error
      // feedback. That was the 18.04 ORD-20260418-000001 bug.
      //
      // Now: any rejection throws a structured 400 CouponRejected with the
      // reasonCode + 3-lang message. Frontend can branch on the code.
      let discountAmount = 0
      let validatedCouponCode: string | undefined

      if (dto.couponCode) {
        const result = await this.marketingService.validateCoupon(dto.couponCode, {
          userId: userId ?? undefined,
          email: userId ? undefined : dto.guestEmail ?? undefined,
          subtotal,
        })

        if (!result.valid) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'CouponRejected',
            reasonCode: result.reasonCode,
            message: result.reason,
            data: {
              couponCode: dto.couponCode,
              reasonCode: result.reasonCode,
            },
          })
        }

        // Apply discount from the validated coupon.
        const c = result.coupon
        if (c.type === 'percentage' && c.discountPercent != null) {
          discountAmount = subtotal * (c.discountPercent / 100)
        } else if (c.type === 'fixed_amount' && c.discountAmount != null) {
          discountAmount = Math.min(c.discountAmount, subtotal)
        }
        if (c.freeShipping) {
          shipping.cost = 0
        }
        validatedCouponCode = c.code
      }

      // Versandkosten-MwSt ebenfalls rausrechnen (Versand ist auch brutto in DE)
      const shippingTax = shipping.cost - (shipping.cost / 1.19)
      taxAmount += shippingTax

      // Rabatt reduziert auch die enthaltene MwSt (Rabatt ist brutto)
      if (discountAmount > 0) {
        const discountTax = discountAmount - (discountAmount / 1.19)
        taxAmount -= discountTax
      }

      // Gesamtbetrag = Brutto-Subtotal + Brutto-Versand - Rabatt
      // MwSt ist BEREITS enthalten, wird NICHT extra addiert!
      const totalAmount = subtotal + shipping.cost - discountAmount

      // Auf 2 Dezimalstellen runden (Cent-genau)
      taxAmount = Math.round(taxAmount * 100) / 100

      // 7. Bestellnummer generieren (atomic counter)
      const orderNumber = await this.generateOrderNumber()

      // 8. Auto-create guest customer if no userId
      //
      // Real customer name comes from the shipping address form (which is
      // mandatory). dto.guestFirstName is almost never sent by the frontend,
      // so using it as the primary source left stub users with empty names —
      // then status emails greeted customers with "Hallo ". Fallback chain:
      //   1. explicit dto.guestFirstName (legacy API callers)
      //   2. shipping address firstName (the actual customer)
      //   3. email local-part (last resort, e.g. "john@mail.de" → "john")
      let resolvedUserId = userId
      if (!resolvedUserId && dto.guestEmail) {
        const addrFirst = dto.shippingAddress?.firstName?.trim()
        const addrLast = dto.shippingAddress?.lastName?.trim()
        const emailLocal = dto.guestEmail.split('@')[0] ?? ''
        const firstName = dto.guestFirstName?.trim() || addrFirst || emailLocal || 'Gast'
        const lastName = dto.guestLastName?.trim() || addrLast || ''

        const existing = await this.prisma.user.findUnique({
          where: { email: dto.guestEmail.toLowerCase() },
        })
        if (existing) {
          resolvedUserId = existing.id
          // Backfill: if the existing stub has empty/weaker names but this
          // checkout has fresh address data, update it. Don't touch REAL
          // users (passwordHash set) — their name is their canonical choice.
          //
          // Also backfill preferredLang: stub users' preferredLang is
          // frozen from their very first checkout. A stub who first
          // bought in German and then switches to Arabic needs to get
          // Arabic emails for every new order. Real users are never
          // touched — their profile language is their explicit choice.
          // See 14.04.2026 bug where a customer ordered in Arabic but
          // got 19 German emails because of this freeze.
          if (!existing.passwordHash) {
            const update: any = {}
            const weakName =
              addrFirst && addrLast && (
                !existing.firstName?.trim() ||
                !existing.lastName?.trim() ||
                existing.firstName.length < 2
              )
            if (weakName) {
              update.firstName = addrFirst
              update.lastName = addrLast
            }
            if (dto.locale && existing.preferredLang !== dto.locale) {
              update.preferredLang = dto.locale as any
            }
            if (Object.keys(update).length > 0) {
              await this.prisma.user.update({
                where: { id: existing.id },
                data: update,
              })
              this.logger.log(
                `[${correlationId}] Stub user ${existing.email} backfilled: ${Object.keys(update).join(', ')}`,
              )
            }
          }
        } else {
          const guest = await this.prisma.user.create({
            data: {
              email: dto.guestEmail.toLowerCase(),
              firstName,
              lastName,
              role: 'customer',
              preferredLang: (dto.locale ?? 'de') as any,
              isActive: true,
              isVerified: false,
              // No passwordHash = guest account (can claim later via "Konto erstellen")
            },
          })
          resolvedUserId = guest.id
          this.logger.log(`[${correlationId}] Guest customer created: ${guest.email} → ${guest.id} (name=${firstName} ${lastName})`)
        }
      }

      // 9. Shipping-Adresse verarbeiten (3 Fälle)
      let resolvedShippingAddressId = dto.shippingAddressId ?? null
      let shippingAddressSnapshot: any = null

      if (!resolvedShippingAddressId && dto.shippingAddress) {
        const a = dto.shippingAddress
        if (resolvedUserId) {
          // Fall B: Eingeloggter User mit neuer Adresse → in DB speichern + verknüpfen
          const newAddr = await this.prisma.address.create({
            data: {
              userId: resolvedUserId,
              firstName: a.firstName,
              lastName: a.lastName,
              street: a.street,
              houseNumber: a.houseNumber,
              addressLine2: a.addressLine2 ?? null,
              postalCode: a.postalCode,
              city: a.city,
              country: a.country,
              company: a.company ?? null,
            },
          })
          resolvedShippingAddressId = newAddr.id
          this.logger.log(`[${correlationId}] Neue Adresse ${newAddr.id} für User ${resolvedUserId} angelegt`)
        } else {
          // Fall C: Gast → Adresse als JSON-Snapshot in der Order
          shippingAddressSnapshot = {
            firstName: a.firstName,
            lastName: a.lastName,
            street: a.street,
            houseNumber: a.houseNumber,
            addressLine2: a.addressLine2 ?? null,
            postalCode: a.postalCode,
            city: a.city,
            country: a.country,
            company: a.company ?? null,
          }
        }
      }

      // 10. Bestellung + Items anlegen
      const reservationSessionId = randomUUID()

      const order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            orderNumber,
            userId: resolvedUserId,
            guestEmail: !resolvedUserId ? dto.guestEmail : undefined,
            shippingAddressId: resolvedShippingAddressId,
            shippingAddressSnapshot,
            status: 'pending',
            channel: (dto.channel ?? 'website') as any,
            subtotal,
            shippingCost: shipping.cost,
            taxAmount,
            discountAmount,
            totalAmount,
            shippingZone: shipping.zoneName,
            couponCode: validatedCouponCode,
            fulfillmentWarehouseId: dto.items[0]?.warehouseId ?? defaultWarehouse?.id ?? null,
            notes: JSON.stringify({
              ...(dto.notes ? { text: dto.notes } : {}),
              ...(dto.guestFirstName ? { guestFirstName: dto.guestFirstName } : {}),
              ...(dto.guestLastName ? { guestLastName: dto.guestLastName } : {}),
              ...(dto.locale ? { locale: dto.locale } : {}),
            }) || null,
            items: {
              create: itemData,
            },
          },
          include: { items: true },
        })

        // Audit-Trail: initialer Status
        await tx.orderStatusHistory.create({
          data: {
            orderId: created.id,
            fromStatus: null,
            toStatus: 'pending',
            source: 'system',
            notes: `Bestellung ${orderNumber} erstellt`,
            createdBy: userId ?? 'guest',
          },
        })

        // ── Bestandsprüfung INNERHALB der Transaktion ──
        // Prüft ob genug Bestand im zugewiesenen Lager vorhanden ist.
        // Die eigentliche Reservierung (quantityReserved increment + StockReservation Record)
        // erfolgt über den Event Listener (inventory.listener.ts → reservationService.reserve())
        // der nach dem Commit dieser Transaktion ausgelöst wird.
        // WICHTIG: Hier NICHT reservieren — das würde eine doppelte Reservierung verursachen.
        for (const item of dto.items) {
          const inv = await tx.inventory.findFirst({
            where: { variantId: item.variantId, warehouseId: item.warehouseId },
          })
          if (!inv) {
            throw new ConflictException('Kein Lagerbestand im zugewiesenen Lager gefunden')
          }
          const avail = inv.quantityOnHand - inv.quantityReserved
          if (avail < item.quantity) {
            throw new ConflictException('Nicht genügend Bestand verfügbar')
          }
        }

        // Coupon-Verwendung erfassen.
        //
        // Populate BOTH userId and email (when available) so the abuse-guards
        // in validateCoupon() can actually match on future redemption
        // attempts. Previously only couponId + orderId were passed, leaving
        // userId=NULL and email=NULL — which meant the onePerCustomer
        // findFirst(WHERE couponId AND (userId=X OR email=X)) could never
        // return a row → onePerCustomer was effectively disabled for every
        // coupon. That was the ORD-20260418-000001 incident's root cause.
        if (validatedCouponCode) {
          const coupon = await tx.coupon.findFirst({ where: { code: validatedCouponCode } })
          if (coupon) {
            await tx.couponUsage.create({
              data: {
                couponId: coupon.id,
                orderId: created.id,
                userId: userId ?? null,
                // Populate email whenever guestEmail is present (even when a
                // stub-user was created upstream and userId is therefore set).
                // validateCoupon's OR-lookup on (userId, email) needs BOTH
                // keys written so onePerCustomer + email-abuse guards match
                // future redemptions regardless of which stub-user id the
                // system resolves for the same guest email.
                email: dto.guestEmail?.toLowerCase().trim() ?? null,
              },
            })
            await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } })
          }
        }

        return created
      })

      this.logger.log(
        `[${correlationId}] Bestellung erstellt: ${orderNumber} | total=€${totalAmount.toFixed(2)} | userId=${userId ?? 'guest'}`,
      )

      // 9. Inventory-Event emitieren (async — Listener reserviert Bestand)
      try {
        // emitAsync waits for the listener to finish. By the time this
        // returns, any successful reservations are already committed in
        // the DB. Failure cases throw and land in the catch block below.
        //
        // We USED to trust the listener's return value that emitAsync
        // collects and flatten it into an array of IDs. That does not
        // actually work in @nestjs/event-emitter 3.x with
        // `@OnEvent(..., { async: true })` — the return value of an
        // async-decorated listener is not propagated back to the caller,
        // so `flatIds` was always [] and `notes.reservationIds` was
        // never written. Consequence: `payments.service.handlePaymentSuccess`
        // read `reservationIds ?? []` → empty → never emitted
        // `ORDER_EVENTS.CONFIRMED` → `reservation.confirm()` never ran →
        // StockReservation rows stayed `RESERVED` forever and only the
        // expiry cron eventually cleaned them up, WITHOUT decrementing
        // `quantityOnHand`. See incident 15.04.2026.
        //
        // The robust fix: query the DB directly for RESERVED rows tied
        // to this order. It's race-free because emitAsync has already
        // awaited the listener, so the rows exist (or don't) by the
        // time this query fires.
        await this.eventEmitter.emitAsync(
          ORDER_EVENTS.CREATED,
          new OrderCreatedEvent(
            order.id,
            order.orderNumber,
            correlationId,
            dto.items.map((item) => ({
              variantId: item.variantId,
              warehouseId: item.warehouseId ?? defaultWarehouseId ?? '',
              quantity: item.quantity,
              reservationSessionId,
            })),
          ),
        )

        // Direct query — reliable regardless of event-emitter semantics.
        const createdReservations = await this.prisma.stockReservation.findMany({
          where: { orderId: order.id, status: 'RESERVED' },
          select: { id: true },
        })
        const flatIds: string[] = createdReservations.map((r) => r.id)

        // Merge reservationIds into existing notes (don't overwrite guest data)
        if (flatIds.length > 0) {
          try {
            const existingNotes = order.notes ? JSON.parse(order.notes as string) : {}
            await this.prisma.order.update({
              where: { id: order.id },
              data: { notes: JSON.stringify({ ...existingNotes, reservationIds: flatIds }) },
            })
          } catch {
            // Non-critical: notes save failed, order still valid
          }
        }
      } catch (err: any) {
        this.logger.error(`[${correlationId}] Inventory reservation error: ${err?.message ?? String(err)}`)
        await this.cancelInternal(order.id, 'stock-reservation-failed', [], userId ?? 'system', correlationId).catch(() => {})
        const msg = typeof err?.response?.message === 'string' ? err.response.message : 'Nicht genügend Bestand für diese Bestellung'
        throw new ConflictException(msg)
      }

      // 10. Idempotency cachen
      if (idempotencyKey) {
        await this.idempotencyService.save(idempotencyKey, endpoint, requestHash, order, 201, userId ?? undefined)
      }

      return order
    } catch (err) {
      // Idempotency-Key bei Fehler entfernen (damit Retry möglich)
      if (idempotencyKey) {
        await this.prisma.idempotencyKey.deleteMany({ where: { key: idempotencyKey } }).catch(() => {})
      }
      throw err
    }
  }

  // ── FIND ALL (cursor-based pagination) ───────────────────────

  async findAll(query: QueryOrdersDto, userId?: string, isAdmin = false) {
    const { cursor, limit = 20, status, channel, dateFrom, dateTo } = query

    const where: any = { deletedAt: null }
    if (!isAdmin && userId) where.userId = userId
    if (status) where.status = status
    if (channel) where.channel = channel
    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) where.createdAt.gte = new Date(dateFrom)
      if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59.999Z')
    }

    // Cursor dekodieren
    if (cursor) {
      const { id, createdAt } = decodeCursor(cursor)
      where.OR = [
        { createdAt: { lt: new Date(createdAt) } },
        { createdAt: new Date(createdAt), id: { lt: id } },
      ]
    }

    const items = await this.prisma.order.findMany({
      where,
      take: limit + 1, // +1 um hasNextPage zu erkennen
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        items: { include: { variant: { select: { sku: true, color: true, size: true } } } },
        payment: { select: { status: true, method: true } },
        shipment: { select: { status: true, trackingNumber: true } },
      },
    })

    const hasNextPage = items.length > limit
    const data = hasNextPage ? items.slice(0, limit) : items
    const lastItem = data[data.length - 1]

    return {
      data,
      meta: {
        limit,
        hasNextPage,
        nextCursor: hasNextPage && lastItem
          ? encodeCursor(lastItem.id, lastItem.createdAt)
          : null,
      },
    }
  }

  // ── FIND ONE ─────────────────────────────────────────────────

  async findOne(id: string, userId?: string, isAdmin = false) {
    const where: any = { id, deletedAt: null }
    if (!isAdmin && userId) where.userId = userId

    const order = await this.prisma.order.findFirst({
      where,
      include: {
        items: {
          include: {
            variant: {
              select: {
                sku: true, color: true, size: true, colorHex: true,
                product: { select: { slug: true, translations: { where: { language: 'de' as any }, take: 1 } } },
              },
            },
          },
        },
        shippingAddress: true,
        payment: true,
        shipment: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    })

    if (!order) throw new OrderNotFoundException(id)
    return order
  }

  // ── UPDATE STATUS ─────────────────────────────────────────────

  async updateStatus(
    id: string,
    dto: UpdateOrderStatusDto,
    source: string,
    performedBy: string,
    correlationId: string,
  ) {
    const order = await this.prisma.order.findFirst({ where: { id, deletedAt: null } })
    if (!order) throw new OrderNotFoundException(id)

    const allowed = VALID_TRANSITIONS[order.status] ?? []
    if (!allowed.includes(dto.status)) {
      throw new InvalidOrderStateException(order.status, dto.status)
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const o = await tx.order.update({
        where: { id },
        data: {
          status: dto.status as any,
          ...(dto.status === 'cancelled' ? { cancelledAt: new Date(), cancelReason: dto.notes } : {}),
        },
      })

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: order.status as any,
          toStatus: dto.status as any,
          source,
          referenceId: dto.referenceId,
          notes: dto.notes,
          createdBy: performedBy,
        },
      })

      return o
    })

    this.logger.log(
      `[${correlationId}] Status: ${order.orderNumber} | ${order.status} → ${dto.status} | by=${performedBy}`,
    )

    this.eventEmitter.emit(
      ORDER_EVENTS.STATUS_CHANGED,
      new OrderStatusChangedEvent(id, order.status, dto.status, source, correlationId),
    )

    // Bestätigung → Inventory-Bestand physisch abziehen
    if (dto.status === 'confirmed') {
      const reservationIds = this.extractReservationIds(order.notes)
      if (reservationIds.length > 0) {
        // Normal path: confirm existing reservations
        await this.eventEmitter.emitAsync(
          ORDER_EVENTS.CONFIRMED,
          new OrderConfirmedEvent(id, order.orderNumber, correlationId, reservationIds),
        )
      } else {
        // Fallback: no reservations exist → deduct stock directly
        this.logger.warn(`[${correlationId}] No reservationIds for ${order.orderNumber} — deducting stock directly`)
        const fullOrder = await this.prisma.order.findUnique({
          where: { id },
          include: { items: true },
        })
        if (fullOrder) {
          for (const item of fullOrder.items) {
            const whId = fullOrder.fulfillmentWarehouseId
            if (!whId) continue
            const inv = await this.prisma.inventory.findUnique({
              where: { variantId_warehouseId: { variantId: item.variantId, warehouseId: whId } },
            })
            if (inv && inv.quantityOnHand >= item.quantity) {
              await this.prisma.$transaction([
                this.prisma.inventory.update({
                  where: { variantId_warehouseId: { variantId: item.variantId, warehouseId: whId } },
                  data: { quantityOnHand: { decrement: item.quantity } },
                }),
                this.prisma.inventoryMovement.create({
                  data: {
                    variantId: item.variantId, warehouseId: whId, type: 'sale_online',
                    quantity: -item.quantity, quantityBefore: inv.quantityOnHand,
                    quantityAfter: inv.quantityOnHand - item.quantity,
                    referenceId: id, notes: `Direkter Abzug — Bestellung ${order.orderNumber}`, createdBy: performedBy,
                  },
                }),
              ])
            }
          }
        }
      }
    }

    // Storno → Inventory-Bestand freigeben
    if (dto.status === 'cancelled') {
      const reservationIds = this.extractReservationIds(order.notes)
      await this.eventEmitter.emitAsync(
        ORDER_EVENTS.CANCELLED,
        new OrderCancelledEvent(id, order.orderNumber, correlationId, dto.notes ?? 'manual-cancel', reservationIds),
      )
    }

    return updated
  }

  // ── SOFT DELETE ───────────────────────────────────────────────

  async softDelete(id: string, correlationId: string) {
    const order = await this.prisma.order.findFirst({ where: { id, deletedAt: null } })
    if (!order) throw new OrderNotFoundException(id)

    if (!['cancelled', 'refunded'].includes(order.status)) {
      throw new BadRequestException(
        'Nur stornierte oder erstattete Bestellungen können archiviert werden',
      )
    }

    await this.prisma.order.update({ where: { id }, data: { deletedAt: new Date() } })
    this.logger.log(`[${correlationId}] Soft-Delete: ${order.orderNumber}`)
  }

  // ── Internal: Bestellnummer generieren ───────────────────────

  private async generateOrderNumber(): Promise<string> {
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

    const result = await this.prisma.$queryRaw<{ seq: number }[]>`
      INSERT INTO order_sequences (date_key, seq)
      VALUES (${today}, 1)
      ON CONFLICT (date_key) DO UPDATE
        SET seq = order_sequences.seq + 1
      RETURNING seq
    `

    const seq = result[0].seq
    const datePart = today.replace(/-/g, '') // YYYYMMDD
    return `ORD-${datePart}-${String(seq).padStart(6, '0')}`
  }

  // ── Internal: Länderkode bestimmen ───────────────────────────

  private async resolveCountryCode(dto: CreateOrderDto, userId: string | null): Promise<string> {
    if (dto.countryCode) return dto.countryCode

    if (dto.shippingAddressId) {
      const address = await this.prisma.address.findUnique({
        where: { id: dto.shippingAddressId },
        select: { country: true },
      })
      if (address) return address.country
    }

    if (userId) {
      const defaultAddress = await this.prisma.address.findFirst({
        where: { userId, isDefaultShipping: true, deletedAt: null },
        select: { country: true },
      })
      if (defaultAddress) return defaultAddress.country
    }

    return 'DE' // Fallback
  }

  // ── Internal: Storno (intern, ohne Auth-Check) ────────────────

  private async cancelInternal(
    orderId: string,
    reason: string,
    reservationIds: string[],
    performedBy: string,
    correlationId: string,
  ) {
    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason },
      }),
      this.prisma.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: 'pending',
          toStatus: 'cancelled',
          source: 'system',
          notes: reason,
          createdBy: performedBy,
        },
      }),
    ])

    if (reservationIds.length > 0) {
      this.eventEmitter.emit(
        ORDER_EVENTS.CANCELLED,
        new OrderCancelledEvent(orderId, '', correlationId, reason, reservationIds),
      )
    }
  }

  // ── Internal: Reservierungs-IDs aus notes extrahieren ─────────

  private extractReservationIds(notes: string | null): string[] {
    if (!notes) return []
    try {
      const parsed = JSON.parse(notes)
      return Array.isArray(parsed.reservationIds) ? parsed.reservationIds : []
    } catch {
      return []
    }
  }
}
