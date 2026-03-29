import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from './audit.service'

@Injectable()
export class AdminReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: { status?: string; search?: string; limit?: number }) {
    const where: any = {}
    if (query.status) where.status = query.status

    if (query.search) {
      where.order = {
        OR: [
          { orderNumber: { contains: query.search, mode: 'insensitive' } },
          { user: { OR: [
            { firstName: { contains: query.search, mode: 'insensitive' } },
            { lastName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ] } },
        ],
      }
    }

    return this.prisma.return.findMany({
      where,
      include: {
        order: {
          select: {
            orderNumber: true,
            totalAmount: true,
            createdAt: true,
            items: {
              select: {
                id: true,
                snapshotName: true,
                snapshotSku: true,
                quantity: true,
                unitPrice: true,
                totalPrice: true,
                variant: { select: { id: true, color: true, size: true } },
              },
            },
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
        shipment: { select: { trackingNumber: true, carrier: true, deliveredAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
    })
  }

  async findOne(id: string) {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            subtotal: true,
            shippingCost: true,
            taxAmount: true,
            createdAt: true,
            items: {
              select: {
                id: true,
                snapshotName: true,
                snapshotSku: true,
                quantity: true,
                unitPrice: true,
                totalPrice: true,
                variant: { select: { id: true, color: true, size: true, sku: true } },
              },
            },
            user: { select: { firstName: true, lastName: true, email: true, phone: true } },
            payment: { select: { provider: true, method: true, status: true, providerPaymentId: true } },
          },
        },
        shipment: { select: { trackingNumber: true, carrier: true, deliveredAt: true } },
      },
    })
    if (!ret) throw new NotFoundException('Return not found')
    return ret
  }

  async updateStatus(
    id: string,
    newStatus: string,
    notes: string | undefined,
    adminId: string,
    ip: string,
  ) {
    const ret = await this.prisma.return.findUnique({ where: { id } })
    if (!ret) throw new NotFoundException('Return not found')

    const validTransitions: Record<string, string[]> = {
      requested: ['label_sent', 'rejected'],
      label_sent: ['in_transit', 'rejected'],
      in_transit: ['received'],
      received: ['inspected'],
      inspected: ['approved', 'rejected'],
      approved: ['refunded'],
    }

    const allowed = validTransitions[ret.status] ?? []
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException({
        statusCode: 400,
        message: {
          de: `Ungültiger Statuswechsel: ${ret.status} → ${newStatus}`,
          en: `Invalid status transition: ${ret.status} → ${newStatus}`,
          ar: `انتقال حالة غير صالح: ${ret.status} → ${newStatus}`,
        },
      })
    }

    const data: any = { status: newStatus }
    if (notes) data.notes = notes
    if (newStatus === 'received') data.receivedAt = new Date()
    if (newStatus === 'inspected') data.inspectedAt = new Date()
    if (newStatus === 'refunded') data.refundedAt = new Date()

    // Auto-set refund amount on approval
    if (newStatus === 'approved') {
      const order = await this.prisma.order.findUnique({ where: { id: ret.orderId }, select: { totalAmount: true } })
      if (order) data.refundAmount = order.totalAmount
    }

    const updated = await this.prisma.return.update({ where: { id }, data })

    // Restock inventory on "received"
    if (newStatus === 'received') {
      await this.restockItems(ret.orderId)
    }

    await this.audit.log({
      adminId,
      action: `RETURN_STATUS_${newStatus.toUpperCase()}`,
      entityType: 'return',
      entityId: id,
      changes: { before: { status: ret.status }, after: { status: newStatus, notes } },
      ipAddress: ip,
    })

    return updated
  }

  async updateLabel(
    id: string,
    returnTrackingNumber: string | undefined,
    returnLabelUrl: string | undefined,
    adminId: string,
    ip: string,
  ) {
    const ret = await this.prisma.return.findUnique({ where: { id } })
    if (!ret) throw new NotFoundException('Return not found')

    const data: any = {}
    if (returnTrackingNumber !== undefined) data.returnTrackingNumber = returnTrackingNumber
    if (returnLabelUrl !== undefined) data.returnLabelUrl = returnLabelUrl

    const updated = await this.prisma.return.update({ where: { id }, data })

    await this.audit.log({
      adminId,
      action: 'RETURN_LABEL_UPDATED',
      entityType: 'return',
      entityId: id,
      changes: { after: { returnTrackingNumber, returnLabelUrl } },
      ipAddress: ip,
    })

    return updated
  }

  private async restockItems(orderId: string) {
    const items = await this.prisma.orderItem.findMany({
      where: { orderId },
      select: { variantId: true, quantity: true },
    })

    for (const item of items) {
      if (!item.variantId) continue

      // Find inventory for this variant in default warehouse
      const inv = await this.prisma.inventory.findFirst({
        where: { variantId: item.variantId },
        orderBy: { warehouse: { isDefault: 'desc' } },
      })

      if (inv) {
        await this.prisma.$transaction([
          this.prisma.inventory.update({
            where: { id: inv.id },
            data: { quantityOnHand: { increment: item.quantity } },
          }),
          this.prisma.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              warehouseId: inv.warehouseId,
              type: 'return_received',
              quantity: item.quantity,
              quantityBefore: inv.quantityOnHand,
              quantityAfter: inv.quantityOnHand + item.quantity,
              referenceId: orderId,
              notes: `Return restock for order ${orderId}`,
            },
          }),
        ])
      }
    }
  }
}
