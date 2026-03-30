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
      // 2. Auto-resolve warehouse if not provided
      const defaultWarehouse = await this.prisma.warehouse.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } })
      const defaultWarehouseId = defaultWarehouse?.id
      for (const item of dto.items) {
        if (!item.warehouseId && defaultWarehouseId) {
          item.warehouseId = defaultWarehouseId
        }
      }

      // 3. Varianten validieren + Preise snapshot-en
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
      let subtotal = 0
      let taxAmount = 0

      const itemData = dto.items.map((item) => {
        const v = variantMap.get(item.variantId)!
        const unitPrice = Number(v.product.salePrice ?? v.product.basePrice) + Number(v.priceModifier)
        const taxRate = Number(v.product.taxRate)
        const itemTotal = unitPrice * item.quantity
        const itemTax = itemTotal * (taxRate / 100)

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

      const totalAmount = subtotal + shipping.cost + taxAmount - discountAmount

      // 7. Bestellnummer generieren (atomic counter)
      const orderNumber = await this.generateOrderNumber()

      // 8. Bestellung + Items anlegen
      const reservationSessionId = randomUUID()

      const order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            orderNumber,
            userId,
            guestEmail: dto.guestEmail,
            shippingAddressId: dto.shippingAddressId,
            status: 'pending',
            channel: (dto.channel ?? 'website') as any,
            subtotal,
            shippingCost: shipping.cost,
            taxAmount,
            discountAmount,
            totalAmount,
            shippingZone: shipping.zoneName,
            couponCode: validatedCouponCode,
            fulfillmentWarehouseId: defaultWarehouse?.id ?? null,
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

        // reservationIds[0] = Rückgabe des InventoryListeners
        const rawIds = reservationIds?.[0]
        const flatIds: string[] = Array.isArray(rawIds) ? rawIds.filter((id): id is string => typeof id === 'string') : []

        // Bestellnummer + reservationIds in JSON notes speichern für Storno
        if (flatIds.length > 0) {
          try {
            await this.prisma.order.update({
              where: { id: order.id },
              data: { notes: JSON.stringify({ reservationIds: flatIds }) },
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
      await this.eventEmitter.emitAsync(
        ORDER_EVENTS.CONFIRMED,
        new OrderConfirmedEvent(id, order.orderNumber, correlationId, reservationIds),
      )
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
