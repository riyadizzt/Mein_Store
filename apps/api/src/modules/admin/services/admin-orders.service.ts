import { Injectable, Logger, NotFoundException } from '@nestjs/common'
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
    dateFrom?: string
    dateTo?: string
    search?: string
    limit?: number
    cursor?: string
  }) {
    const limit = query.limit ?? 20
    const where: any = { deletedAt: null }

    if (query.status) where.status = query.status
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
              select: { sku: true, color: true, size: true, product: { select: { translations: true } } },
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

  async changeFulfillmentWarehouse(orderId: string, newWarehouseId: string, adminId: string, ipAddress: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { items: true },
    })
    if (!order) throw new NotFoundException('Order not found')

    const oldWarehouseId = order.fulfillmentWarehouseId

    // If same warehouse, nothing to do
    if (oldWarehouseId === newWarehouseId) return { changed: false }

    // Move stock: reverse from old warehouse, deduct from new warehouse
    if (oldWarehouseId) {
      for (const item of order.items) {
        // Add back to old warehouse
        await this.prisma.inventory.updateMany({
          where: { variantId: item.variantId, warehouseId: oldWarehouseId },
          data: { quantityOnHand: { increment: item.quantity } },
        })
        // Deduct from new warehouse
        await this.prisma.inventory.updateMany({
          where: { variantId: item.variantId, warehouseId: newWarehouseId },
          data: { quantityOnHand: { decrement: item.quantity } },
        })
      }
    }

    // Update order
    await this.prisma.order.update({
      where: { id: orderId },
      data: { fulfillmentWarehouseId: newWarehouseId },
    })

    // Get warehouse name for audit
    const wh = await this.prisma.warehouse.findUnique({ where: { id: newWarehouseId }, select: { name: true } })

    await this.audit.log({
      adminId, action: 'ORDER_FULFILLMENT_CHANGED', entityType: 'order', entityId: orderId,
      changes: { before: { warehouseId: oldWarehouseId }, after: { warehouseId: newWarehouseId, name: wh?.name } },
      ipAddress,
    })

    return { changed: true, warehouseName: wh?.name }
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

    // 1. Cancel order status + audit log
    await this.updateStatus(orderId, 'cancelled', reason, adminId, ipAddress)

    // 2. Refund if payment was captured → auto-creates Gutschrift (GS-XXXX)
    let refunded = false
    if (order.payment && order.payment.status === 'captured') {
      try {
        const amountCents = Math.round(Number(order.payment.amount) * 100)
        await this.paymentsService.createRefund(
          { paymentId: order.payment.id, amount: amountCents, reason },
          adminId,
          `admin-cancel-${orderId.slice(-8)}`,
        )
        refunded = true
        this.logger.log(`Refund processed for cancelled order ${order.orderNumber}`)
      } catch (e: any) { this.logger.error(`Refund failed for ${order.orderNumber}: ${e.message}`) }
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

    // 7. Admin notification
    try {
      await this.notificationService.createForAllAdmins({
        type: 'order_cancelled', title: `Bestellung ${order.orderNumber} storniert`,
        body: `${refunded ? 'Erstattung ausgelöst' : 'Ohne Erstattung'} — Grund: ${reason}`,
        entityType: 'order', entityId: orderId,
        data: { orderNumber: order.orderNumber, reason, refunded, adminId },
      })
    } catch (e: any) { this.logger.error(`Admin notification failed: ${e.message}`) }

    return { cancelled: true, refunded }
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
      } catch (e: any) { this.logger.error(`Partial refund failed: ${e.message}`) }
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
