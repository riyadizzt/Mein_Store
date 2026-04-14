import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from './audit.service'
import { NotificationService } from './notification.service'
import { PaymentsService } from '../../payments/payments.service'
import { ShipmentsService } from '../../shipments/shipments.service'
import { EmailService } from '../../email/email.service'

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

  async findOne(orderId: string) {
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

    // Include admin notes
    const notes = await this.prisma.adminNote.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    })

    return { ...order, adminNotes: notes }
  }

  async changeFulfillmentWarehouse(orderId: string, newWarehouseId: string, adminId: string, ipAddress: string, force = false) {
    // 1. Validate order exists and is in a changeable status
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { items: { select: { id: true, variantId: true, quantity: true } } },
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

    // 3. Check stock availability in the new warehouse for each item
    const stockWarnings: string[] = []
    for (const item of order.items) {
      if (!item.variantId) continue
      const inv = await this.prisma.inventory.findFirst({ where: { variantId: item.variantId, warehouseId: newWarehouseId } })
      const available = inv ? inv.quantityOnHand - inv.quantityReserved : 0
      if (available < item.quantity) {
        stockWarnings.push(`Variante ${item.variantId}: verfügbar ${available}, benötigt ${item.quantity}`)
      }
    }
    if (stockWarnings.length > 0 && !force) {
      return { changed: false, needsConfirmation: true, warnings: stockWarnings, warehouseName: newWarehouse.name }
    }

    // 4. Move ALL reservations for this order to the new warehouse — regardless of which warehouse they are currently in
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

    // 5. Audit log (outside transaction — non-critical)
    await this.audit.log({
      adminId, action: 'ORDER_FULFILLMENT_CHANGED', entityType: 'order', entityId: orderId,
      changes: { before: { warehouseId: oldWarehouseId }, after: { warehouseId: newWarehouseId, name: newWarehouse.name } },
      ipAddress,
    })

    return { changed: true, warehouseName: newWarehouse.name }
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
            type: 'payment_failed',
            title: `⚠ Erstattung fehlgeschlagen: ${order.orderNumber}`,
            body: `Erstattung von €${Number(order.payment!.amount).toFixed(2)} fehlgeschlagen. Fehler: ${errorMsg.slice(0, 100)}`,
            entityType: 'order', entityId: orderId, channel: 'admin',
          })
        } catch (notifyErr) {
          this.logger.warn(`Failed to create refund-failure notification for ${order.orderNumber}: ${(notifyErr as Error).message}`)
        }
      }
    } else {
      // No payment or not captured — no refund needed
      await this.prisma.order.update({ where: { id: orderId }, data: { refundStatus: 'not_needed' } })
    }

    // 3. Restock inventory — release reservations + return items to stock
    try {
      for (const item of order.items) {
        if (!item.variantId) continue
        // Release any reservations
        await this.prisma.stockReservation.deleteMany({ where: { variantId: item.variantId, orderId } })
        // Find inventory and restock
        const inv = await this.prisma.inventory.findFirst({ where: { variantId: item.variantId }, orderBy: { quantityOnHand: 'desc' } })
        if (inv) {
          await this.prisma.inventory.update({ where: { id: inv.id }, data: { quantityOnHand: { increment: item.quantity } } })
          await this.prisma.inventoryMovement.create({
            data: {
              variantId: item.variantId, warehouseId: inv.warehouseId,
              type: 'return_received', quantity: item.quantity,
              quantityBefore: inv.quantityOnHand, quantityAfter: inv.quantityOnHand + item.quantity,
              notes: `Order cancelled: ${order.orderNumber}`, createdBy: adminId,
            },
          })
        }
      }
      this.logger.log(`Inventory restocked for cancelled order ${order.orderNumber}`)
    } catch (e: any) { this.logger.error(`Inventory restock failed: ${e.message}`) }

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

    // Calculate refund amount (only cancelled items)
    const refundAmount = itemsToCancel.reduce((sum: number, item: any) => sum + Number(item.totalPrice), 0)
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
            type: 'payment_failed',
            title: `⚠ Teilerstattung fehlgeschlagen: ${order.orderNumber}`,
            body: `Teilstornierung durchgeführt, aber Erstattung von €${(refundAmountCents / 100).toFixed(2)} konnte nicht durchgeführt werden. Bitte manuell erstatten. Fehler: ${e.message?.slice(0, 100)}`,
            entityType: 'order', entityId: orderId, channel: 'admin',
          })
        } catch {}
      }
    }

    // 4. Restock cancelled items
    try {
      for (const item of itemsToCancel) {
        if (!item.variantId) continue
        await this.prisma.stockReservation.deleteMany({ where: { variantId: item.variantId, orderId } })
        const inv = await this.prisma.inventory.findFirst({ where: { variantId: item.variantId }, orderBy: { quantityOnHand: 'desc' } })
        if (inv) {
          await this.prisma.inventory.update({ where: { id: inv.id }, data: { quantityOnHand: { increment: item.quantity } } })
          await this.prisma.inventoryMovement.create({
            data: {
              variantId: item.variantId, warehouseId: inv.warehouseId,
              type: 'return_received', quantity: item.quantity,
              quantityBefore: inv.quantityOnHand, quantityAfter: inv.quantityOnHand + item.quantity,
              notes: `Partial cancel: ${order.orderNumber} — ${reason}`, createdBy: adminId,
            },
          })
        }
      }
    } catch (e: any) { this.logger.error(`Partial restock failed: ${e.message}`) }

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
        type: 'order_cancelled', title: `Teilstornierung ${order.orderNumber}`,
        body: `${itemsToCancel.length} von ${order.items.length} Artikel storniert — €${refundAmount.toFixed(2)}`,
        entityType: 'order', entityId: orderId,
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
