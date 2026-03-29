import { Injectable, NotFoundException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from './audit.service'
import { PaymentsService } from '../../payments/payments.service'
import { ShipmentsService } from '../../shipments/shipments.service'

@Injectable()
export class AdminOrdersService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
      include: { payment: true },
    })
    if (!order) throw new NotFoundException('Order not found')

    // Cancel order
    await this.updateStatus(orderId, 'cancelled', reason, adminId, ipAddress)

    // Refund if payment was captured
    if (order.payment && order.payment.status === 'captured') {
      const amountCents = Math.round(Number(order.payment.amount) * 100)
      await this.paymentsService.createRefund(
        { paymentId: order.payment.id, amount: amountCents, reason },
        adminId,
        `admin-cancel-${orderId.slice(-8)}`,
      )
    }

    // Cancel shipment if not yet shipped
    await this.shipmentsService.cancelShipment(orderId, `admin-cancel-${orderId.slice(-8)}`).catch(() => {})

    return { cancelled: true, refunded: !!order.payment }
  }

  async addNote(orderId: string, content: string, adminId: string) {
    return this.prisma.adminNote.create({
      data: { orderId, adminId, content },
    })
  }
}
