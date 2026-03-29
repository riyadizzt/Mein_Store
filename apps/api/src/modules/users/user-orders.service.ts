import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { OrderHistoryQueryDto } from './dto/order-history.dto'

interface Cursor {
  id: string
  createdAt: string
}

@Injectable()
export class UserOrdersService {
  constructor(private readonly prisma: PrismaService) {}

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

    const orders = await this.prisma.order.findMany({
      where: {
        userId,
        deletedAt: null,
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
        shippingAddress: true,
        payment: true,
        shipment: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
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
   * Invoice PDF stub — returns download URL.
   * Full PDF generation with pdfkit/puppeteer to be implemented in Payments phase.
   */
  async getInvoiceUrl(userId: string, orderId: string): Promise<{ url: string }> {
    const order = await this.findOne(userId, orderId)

    // TODO: generate and upload PDF to Cloudinary/S3
    // For now return a placeholder
    return {
      url: `/api/invoices/${order.orderNumber}.pdf`,
    }
  }
}
