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
  ) {}

  // ── CREATE ────────────────────────────────────────────────────

  async create(
    dto: CreateOrderDto,
    userId: string | null,
    correlationId: string,
    idempotencyKey?: string,
  ) {
    const endpoint = 'POST:/orders'
    const requestHash = this.idempotencyService.hashBody({ ...dto, userId })

    // 1. Idempotency-Check
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

      // 3. STOCK CHECK — Block overselling BEFORE creating order
      const locale = dto.locale ?? 'de'
      for (const item of dto.items) {
        const totalAvailable = await this.prisma.inventory.aggregate({
          where: { variantId: item.variantId, warehouse: { isActive: true } },
          _sum: { quantityOnHand: true, quantityReserved: true },
        })
        const available = (totalAvailable._sum.quantityOnHand ?? 0) - (totalAvailable._sum.quantityReserved ?? 0)
        if (available < item.quantity) {
          const variant = await this.prisma.productVariant.findUnique({
            where: { id: item.variantId },
            select: { color: true, size: true, product: { select: { translations: { where: { language: (locale ?? 'de') as any }, take: 1 } } } },
          })
          const productName = variant?.product?.translations?.[0]?.name ?? ''
          const detail = [variant?.color, variant?.size].filter(Boolean).join(' / ')
          const msg = available <= 0
            ? locale === 'ar'
              ? `عذراً، "${productName}" (${detail}) غير متوفر حالياً`
              : locale === 'en'
                ? `Sorry, "${productName}" (${detail}) is currently out of stock`
                : `"${productName}" (${detail}) ist leider nicht mehr verfügbar`
            : locale === 'ar'
              ? `عذراً، يتوفر فقط ${available} قطعة من "${productName}" (${detail})`
              : locale === 'en'
                ? `Sorry, only ${available} piece(s) of "${productName}" (${detail}) available`
                : `Nur noch ${available} Stück von "${productName}" (${detail}) verfügbar`
          throw new ConflictException(msg)
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
      let discountAmount = 0
      let validatedCouponCode: string | undefined

      if (dto.couponCode) {
        const coupon = await this.prisma.coupon.findFirst({
          where: {
            code: dto.couponCode,
            isActive: true,
            AND: [
              { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
              { OR: [{ maxUsageCount: null }, { usedCount: { lt: 1000000 } }] },
            ],
          },
        })

        if (coupon) {
          if (coupon.minOrderAmount && subtotal < Number(coupon.minOrderAmount)) {
            throw new BadRequestException(
              `Mindestbestellwert für Coupon: €${Number(coupon.minOrderAmount).toFixed(2)}`,
            )
          }

          if (coupon.discountPercent) {
            discountAmount = subtotal * (Number(coupon.discountPercent) / 100)
          } else if (coupon.discountAmount) {
            discountAmount = Math.min(Number(coupon.discountAmount), subtotal)
          }

          validatedCouponCode = coupon.code
        }
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
      let resolvedUserId = userId
      if (!resolvedUserId && dto.guestEmail) {
        const existing = await this.prisma.user.findUnique({ where: { email: dto.guestEmail.toLowerCase() } })
        if (existing) {
          resolvedUserId = existing.id
        } else {
          const guest = await this.prisma.user.create({
            data: {
              email: dto.guestEmail.toLowerCase(),
              firstName: dto.guestFirstName ?? '',
              lastName: dto.guestLastName ?? '',
              role: 'customer',
              preferredLang: (dto.locale ?? 'de') as any,
              isActive: true,
              isVerified: false,
              // No passwordHash = guest account (can claim later via "Konto erstellen")
            },
          })
          resolvedUserId = guest.id
          this.logger.log(`[${correlationId}] Guest customer created: ${guest.email} → ${guest.id}`)
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

        // Coupon-Verwendung erfassen
        if (validatedCouponCode) {
          const coupon = await tx.coupon.findFirst({ where: { code: validatedCouponCode } })
          if (coupon) {
            await tx.couponUsage.create({ data: { couponId: coupon.id, orderId: created.id } })
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
        const reservationIds = await this.eventEmitter.emitAsync(
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

        // emitAsync returns results from ALL listeners — find the one with reservation IDs
        const flatIds: string[] = (reservationIds ?? [])
          .flat(2)
          .filter((id): id is string => typeof id === 'string' && id.length > 10)

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
