import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from './audit.service'
import { NotificationService } from './notification.service'
import { PaymentsService } from '../../payments/payments.service'
import { ShipmentsService } from '../../shipments/shipments.service'
import { EmailService } from '../../email/email.service'
import { ReservationService } from '../../inventory/reservation.service'
import { calculateProportionalRefund } from '../../../common/helpers/refund-calc'

@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notificationService: NotificationService,
    private readonly emailService: EmailService,
    private readonly paymentsService: PaymentsService,
    private readonly shipmentsService: ShipmentsService,
    private readonly eventEmitter: EventEmitter2,
    // Optional so the legacy unit tests that construct AdminOrdersService
    // without the reservation mock don't break — but production (DI via
    // AdminModule + InventoryModule) always provides it.  Every new call
    // site defensively checks `if (this.reservationService)` below.
    @Optional() private readonly reservationService?: ReservationService,
  ) {}

  async findAll(query: {
    status?: string
    channel?: string
    dateFrom?: string
    dateTo?: string
    search?: string
    limit?: number
    cursor?: string
  }) {
    const limit = query.limit ?? 20
    const where: any = { deletedAt: null }

    if (query.status) where.status = query.status
    if (query.channel) where.channel = query.channel
    if (query.dateFrom) where.createdAt = { ...where.createdAt, gte: new Date(query.dateFrom) }
    if (query.dateTo) where.createdAt = { ...where.createdAt, lte: new Date(query.dateTo) }
    if (query.search) {
      where.OR = [
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
        { user: { email: { contains: query.search, mode: 'insensitive' } } },
        { user: { firstName: { contains: query.search, mode: 'insensitive' } } },
      ]
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        payment: { select: { method: true, status: true, provider: true } },
        shipment: { select: { status: true, trackingNumber: true, carrier: true } },
        fulfillmentWarehouse: { select: { id: true, name: true, type: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return orders
  }

  async findOne(orderId: string, adminId?: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } },
        items: {
          include: {
            variant: {
              select: { sku: true, color: true, colorHex: true, size: true, product: { select: { slug: true, translations: true, images: { select: { url: true, colorName: true, isPrimary: true }, orderBy: { sortOrder: 'asc' }, take: 5 } } } },
            },
          },
        },
        payment: true,
        shipment: true,
        returns: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
        shippingAddress: true,
        fulfillmentWarehouse: { select: { id: true, name: true, type: true } },
      },
    })

    if (!order) throw new NotFoundException('Order not found')

    // Admin read-tracking: mark as viewed on the first detail-open.
    //
    // Fire-and-forget — MUST NOT block the response. If the write fails
    // (DB slow, Prisma hiccup), the detail view still loads normally and
    // the order stays flagged as unread — next open tries again. Never
    // propagate the error to the caller.
    //
    // Atomicity: updateMany with `WHERE firstViewedByAdminAt IS NULL`
    // guarantees first-writer-wins across concurrent admin tabs. The
    // second tab's updateMany matches zero rows (the field is now set)
    // and is a clean no-op — no overwrite of the original viewer.
    if (adminId && order.firstViewedByAdminAt === null) {
      this.prisma.order
        .updateMany({
          where: { id: orderId, firstViewedByAdminAt: null },
          data: { firstViewedByAdminAt: new Date(), firstViewedByAdmin: adminId },
        })
        .catch((e: any) =>
          this.logger.warn(`Failed to mark order ${orderId} as viewed by ${adminId}: ${e?.message ?? e}`),
        )
    }

    // Include admin notes
    const notes = await this.prisma.adminNote.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    })

    // R4 — Per-line fulfillment warehouse derivation.
    //
    // OrderItem has no warehouseId column; the authoritative source is the
    // active StockReservation for (orderId, variantId). We fetch all active
    // reservations in one query and map them onto items by variantId so the
    // frontend can render a warehouse badge per row.
    //
    // Edge cases handled:
    //   - CONFIRMED reservations (post-payment) are just as authoritative as
    //     RESERVED — both reflect where the physical stock is being held.
    //     RELEASED is excluded because it represents a cancelled or expired
    //     reservation where the stock is no longer committed to this order.
    //   - Multiple active reservations for the same variant (e.g. after a
    //     partial per-line move) can exist; we pick the one with the highest
    //     quantity as a sensible default for the display. The per-line
    //     change endpoint (R5) always operates on the full reservation so
    //     this ambiguity doesn't cause corruption — only display preference.
    //   - Items without variantId (snapshot-only, rare legacy) stay null.
    const reservations = await this.prisma.stockReservation.findMany({
      where: {
        orderId: order.id,
        status: { in: ['RESERVED', 'CONFIRMED'] },
      },
      select: {
        variantId: true,
        quantity: true,
        status: true,
        warehouse: { select: { id: true, name: true, type: true } },
      },
      orderBy: { quantity: 'desc' },
    })
    const whByVariant = new Map<string, { id: string; name: string; type: string }>()
    for (const r of reservations) {
      // First hit wins (ordered by quantity desc) — stable per-variant pick
      if (!whByVariant.has(r.variantId)) whByVariant.set(r.variantId, r.warehouse)
    }
    const itemsWithWarehouse = order.items.map((item) => ({
      ...item,
      fulfillmentWarehouse: item.variantId ? whByVariant.get(item.variantId) ?? null : null,
    }))

    return { ...order, items: itemsWithWarehouse, adminNotes: notes }
  }

  async changeFulfillmentWarehouse(orderId: string, newWarehouseId: string, adminId: string, ipAddress: string, force = false) {
    // 1. Validate order exists and is in a changeable status.
    //
    // Items are loaded with variant+product snapshot fields so the stock-
    // warning payload can show a human-readable row per item (product name,
    // color, size, SKU) instead of raw UUIDs. The frontend localizes the
    // labels — we only ship data here.
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        items: {
          select: {
            id: true,
            variantId: true,
            quantity: true,
            snapshotName: true,
            snapshotSku: true,
            variant: {
              select: {
                color: true,
                size: true,
                sku: true,
                product: { select: { translations: { select: { language: true, name: true } } } },
              },
            },
          },
        },
      },
    })
    if (!order) throw new NotFoundException('Order not found')
    if (['cancelled', 'refunded', 'shipped', 'delivered'].includes(order.status)) {
      throw new BadRequestException('Cannot change warehouse for orders that are cancelled, shipped, or delivered')
    }

    const oldWarehouseId = order.fulfillmentWarehouseId
    if (oldWarehouseId === newWarehouseId) return { changed: false }

    // 2. Validate the new warehouse exists and is active
    const newWarehouse = await this.prisma.warehouse.findFirst({ where: { id: newWarehouseId, isActive: true } })
    if (!newWarehouse) throw new NotFoundException('Warehouse not found or inactive')

    // 3. Check stock availability in the new warehouse for each item.
    // Return structured objects so the frontend can render a proper i18n UI.
    // We ship ALL available translations of the product name (nameDe / nameEn
    // / nameAr) so the frontend picks whichever matches the admin's locale
    // with its own fallback chain. Color is stored German-canonical in the
    // DB — the frontend already has a `translateColor()` helper for that.
    const stockWarnings: Array<{
      sku: string
      nameDe: string | null
      nameEn: string | null
      nameAr: string | null
      snapshotName: string | null
      color: string | null
      size: string | null
      available: number
      needed: number
    }> = []
    for (const item of order.items) {
      if (!item.variantId) continue
      const inv = await this.prisma.inventory.findFirst({ where: { variantId: item.variantId, warehouseId: newWarehouseId } })
      const available = inv ? inv.quantityOnHand - inv.quantityReserved : 0
      if (available < item.quantity) {
        const translations = (item as any).variant?.product?.translations ?? []
        stockWarnings.push({
          sku: (item as any).variant?.sku ?? item.snapshotSku ?? '',
          nameDe: translations.find((t: any) => t.language === 'de')?.name ?? null,
          nameEn: translations.find((t: any) => t.language === 'en')?.name ?? null,
          nameAr: translations.find((t: any) => t.language === 'ar')?.name ?? null,
          snapshotName: item.snapshotName ?? null,
          color: (item as any).variant?.color ?? null,
          size: (item as any).variant?.size ?? null,
          available,
          needed: item.quantity,
        })
      }
    }
    if (stockWarnings.length > 0 && !force) {
      return { changed: false, needsConfirmation: true, warnings: stockWarnings, warehouseName: newWarehouse.name }
    }

    // 4. Move ALL reservations for this order to the new warehouse — regardless of which warehouse they are currently in
    //
    // Integrity safeguard: the `inventory_reserved_lte_on_hand` CHECK
    // constraint (migration 13.04.2026) blocks any write that would let
    // `quantityReserved` exceed `quantityOnHand`. If the admin force-
    // switches into a warehouse that has 0 physical stock but we need to
    // reserve >= 1, the step-4 increment raises Postgres code 23514.
    //
    // Old behaviour: that 500-error bubbled up raw to the UI. We now catch
    // it explicitly and convert it into a user-visible ConflictException
    // with a 3-language message telling the admin to transfer physical
    // stock first (via /admin/inventory/transfer) before re-attempting
    // the fulfilment switch. Nothing else touches the DB on this path —
    // the transaction rolls back cleanly.
    try {
      await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        if (!item.variantId) continue

        // Find ALL active reservations for this order+variant (any warehouse)
        const reservations = await tx.stockReservation.findMany({
          where: { variantId: item.variantId, orderId, status: 'RESERVED' },
        })

        for (const res of reservations) {
          // Skip if already in the new warehouse
          if (res.warehouseId === newWarehouseId) continue

          const sourceWarehouseId = res.warehouseId

          // Ensure inventory row exists in the new warehouse (upsert)
          const existingInv = await tx.inventory.findFirst({
            where: { variantId: item.variantId, warehouseId: newWarehouseId },
          })
          if (!existingInv) {
            await tx.inventory.create({
              data: { variantId: item.variantId, warehouseId: newWarehouseId, quantityOnHand: 0, quantityReserved: 0 },
            })
          }

          // Move the reservation record to the new warehouse
          await tx.stockReservation.update({
            where: { id: res.id },
            data: { warehouseId: newWarehouseId },
          })

          // Release reserved count from the SOURCE warehouse
          const sourceInv = await tx.inventory.findFirst({ where: { variantId: item.variantId, warehouseId: sourceWarehouseId } })
          if (sourceInv && sourceInv.quantityReserved >= res.quantity) {
            await tx.inventory.updateMany({
              where: { variantId: item.variantId, warehouseId: sourceWarehouseId },
              data: { quantityReserved: { decrement: res.quantity } },
            })
          }

          // Add reserved count to the NEW warehouse
          await tx.inventory.updateMany({
            where: { variantId: item.variantId, warehouseId: newWarehouseId },
            data: { quantityReserved: { increment: res.quantity } },
          })

          // Document the movement
          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId, warehouseId: sourceWarehouseId,
              type: 'released', quantity: res.quantity,
              quantityBefore: sourceInv?.quantityReserved ?? 0, quantityAfter: Math.max(0, (sourceInv?.quantityReserved ?? 0) - res.quantity),
              notes: `Reservierung verschoben → ${newWarehouse.name}: ${order.orderNumber}`, createdBy: adminId,
            },
          })
          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId, warehouseId: newWarehouseId,
              type: 'reserved', quantity: res.quantity,
              quantityBefore: existingInv?.quantityReserved ?? 0, quantityAfter: (existingInv?.quantityReserved ?? 0) + res.quantity,
              notes: `Reservierung übernommen ← Lager-Wechsel: ${order.orderNumber}`, createdBy: adminId,
            },
          })
        }
      }

      // Update order fulfillment warehouse
      await tx.order.update({
        where: { id: orderId },
        data: { fulfillmentWarehouseId: newWarehouseId },
      })
      })
    } catch (err: any) {
      // Postgres CHECK constraint violation — mapped to a friendly 409 so
      // the admin understands the block comes from the stock-integrity rule
      // and knows the concrete next step (transfer physical stock first).
      const raw = err?.message ?? String(err ?? '')
      if (raw.includes('inventory_reserved_lte_on_hand') || raw.includes('23514')) {
        throw new BadRequestException({
          statusCode: 409,
          error: 'StockTransferRequired',
          message: {
            de: `Kein Bestand in "${newWarehouse.name}". Verschiebe den Bestand zuerst im Menü "Inventar → Transfer" — erst danach kannst du das Fulfillment-Lager umstellen.`,
            en: `No stock in "${newWarehouse.name}". Transfer the physical stock first via "Inventory → Transfer" — only then can the fulfillment warehouse be switched.`,
            ar: `لا يوجد مخزون في "${newWarehouse.name}". انقل المخزون أولاً عبر "المخزون ← نقل" قبل تغيير مستودع التنفيذ.`,
          },
        })
      }
      throw err
    }

    // 5. Audit log (outside transaction — non-critical)
    await this.audit.log({
      adminId, action: 'ORDER_FULFILLMENT_CHANGED', entityType: 'order', entityId: orderId,
      changes: { before: { warehouseId: oldWarehouseId }, after: { warehouseId: newWarehouseId, name: newWarehouse.name } },
      ipAddress,
    })

    return { changed: true, warehouseName: newWarehouse.name }
  }

  // ── R5: Per-Line Warehouse Change ─────────────────────────────
  //
  // Moves ONE order-item's reservation from its current warehouse to a new
  // one, without touching the other items. Complements changeFulfillment-
  // Warehouse (which moves all items to one warehouse). Useful when the
  // admin splits fulfilment across locations (one item from Marzahn, one
  // from Hamburg).
  //
  // Semantics:
  //   - Only touches the StockReservation for (orderId, item.variantId,
  //     status IN RESERVED|CONFIRMED). No other inventory row is affected.
  //   - Atomic: if the target warehouse can't hold the reserved quantity
  //     (CHECK constraint `inventory_reserved_lte_on_hand` fires), the
  //     entire transaction rolls back and no DB row changed.
  //   - Guard: only for orders that have NOT yet shipped. Cancelled /
  //     refunded / shipped / delivered blocks the move because the physical
  //     stock is either committed to a parcel or already gone.
  //   - Does NOT touch quantityOnHand — only quantityReserved moves between
  //     warehouses, matching how reserve() originally accounted the stock.
  //
  // Error cases:
  //   - 404 OrderNotFound / ItemNotFound / WarehouseNotFound
  //   - 400 OrderNotEditable (bad status)
  //   - 400 NoActiveReservation (reservation already released / variant
  //         was snapshot-only / historical order pre-reservation-system)
  //   - 409 StockTransferRequired (target has no free capacity; structured
  //         3-language message with a concrete next step for the admin)
  async changeItemWarehouse(
    orderId: string,
    itemId: string,
    newWarehouseId: string,
    adminId: string,
    ipAddress: string,
  ) {
    // 1. Load order + item + the item's current reservation in one shot
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        items: {
          where: { id: itemId },
          select: {
            id: true,
            variantId: true,
            quantity: true,
            snapshotName: true,
            snapshotSku: true,
            variant: {
              select: {
                color: true,
                size: true,
                sku: true,
                product: { select: { translations: { select: { language: true, name: true } } } },
              },
            },
          },
        },
      },
    })
    if (!order) throw new NotFoundException({ statusCode: 404, error: 'OrderNotFound', message: 'Order not found' })
    const item = order.items[0]
    if (!item) throw new NotFoundException({ statusCode: 404, error: 'ItemNotFound', message: 'Order item not found' })
    if (!item.variantId) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'NoVariant',
        message: {
          de: 'Artikel hat keine Variante — Lager-Wechsel nicht möglich.',
          en: 'Item has no variant — warehouse change not possible.',
          ar: 'العنصر لا يحتوي على متغير — لا يمكن تغيير المستودع.',
        },
      })
    }

    if (['cancelled', 'refunded', 'shipped', 'delivered'].includes(order.status)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'OrderNotEditable',
        message: {
          de: 'Bestellungen in diesem Status können nicht umgebucht werden.',
          en: 'Orders in this status cannot be re-assigned.',
          ar: 'لا يمكن إعادة تعيين الطلبات في هذه الحالة.',
        },
      })
    }

    // 2. Validate target warehouse
    const newWarehouse = await this.prisma.warehouse.findFirst({
      where: { id: newWarehouseId, isActive: true },
      select: { id: true, name: true, type: true },
    })
    if (!newWarehouse) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'WarehouseNotFound',
        message: 'Warehouse not found or inactive',
      })
    }

    // 3. Find the active reservation for this item
    const reservation = await this.prisma.stockReservation.findFirst({
      where: {
        orderId,
        variantId: item.variantId,
        status: { in: ['RESERVED', 'CONFIRMED'] },
      },
      select: { id: true, warehouseId: true, quantity: true, status: true },
      orderBy: { quantity: 'desc' }, // If multiple, pick the biggest (most relevant)
    })
    if (!reservation) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'NoActiveReservation',
        message: {
          de: 'Für diesen Artikel existiert keine aktive Reservierung.',
          en: 'No active reservation exists for this item.',
          ar: 'لا يوجد حجز نشط لهذا العنصر.',
        },
      })
    }

    const oldWarehouseId = reservation.warehouseId
    if (oldWarehouseId === newWarehouseId) {
      return { changed: false, warehouseName: newWarehouse.name }
    }

    // 4. Atomic swap
    try {
      await this.prisma.$transaction(async (tx) => {
        // Ensure inventory row exists at the new warehouse (upsert-style)
        const existingInv = await tx.inventory.findFirst({
          where: { variantId: item.variantId!, warehouseId: newWarehouseId },
        })
        if (!existingInv) {
          await tx.inventory.create({
            data: {
              variantId: item.variantId!,
              warehouseId: newWarehouseId,
              quantityOnHand: 0,
              quantityReserved: 0,
              reorderPoint: 5,
            },
          })
        }

        // Move the reservation record to the new warehouse
        await tx.stockReservation.update({
          where: { id: reservation.id },
          data: { warehouseId: newWarehouseId },
        })

        // Release reserved count from the source warehouse
        const sourceInv = await tx.inventory.findFirst({
          where: { variantId: item.variantId!, warehouseId: oldWarehouseId },
        })
        if (sourceInv && sourceInv.quantityReserved >= reservation.quantity) {
          await tx.inventory.updateMany({
            where: { variantId: item.variantId!, warehouseId: oldWarehouseId },
            data: { quantityReserved: { decrement: reservation.quantity } },
          })
        }

        // Add reserved count to the new warehouse — this is the one that
        // may violate inventory_reserved_lte_on_hand if onHand < reserved+qty.
        await tx.inventory.updateMany({
          where: { variantId: item.variantId!, warehouseId: newWarehouseId },
          data: { quantityReserved: { increment: reservation.quantity } },
        })

        // Document the movements
        await tx.inventoryMovement.createMany({
          data: [
            {
              variantId: item.variantId!,
              warehouseId: oldWarehouseId,
              type: 'released',
              quantity: reservation.quantity,
              quantityBefore: sourceInv?.quantityReserved ?? 0,
              quantityAfter: Math.max(0, (sourceInv?.quantityReserved ?? 0) - reservation.quantity),
              referenceId: reservation.id,
              notes: `Per-line move → ${newWarehouse.name}: ${order.orderNumber} / ${item.snapshotSku ?? item.variantId}`,
              createdBy: adminId,
            },
            {
              variantId: item.variantId!,
              warehouseId: newWarehouseId,
              type: 'reserved',
              quantity: reservation.quantity,
              quantityBefore: existingInv?.quantityReserved ?? 0,
              quantityAfter: (existingInv?.quantityReserved ?? 0) + reservation.quantity,
              referenceId: reservation.id,
              notes: `Per-line move ← source swap: ${order.orderNumber} / ${item.snapshotSku ?? item.variantId}`,
              createdBy: adminId,
            },
          ],
        })
      })
    } catch (err: any) {
      const raw = err?.message ?? String(err ?? '')
      if (raw.includes('inventory_reserved_lte_on_hand') || raw.includes('23514')) {
        throw new BadRequestException({
          statusCode: 409,
          error: 'StockTransferRequired',
          message: {
            de: `Kein Bestand in "${newWarehouse.name}". Verschiebe den Bestand zuerst über "Inventar → Transfer".`,
            en: `No stock in "${newWarehouse.name}". Transfer the physical stock first via "Inventory → Transfer".`,
            ar: `لا يوجد مخزون في "${newWarehouse.name}". انقل المخزون أولاً عبر "المخزون ← نقل".`,
          },
        })
      }
      throw err
    }

    // 5. Audit log (outside transaction — non-critical)
    await this.audit.log({
      adminId,
      action: 'ORDER_ITEM_WAREHOUSE_CHANGED',
      entityType: 'order',
      entityId: orderId,
      changes: {
        before: { itemId, warehouseId: oldWarehouseId },
        after: { itemId, warehouseId: newWarehouseId, warehouseName: newWarehouse.name, sku: item.snapshotSku ?? item.variantId },
      },
      ipAddress,
    })

    return { changed: true, warehouseName: newWarehouse.name }
  }

  // ── R7: Consolidate All Lines into One Warehouse ─────────────
  //
  // Moves ALL active reservations of an order into a single target warehouse
  // in one atomic transaction. Useful when the admin wants to ship the whole
  // order from a single pickup point (fewer parcels, simpler packing).
  //
  // Two-phase logic:
  //   1. PREFLIGHT — for every active reservation, verify the target
  //      warehouse has enough free capacity (onHand - reserved >= qty).
  //      If any single variant fails, return a structured warnings list
  //      and DO NOT touch the DB. Frontend shows a red-warning dialog with
  //      per-item availability.
  //   2. EXECUTE — with force=true, run the move per item inside one
  //      transaction. If the CHECK-constraint fires mid-loop, everything
  //      rolls back (atomicity).
  //
  // Intentionally separate from changeItemWarehouse so the audit trail is
  // one ORDER_WAREHOUSE_CONSOLIDATED entry instead of N per-item entries.
  async consolidateWarehouse(
    orderId: string,
    newWarehouseId: string,
    adminId: string,
    ipAddress: string,
    force = false,
  ) {
    // 1. Load order
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        items: {
          select: {
            id: true,
            variantId: true,
            quantity: true,
            snapshotName: true,
            snapshotSku: true,
            variant: {
              select: {
                color: true,
                size: true,
                sku: true,
                product: { select: { translations: { select: { language: true, name: true } } } },
              },
            },
          },
        },
      },
    })
    if (!order) throw new NotFoundException('Order not found')
    if (['cancelled', 'refunded', 'shipped', 'delivered'].includes(order.status)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'OrderNotEditable',
        message: {
          de: 'Bestellungen in diesem Status können nicht umgebucht werden.',
          en: 'Orders in this status cannot be re-assigned.',
          ar: 'لا يمكن إعادة تعيين الطلبات في هذه الحالة.',
        },
      })
    }

    const newWarehouse = await this.prisma.warehouse.findFirst({
      where: { id: newWarehouseId, isActive: true },
      select: { id: true, name: true, type: true },
    })
    if (!newWarehouse) throw new NotFoundException('Warehouse not found or inactive')

    // 2. Collect all active reservations + compute required quantity per variant
    const reservations = await this.prisma.stockReservation.findMany({
      where: {
        orderId,
        status: { in: ['RESERVED', 'CONFIRMED'] },
      },
      select: { id: true, variantId: true, warehouseId: true, quantity: true },
    })
    if (reservations.length === 0) {
      return { changed: false, itemsMoved: 0 }
    }

    // Filter out reservations already at the target (no work to do)
    const toMove = reservations.filter((r) => r.warehouseId !== newWarehouseId)
    if (toMove.length === 0) {
      return { changed: false, itemsMoved: 0, warehouseName: newWarehouse.name }
    }

    // 3. Preflight: verify target warehouse can hold each reservation
    const stockWarnings: Array<{
      sku: string
      nameDe: string | null
      nameEn: string | null
      nameAr: string | null
      snapshotName: string | null
      color: string | null
      size: string | null
      available: number
      needed: number
    }> = []

    // Aggregate needed qty per variantId (same variant could appear twice)
    const neededByVariant = new Map<string, number>()
    for (const r of toMove) {
      neededByVariant.set(r.variantId, (neededByVariant.get(r.variantId) ?? 0) + r.quantity)
    }

    for (const [variantId, needed] of neededByVariant.entries()) {
      const inv = await this.prisma.inventory.findFirst({
        where: { variantId, warehouseId: newWarehouseId },
      })
      const available = inv ? inv.quantityOnHand - inv.quantityReserved : 0
      if (available < needed) {
        // Find the matching order item for display info
        const orderItem = order.items.find((i) => i.variantId === variantId) as any
        const translations = orderItem?.variant?.product?.translations ?? []
        stockWarnings.push({
          sku: orderItem?.variant?.sku ?? orderItem?.snapshotSku ?? '',
          nameDe: translations.find((t: any) => t.language === 'de')?.name ?? null,
          nameEn: translations.find((t: any) => t.language === 'en')?.name ?? null,
          nameAr: translations.find((t: any) => t.language === 'ar')?.name ?? null,
          snapshotName: orderItem?.snapshotName ?? null,
          color: orderItem?.variant?.color ?? null,
          size: orderItem?.variant?.size ?? null,
          available,
          needed,
        })
      }
    }

    if (stockWarnings.length > 0 && !force) {
      return {
        changed: false,
        needsConfirmation: true,
        warnings: stockWarnings,
        warehouseName: newWarehouse.name,
      }
    }

    // 4. Execute: move each reservation in one transaction
    let movedCount = 0
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const r of toMove) {
          const oldWarehouseId = r.warehouseId

          // Ensure new warehouse has an inventory row
          const existingInv = await tx.inventory.findFirst({
            where: { variantId: r.variantId, warehouseId: newWarehouseId },
          })
          if (!existingInv) {
            await tx.inventory.create({
              data: {
                variantId: r.variantId,
                warehouseId: newWarehouseId,
                quantityOnHand: 0,
                quantityReserved: 0,
                reorderPoint: 5,
              },
            })
          }

          await tx.stockReservation.update({
            where: { id: r.id },
            data: { warehouseId: newWarehouseId },
          })

          const sourceInv = await tx.inventory.findFirst({
            where: { variantId: r.variantId, warehouseId: oldWarehouseId },
          })
          if (sourceInv && sourceInv.quantityReserved >= r.quantity) {
            await tx.inventory.updateMany({
              where: { variantId: r.variantId, warehouseId: oldWarehouseId },
              data: { quantityReserved: { decrement: r.quantity } },
            })
          }

          await tx.inventory.updateMany({
            where: { variantId: r.variantId, warehouseId: newWarehouseId },
            data: { quantityReserved: { increment: r.quantity } },
          })

          await tx.inventoryMovement.createMany({
            data: [
              {
                variantId: r.variantId,
                warehouseId: oldWarehouseId,
                type: 'released',
                quantity: r.quantity,
                quantityBefore: sourceInv?.quantityReserved ?? 0,
                quantityAfter: Math.max(0, (sourceInv?.quantityReserved ?? 0) - r.quantity),
                referenceId: r.id,
                notes: `Consolidate → ${newWarehouse.name}: ${order.orderNumber}`,
                createdBy: adminId,
              },
              {
                variantId: r.variantId,
                warehouseId: newWarehouseId,
                type: 'reserved',
                quantity: r.quantity,
                quantityBefore: existingInv?.quantityReserved ?? 0,
                quantityAfter: (existingInv?.quantityReserved ?? 0) + r.quantity,
                referenceId: r.id,
                notes: `Consolidate ← consolidation: ${order.orderNumber}`,
                createdBy: adminId,
              },
            ],
          })

          movedCount++
        }

        // Sync order.fulfillmentWarehouseId so the order-level view matches
        await tx.order.update({
          where: { id: orderId },
          data: { fulfillmentWarehouseId: newWarehouseId },
        })
      })
    } catch (err: any) {
      const raw = err?.message ?? String(err ?? '')
      if (raw.includes('inventory_reserved_lte_on_hand') || raw.includes('23514')) {
        throw new BadRequestException({
          statusCode: 409,
          error: 'StockTransferRequired',
          message: {
            de: `Kein Bestand in "${newWarehouse.name}" für eine oder mehrere Zeilen. Verschiebe den Bestand zuerst.`,
            en: `No stock in "${newWarehouse.name}" for one or more lines. Transfer the physical stock first.`,
            ar: `لا يوجد مخزون في "${newWarehouse.name}" لعنصر أو أكثر. انقل المخزون أولاً.`,
          },
        })
      }
      throw err
    }

    // 5. Single audit entry for the whole consolidation
    await this.audit.log({
      adminId,
      action: 'ORDER_WAREHOUSE_CONSOLIDATED',
      entityType: 'order',
      entityId: orderId,
      changes: {
        after: {
          warehouseId: newWarehouseId,
          warehouseName: newWarehouse.name,
          itemsMoved: movedCount,
          totalItems: reservations.length,
        },
      },
      ipAddress,
    })

    return { changed: true, itemsMoved: movedCount, warehouseName: newWarehouse.name }
  }

  async updateStatus(
    orderId: string,
    status: string,
    notes: string,
    adminId: string,
    ipAddress: string,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
    })
    if (!order) throw new NotFoundException('Order not found')

    // Notes are optional — clean empty strings
    const cleanNotes = notes?.trim() || null

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: status as any,
        ...(status === 'cancelled' && { cancelledAt: new Date(), cancelReason: cleanNotes }),
      },
    })

    // When marking as delivered → set shipment.deliveredAt + status
    if (status === 'delivered') {
      await this.prisma.shipment.updateMany({
        where: { orderId, deliveredAt: null },
        data: { deliveredAt: new Date(), status: 'delivered' },
      })
    }

    // When marking as shipped → set shipment.shippedAt if missing
    if (status === 'shipped') {
      await this.prisma.shipment.updateMany({
        where: { orderId, shippedAt: null },
        data: { shippedAt: new Date() },
      })
    }

    await this.prisma.orderStatusHistory.create({
      data: {
        orderId,
        fromStatus: order.status,
        toStatus: status as any,
        source: 'admin',
        notes: cleanNotes,
        createdBy: adminId,
      },
    })

    await this.audit.log({
      adminId,
      action: 'ORDER_STATUS_CHANGED',
      entityType: 'order',
      entityId: orderId,
      changes: { before: { status: order.status }, after: { status } },
      ipAddress,
    })

    // Emit event so email listener sends status-update email
    this.eventEmitter.emit('order.status_changed', {
      orderId,
      orderNumber: order.orderNumber,
      fromStatus: order.status,
      toStatus: status,
      correlationId: `admin-${adminId}`,
    })

    return updated
  }

  async cancelWithRefund(orderId: string, reason: string, adminId: string, ipAddress: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        payment: true,
        items: { select: { id: true, variantId: true, quantity: true } },
        user: { select: { id: true, email: true, firstName: true, preferredLang: true } },
      },
    })
    if (!order) throw new NotFoundException('Order not found')
    if (order.status === 'cancelled' || order.status === 'refunded') {
      throw new BadRequestException('Order is already cancelled or refunded')
    }

    // 1. Cancel order status + audit log
    await this.updateStatus(orderId, 'cancelled', reason, adminId, ipAddress)

    // 2. Refund if payment was captured → auto-creates Gutschrift (GS-XXXX)
    let refunded = false
    if (order.payment && order.payment.status === 'captured') {
      await this.prisma.order.update({ where: { id: orderId }, data: { refundStatus: 'pending' } })
      try {
        const amountCents = Math.round(Number(order.payment.amount) * 100)
        await this.paymentsService.createRefund(
          { paymentId: order.payment.id, amount: amountCents, reason },
          adminId,
          `admin-cancel-${orderId.slice(-8)}`,
        )
        refunded = true
        await this.prisma.order.update({ where: { id: orderId }, data: { refundStatus: 'succeeded', refundError: null } })
        this.logger.log(`Refund processed for cancelled order ${order.orderNumber}`)
      } catch (e: unknown) {
        const rawMsg = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e)
        const errorMsg = (rawMsg ?? 'Unknown error').slice(0, 300)
        await this.prisma.order.update({ where: { id: orderId }, data: { refundStatus: 'failed', refundError: errorMsg } })
        this.logger.error(`Refund failed for ${order.orderNumber}: ${errorMsg}`)
        try {
          await this.notificationService.create({
            // Dedicated type so the bell differentiates a refund failure
            // from a normal payment failure (same type 'payment_failed'
            // used to collapse the two in the UI).
            type: 'refund_failed',
            title: `⚠ Erstattung fehlgeschlagen: ${order.orderNumber}`,
            body: `Erstattung von €${Number(order.payment!.amount).toFixed(2)} fehlgeschlagen. Fehler: ${errorMsg.slice(0, 100)}`,
            entityType: 'order', entityId: orderId, channel: 'admin',
            data: {
              kind: 'order_full',
              orderNumber: order.orderNumber,
              orderId,
              amount: Number(order.payment!.amount),
              error: errorMsg.slice(0, 100),
            },
          })
        } catch (notifyErr) {
          this.logger.warn(`Failed to create refund-failure notification for ${order.orderNumber}: ${(notifyErr as Error).message}`)
        }
      }
    } else {
      // No payment or not captured — no refund needed
      await this.prisma.order.update({ where: { id: orderId }, data: { refundStatus: 'not_needed' } })
    }

    // 3. Release active reservations for this order.
    //
    // Historic (broken) behaviour: this block deleted stock_reservations
    // rows directly via prisma.deleteMany AND incremented inventory.
    // quantityOnHand by the item quantity. Both were wrong:
    //   - deleteMany bypassed the quantityReserved counter, causing a drift
    //     of +qty every time a pending order was cancelled (incident
    //     17.04.2026: ORD-20260417-000007 left +5 phantom-reserved on
    //     MAL-RTRTR-SCH-XS in Marzahn).
    //   - quantityOnHand-increment assumed physical stock had been removed
    //     and was now coming back. For a pre-shipment cancel that never
    //     happened — the stock sat in the warehouse the whole time. For a
    //     post-shipment cancel the customer has it, and the physical return
    //     is handled through the returns flow (not here).
    //
    // Current behaviour: delegate to ReservationService.release() which is
    // race-safe (updateMany WHERE status=RESERVED), decrements the counter
    // at the correct warehouse, logs a `released` movement, and leaves
    // quantityOnHand untouched. Post-shipment cancels naturally become a
    // no-op because reservations are already RELEASED at ship time.
    try {
      for (const item of order.items) {
        if (!item.variantId) continue
        const activeReservations = await this.prisma.stockReservation.findMany({
          where: { variantId: item.variantId, orderId, status: 'RESERVED' },
          select: { id: true },
        })
        for (const res of activeReservations) {
          if (this.reservationService) {
            await this.reservationService.release(res.id, `Order cancelled: ${order.orderNumber}`).catch((e: any) => {
              this.logger.error(`Reservation release failed for ${res.id}: ${e.message}`)
            })
          }
        }
      }
      this.logger.log(`Reservations released for cancelled order ${order.orderNumber}`)
    } catch (e: any) { this.logger.error(`Reservation release failed: ${e.message}`) }

    // 3b. Post-payment restock (R9).
    //
    // When the order was paid and captured, confirm() already decremented
    // quantityOnHand at capture time. The release() loop above is a no-op
    // for CONFIRMED reservations (WHERE status='RESERVED' matches nothing).
    // Without this explicit restock, the stock would silently vanish.
    //
    // Gated by refunded=true to avoid putting stock back on the shelf while
    // customer money is still being held. If the refund retry later succeeds,
    // admin can manually restock via inventory-adjust or we add a follow-up
    // event here (out of scope for R9).
    //
    // Idempotent: if the webhook fires the cancel twice, the second call
    // finds zero CONFIRMED rows because the first already flipped them.
    if (refunded && this.reservationService) {
      try {
        const result = await this.reservationService.restockFromConfirmed(
          orderId,
          `Full cancel ${order.orderNumber}: ${reason}`,
          adminId,
        )
        if (result.restocked > 0) {
          this.logger.log(
            `Post-payment restock for ${order.orderNumber}: ${result.restocked} reservation(s) returned to stock`,
          )
        }
      } catch (e: any) {
        this.logger.error(`restockFromConfirmed failed for ${order.orderNumber}: ${e?.message ?? e}`)
      }
    }

    // 4. Cancel shipment if not yet shipped
    try { await this.shipmentsService.cancelShipment(orderId, `admin-cancel-${orderId.slice(-8)}`) } catch { /* ignore */ }

    // 5. Send cancellation email to customer
    try {
      const email = order.user?.email ?? order.guestEmail
      const lang = order.user?.preferredLang ?? 'de'
      if (email) {
        await this.emailService.enqueue({
          to: email, type: 'order-cancellation' as any, lang,
          data: { firstName: order.user?.firstName ?? '', orderNumber: order.orderNumber, reason, refunded },
        })
      }
    } catch (e: any) { this.logger.error(`Cancel email failed: ${e.message}`) }

    // 6. Customer notification
    try {
      if (order.userId) {
        await this.notificationService.create({
          userId: order.userId, type: 'order_cancelled', channel: 'customer',
          title: `Bestellung ${order.orderNumber} storniert`,
          body: refunded ? 'Erstattung wird bearbeitet.' : 'Bestellung wurde storniert.',
          entityType: 'order', entityId: orderId,
          data: { orderNumber: order.orderNumber, reason, refunded },
        })
      }
    } catch (e: any) { this.logger.error(`Customer notification failed: ${e.message}`) }

    // 7. Admin notification — handled by event listener (order.status_changed → notification.listener.ts)
    //    No duplicate notification needed here.

    // 8. R12 — differentiated audit entry for the cancel event.
    //
    // updateStatus() already wrote a generic ORDER_STATUS_CHANGED entry. We
    // add a second entry that distinguishes the two compliance-relevant
    // scenarios so the audit log is self-explanatory without having to
    // cross-reference the payment state:
    //   • ORDER_CANCELLED_PRE_PAYMENT  — no money moved, pure status flip
    //   • ORDER_CANCELLED_POST_PAYMENT — refund issued (or attempted), the
    //     refund row + credit note are the authoritative finance records
    //
    // A failed refund also falls into POST_PAYMENT because the intent was
    // a money-bearing cancel; the `refunded` field disambiguates success.
    try {
      const wasCaptured = order.payment?.status === 'captured'
      await this.audit.log({
        adminId,
        action: wasCaptured ? 'ORDER_CANCELLED_POST_PAYMENT' : 'ORDER_CANCELLED_PRE_PAYMENT',
        entityType: 'order',
        entityId: orderId,
        changes: {
          after: {
            orderNumber: order.orderNumber,
            reason,
            refunded,
            paymentWas: order.payment?.status ?? null,
            refundAmount: wasCaptured ? Number(order.payment!.amount) : 0,
          },
        },
        ipAddress,
      })
    } catch (e: any) {
      this.logger.error(`Audit (cancel-differentiated): ${e?.message ?? e}`)
    }

    return { cancelled: true, refunded }
  }

  async retryRefund(orderId: string, adminId: string, ipAddress: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null, status: 'cancelled' },
      include: { payment: true },
    })
    if (!order) throw new NotFoundException('Cancelled order not found')
    if (!order.payment || order.payment.status !== 'captured') throw new BadRequestException('No captured payment to refund')
    if (order.refundStatus === 'succeeded') throw new BadRequestException('Refund already processed')
    if (order.refundStatus === 'pending') throw new BadRequestException('Refund is already being processed')

    await this.prisma.order.update({ where: { id: orderId }, data: { refundStatus: 'pending', refundError: null } })

    try {
      const amountCents = Math.round(Number(order.payment.amount) * 100)
      await this.paymentsService.createRefund(
        { paymentId: order.payment.id, amount: amountCents, reason: 'Retry: ' + (order.cancelReason ?? 'Admin cancellation') },
        adminId,
        `retry-refund-${orderId}`,  // Fixed idempotency key — Stripe deduplicates same refund
      )
      await this.prisma.order.update({ where: { id: orderId }, data: { refundStatus: 'succeeded', refundError: null } })
      await this.audit.log({ adminId, action: 'REFUND_RETRY_SUCCEEDED', entityType: 'order', entityId: orderId, changes: { after: { amount: Number(order.payment.amount) } }, ipAddress })
      return { success: true, amount: Number(order.payment.amount) }
    } catch (e: any) {
      const errorMsg = e.message?.slice(0, 300) ?? 'Unknown error'
      await this.prisma.order.update({ where: { id: orderId }, data: { refundStatus: 'failed', refundError: errorMsg } })
      await this.audit.log({ adminId, action: 'REFUND_RETRY_FAILED', entityType: 'order', entityId: orderId, changes: { after: { error: errorMsg } }, ipAddress })
      return { success: false, error: errorMsg }
    }
  }

  async markRefundManual(orderId: string, adminId: string, ipAddress: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, deletedAt: null, status: 'cancelled' } })
    if (!order) throw new NotFoundException('Cancelled order not found')
    await this.prisma.order.update({ where: { id: orderId }, data: { refundStatus: 'succeeded', refundError: null } })
    await this.audit.log({ adminId, action: 'REFUND_MARKED_MANUAL', entityType: 'order', entityId: orderId, changes: { after: { manualRefund: true } }, ipAddress })
    return { success: true }
  }

  // ── Partial Cancel — storniere einzelne Artikel ────────────
  async cancelItems(orderId: string, itemIds: string[], reason: string, adminId: string, ipAddress: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        items: true,
        payment: true,
        user: { select: { id: true, email: true, firstName: true, preferredLang: true } },
      },
    })
    if (!order) throw new NotFoundException('Order not found')
    if (order.status === 'cancelled' || order.status === 'refunded') {
      throw new NotFoundException({ message: { de: 'Bestellung bereits storniert', en: 'Order already cancelled', ar: 'الطلب ملغى بالفعل' } })
    }

    // Find the items to cancel
    const itemsToCancel = order.items.filter((i: any) => itemIds.includes(i.id))
    if (itemsToCancel.length === 0) {
      throw new NotFoundException({ message: { de: 'Keine gültigen Artikel ausgewählt', en: 'No valid items selected', ar: 'لم يتم اختيار عناصر صالحة' } })
    }

    // If ALL items are being cancelled, do a full cancel instead
    if (itemsToCancel.length === order.items.length) {
      return this.cancelWithRefund(orderId, reason, adminId, ipAddress)
    }

    // Calculate refund amount via the proportional helper.
    //
    // cancelItems is partial by definition — the full-items case is caught
    // by the earlier redirect to cancelWithRefund(). So isFullReturn=false.
    // The helper scales the item totals against order.subtotal and applies
    // them to (totalAmount − shippingCost), correctly handling coupons
    // that the old `sum(totalPrice)` code silently ignored. That bug was
    // what caused the Stripe "amount exceeds captured" rejection.
    const refundAmount = calculateProportionalRefund({
      returnedItems: itemsToCancel.map((item: any) => ({
        unitPrice: Number(item.unitPrice),
        quantity: item.quantity,
      })),
      order: {
        subtotal: Number(order.subtotal),
        totalAmount: Number(order.totalAmount),
        shippingCost: Number(order.shippingCost),
      },
      isFullReturn: false,
    })
    const refundAmountCents = Math.round(refundAmount * 100)

    // 1. Mark items as cancelled (set quantity to 0 and store original)
    for (const item of itemsToCancel) {
      await this.prisma.orderItem.update({
        where: { id: item.id },
        data: { quantity: 0, totalPrice: 0 },
      })
    }

    // 2. Update order totals
    const remainingItems = order.items.filter((i: any) => !itemIds.includes(i.id))
    const newSubtotal = remainingItems.reduce((sum: number, i: any) => sum + Number(i.totalPrice), 0)
    const newTax = newSubtotal * 0.19
    const newTotal = newSubtotal + Number(order.shippingCost) + newTax
    await this.prisma.order.update({
      where: { id: orderId },
      data: { subtotal: newSubtotal, taxAmount: newTax, totalAmount: newTotal, discountAmount: Number(order.discountAmount) },
    })

    // 3. Partial refund via Stripe → auto-creates Gutschrift (GS-XXXX)
    let refunded = false
    if (order.payment && order.payment.status === 'captured' && refundAmountCents > 0) {
      try {
        await this.paymentsService.createRefund(
          { paymentId: order.payment.id, amount: refundAmountCents, reason: `Partial cancel: ${reason}` },
          adminId,
          `partial-cancel-${orderId.slice(-8)}-${Date.now()}`,
        )
        refunded = true
      } catch (e: any) {
        this.logger.error(`Partial refund failed: ${e.message}`)
        try {
          await this.notificationService.create({
            type: 'refund_failed',
            title: `⚠ Teilerstattung fehlgeschlagen: ${order.orderNumber}`,
            body: `Teilstornierung durchgeführt, aber Erstattung von €${(refundAmountCents / 100).toFixed(2)} konnte nicht durchgeführt werden. Bitte manuell erstatten. Fehler: ${e.message?.slice(0, 100)}`,
            entityType: 'order', entityId: orderId, channel: 'admin',
            data: {
              kind: 'order_partial',
              orderNumber: order.orderNumber,
              orderId,
              amount: refundAmountCents / 100,
              error: (e.message ?? '').slice(0, 100),
            },
          })
        } catch {}
      }
    }

    // 4. Release reservations for the cancelled items only.
    //
    // Same fix as cancelWithRefund (see the detailed comment block there):
    // delegate to ReservationService.release() to avoid the
    // deleteMany+increment bug pair. For partial cancels, the reservation
    // row of each item's variant is released entirely — this matches the
    // existing semantic because reservations are stored per
    // (variant, warehouse, order) tuple: one row represents all units of
    // that variant in the order, and when the admin partially cancels, the
    // cart-line-level quantities are what actually get refunded above.
    // If the order happens to have multiple order_items pointing at the
    // same variant (rare — the cart merges them), the release still
    // happens once per unique variant.
    try {
      for (const item of itemsToCancel) {
        if (!item.variantId) continue
        const activeReservations = await this.prisma.stockReservation.findMany({
          where: { variantId: item.variantId, orderId, status: 'RESERVED' },
          select: { id: true },
        })
        for (const res of activeReservations) {
          if (this.reservationService) {
            await this.reservationService.release(res.id, `Partial cancel: ${order.orderNumber} — ${reason}`).catch((e: any) => {
              this.logger.error(`Reservation release failed for ${res.id}: ${e.message}`)
            })
          }
        }
      }
    } catch (e: any) { this.logger.error(`Partial reservation release failed: ${e.message}`) }

    // 4b. Post-payment restock for cancelled variants only (R9).
    //
    // See the detailed comment block in cancelWithRefund(). For partial
    // cancels we pass a variantIds filter so only the specific variants
    // being cancelled are restocked — other items in the order that are
    // still shipping stay CONFIRMED.
    //
    // A single order_item represents one (variant, warehouse) reservation
    // — if the same variant appears across multiple cart lines the DB
    // merged them, so this set naturally includes every reservation that
    // needs to be reversed.
    if (refunded && this.reservationService) {
      try {
        const variantIds = itemsToCancel
          .map((i: any) => i.variantId)
          .filter((v: string | null | undefined): v is string => !!v)
        if (variantIds.length > 0) {
          const result = await this.reservationService.restockFromConfirmed(
            orderId,
            `Partial cancel ${order.orderNumber}: ${reason}`,
            adminId,
            variantIds,
          )
          if (result.restocked > 0) {
            this.logger.log(
              `Post-payment partial restock for ${order.orderNumber}: ${result.restocked} reservation(s) returned to stock`,
            )
          }
        }
      } catch (e: any) {
        this.logger.error(`Partial restockFromConfirmed failed for ${order.orderNumber}: ${e?.message ?? e}`)
      }
    }

    // 5. Customer email
    try {
      const email = order.user?.email ?? order.guestEmail
      const lang = order.user?.preferredLang ?? 'de'
      if (email) {
        const itemNames = itemsToCancel.map((i: any) => i.snapshotName).join(', ')
        await this.emailService.enqueue({
          to: email, type: 'order-status' as any, lang,
          data: { firstName: order.user?.firstName ?? '', orderNumber: order.orderNumber, status: 'partial_cancel', itemNames, refundAmount: refundAmount.toFixed(2), reason },
        })
      }
    } catch (e: any) { this.logger.error(`Partial cancel email failed: ${e.message}`) }

    // 6. Notifications
    try {
      if (order.userId) {
        await this.notificationService.create({
          userId: order.userId, type: 'order_cancelled', channel: 'customer',
          title: `Artikel aus Bestellung ${order.orderNumber} storniert`,
          body: `${itemsToCancel.length} Artikel storniert — €${refundAmount.toFixed(2)} Erstattung`,
          entityType: 'order', entityId: orderId,
        })
      }
      await this.notificationService.createForAllAdmins({
        // Dedicated type so the admin bell renders a locale-aware title/body
        // ("Teilstornierung" differs semantically from a full cancellation).
        type: 'order_partial_cancelled',
        title: `Teilstornierung ${order.orderNumber}`,
        body: `${itemsToCancel.length} von ${order.items.length} Artikel storniert — €${refundAmount.toFixed(2)}`,
        entityType: 'order', entityId: orderId,
        data: {
          orderNumber: order.orderNumber,
          orderId,
          itemsCancelled: itemsToCancel.length,
          itemsTotal: order.items.length,
          refundAmount,
        },
      })
    } catch (e: any) { this.logger.error(`Notification failed: ${e.message}`) }

    // 7. Audit log
    try {
      await this.audit.log({
        adminId, action: 'ORDER_PARTIAL_CANCEL', entityType: 'order', entityId: orderId,
        changes: { before: { itemCount: order.items.length }, after: { cancelledItems: itemIds, refundAmount, reason } },
        ipAddress,
      })
    } catch (e: any) { this.logger.error(`Audit failed: ${e.message}`) }

    return { cancelled: true, refunded, cancelledItems: itemIds.length, refundAmount: refundAmount.toFixed(2) }
  }

  async addNote(orderId: string, content: string, adminId: string) {
    return this.prisma.adminNote.create({
      data: { orderId, adminId, content },
    })
  }
}
