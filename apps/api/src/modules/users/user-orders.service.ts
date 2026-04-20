import { Injectable, NotFoundException, forwardRef, Inject } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { OrderHistoryQueryDto } from './dto/order-history.dto'
import { AdminReturnsService } from '../admin/services/admin-returns.service'

interface Cursor {
  id: string
  createdAt: string
}

@Injectable()
export class UserOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AdminReturnsService)) private readonly returnsService: AdminReturnsService,
  ) {}

  async getOrderHistory(userId: string, query: OrderHistoryQueryDto) {
    const limit = query.limit ?? 20
    let cursorWhere = {}

    if (query.cursor) {
      const decoded = JSON.parse(
        Buffer.from(query.cursor, 'base64').toString('utf-8'),
      ) as Cursor
      cursorWhere = {
        OR: [
          { createdAt: { lt: new Date(decoded.createdAt) } },
          { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
        ],
      }
    }

    // Bucket filter — keeps "wartet auf Zahlung" orders out of the normal
    // history tab so customers don't see half-finished checkouts mixed with
    // their real purchases.
    const PENDING_STATUSES = ['pending', 'pending_payment'] as any
    const bucket = query.bucket ?? 'all'
    const statusFilter: any =
      bucket === 'waiting_payment'
        ? { status: { in: PENDING_STATUSES } }
        : bucket === 'active'
          ? { status: { notIn: PENDING_STATUSES } }
          : {}

    const orders = await this.prisma.order.findMany({
      where: {
        userId,
        deletedAt: null,
        ...statusFilter,
        ...cursorWhere,
      },
      include: {
        items: {
          include: {
            variant: {
              select: {
                sku: true,
                color: true,
                size: true,
                product: {
                  select: {
                    translations: { select: { language: true, name: true } },
                    images: {
                      where: { isPrimary: true },
                      select: { url: true },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
        shippingAddress: {
          select: {
            firstName: true,
            lastName: true,
            street: true,
            houseNumber: true,
            city: true,
            postalCode: true,
            country: true,
          },
        },
        payment: { select: { method: true, status: true } },
        shipment: { select: { status: true, trackingNumber: true, trackingUrl: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // fetch one extra to detect if there's a next page
    })

    const hasNextPage = orders.length > limit
    const items = hasNextPage ? orders.slice(0, limit) : orders

    let nextCursor: string | null = null
    if (hasNextPage) {
      const last = items[items.length - 1]
      nextCursor = Buffer.from(
        JSON.stringify({ id: last.id, createdAt: last.createdAt.toISOString() }),
      ).toString('base64')
    }

    return { items, nextCursor, hasNextPage }
  }

  async findOne(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId, deletedAt: null },
      include: {
        items: {
          include: {
            variant: {
              select: {
                sku: true,
                color: true,
                size: true,
                product: {
                  select: {
                    slug: true,
                    translations: { select: { language: true, name: true } },
                    images: {
                      select: { url: true, colorName: true, isPrimary: true },
                      orderBy: { sortOrder: 'asc' },
                    },
                  },
                },
              },
            },
          },
        },
        shippingAddress: true,
        // Include payment.refunds so the customer order-detail can show a
        // green "Refund" line for admin-initiated partial cancels. Returns
        // have their own refundAmount via the returns[] array; admin
        // cancelItems creates a Refund row but no Return row, so without
        // this the customer saw their ORD-20260420-000001 as "total €305"
        // with no indication that €9480 had been refunded.
        payment: { include: { refunds: true } },
        shipment: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
        returns: {
          select: {
            id: true,
            returnNumber: true,
            status: true,
            reason: true,
            refundAmount: true,
            returnItems: true,
            adminNotes: true,
            returnLabelUrl: true,
            createdAt: true,
            refundedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!order) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'OrderNotFound',
        message: {
          de: 'Bestellung nicht gefunden.',
          en: 'Order not found.',
          ar: 'الطلب غير موجود.',
        },
      })
    }

    return order
  }

  /**
   * Returns a prefilled CreateOrderDto from a past order.
   * Prices are current (not historical) — user confirms at checkout.
   */
  async reorder(userId: string, orderId: string) {
    const order = await this.findOne(userId, orderId)

    return {
      items: order.items.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
        // warehouseId will be auto-selected at checkout
      })),
      shippingAddressId: order.shippingAddressId,
      couponCode: order.couponCode,
      // Note: prices shown are CURRENT prices, not historical
      _reorderedFrom: order.orderNumber,
    }
  }

  /**
   * Returns the customer-facing download URL for the invoice PDF.
   * The actual PDF is streamed by the payments controller (GET /payments/orders/:id/invoice),
   * which is what the web client already calls. We return that URL here so any caller of
   * this legacy endpoint also gets a real, working download link instead of a broken placeholder.
   */
  async getInvoiceUrl(userId: string, orderId: string): Promise<{ url: string }> {
    // Authorization check: ensures the customer owns the order.
    await this.findOne(userId, orderId)
    return {
      url: `/api/v1/payments/orders/${orderId}/invoice`,
    }
  }

  async getReturnLabelPdf(userId: string, orderId: string, type: string = 'internal'): Promise<Buffer> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId, deletedAt: null },
      include: { returns: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    if (!order || !order.returns[0]) {
      throw new NotFoundException({ message: { de: 'Retoure nicht gefunden.', en: 'Return not found.', ar: 'المرتجع غير موجود.' } })
    }

    const ret = order.returns[0]

    // DHL shipping label — stored as file in storage/labels/
    if (type === 'dhl' && ret.returnTrackingNumber) {
      const fs = await import('fs')
      const path = await import('path')
      const labelPath = path.join(process.cwd(), 'storage', 'labels', `RET-${ret.returnTrackingNumber}.pdf`)
      if (fs.existsSync(labelPath)) {
        return fs.readFileSync(labelPath)
      }
      // DHL label not found on disk — throw helpful error
      throw new NotFoundException({ message: { de: 'DHL-Label nicht gefunden.', en: 'DHL label not found.', ar: 'ملصق DHL غير موجود.' } })
    }

    // Internal barcode label (Retourenetikett)
    return this.returnsService.generateReturnLabel(ret.id)
  }
}
