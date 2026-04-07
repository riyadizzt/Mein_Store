import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../../prisma/prisma.service'
import { NotificationService } from '../services/notification.service'

/**
 * Automatic cleanup of orders that were created but never paid.
 * Runs every 15 minutes. Finds orders with status "pending" that are older than
 * 30 minutes with NO successful payment. Cancels them, releases reserved stock,
 * logs to audit, and notifies admins.
 *
 * DOES NOT: create refunds (nothing was paid), send customer emails, touch any
 * other order status besides "pending".
 */
@Injectable()
export class PaymentTimeoutCron {
  private readonly logger = new Logger(PaymentTimeoutCron.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron('*/15 * * * *') // Every 15 minutes
  async cleanupTimedOutOrders() {
    const cutoff = new Date()
    cutoff.setMinutes(cutoff.getMinutes() - 30)

    // Find pending orders older than 30 minutes with no successful payment
    const staleOrders = await this.prisma.order.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: cutoff },
        deletedAt: null,
      },
      include: {
        payment: { select: { status: true } },
        items: { select: { variantId: true, quantity: true } },
      },
      take: 50,
    })

    // Filter: only orders with NO successful payment
    const unpaidOrders = staleOrders.filter((o) =>
      !o.payment || !['captured', 'authorized'].includes(o.payment.status),
    )

    if (unpaidOrders.length === 0) return

    this.logger.log(`Found ${unpaidOrders.length} stale pending orders — cleaning up...`)

    let cancelledCount = 0
    const cancelledNumbers: string[] = []

    for (const order of unpaidOrders) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // 1. Cancel the order
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'cancelled',
              cancelledAt: new Date(),
              cancelReason: 'Zahlungstimeout — automatisch storniert',
            },
          })

          // 2. Release reserved stock — only for RESERVED status reservations
          //    (EXPIRED ones were already released by releaseExpired() scheduler)
          for (const item of order.items) {
            if (!item.variantId) continue

            // Find ONLY active reservations (status=RESERVED) for this order+variant
            const reservations = await tx.stockReservation.findMany({
              where: { variantId: item.variantId, orderId: order.id, status: 'RESERVED' },
            })

            for (const res of reservations) {
              // Update status to RELEASED (don't hard-delete — keep audit trail)
              await tx.stockReservation.update({
                where: { id: res.id },
                data: { status: 'RELEASED' },
              })

              // Decrement reserved quantity on the CORRECT warehouse
              const inv = await tx.inventory.findFirst({
                where: { variantId: item.variantId, warehouseId: res.warehouseId },
              })
              if (inv && inv.quantityReserved > 0) {
                const decrementBy = Math.min(res.quantity, inv.quantityReserved)
                if (decrementBy > 0) {
                  await tx.inventory.update({
                    where: { id: inv.id },
                    data: { quantityReserved: { decrement: decrementBy } },
                  })
                }
              }
            }

            // Also mark any EXPIRED/CONFIRMED reservations as RELEASED (cleanup)
            await tx.stockReservation.updateMany({
              where: { variantId: item.variantId, orderId: order.id, status: { in: ['EXPIRED'] } },
              data: { status: 'RELEASED' },
            })
          }

          // 3. Create order status history
          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              fromStatus: 'pending',
              toStatus: 'cancelled',
              source: 'system',
              notes: 'Zahlungstimeout — automatisch storniert',
              createdBy: 'system',
            },
          })
        })

        // 4. Audit log (outside transaction — non-critical)
        await this.prisma.adminAuditLog.create({
          data: {
            adminId: 'system',
            action: 'ORDER_AUTO_CANCELLED',
            entityType: 'order',
            entityId: order.id,
            changes: { after: { orderNumber: order.orderNumber, reason: 'payment_timeout', itemCount: order.items.length } },
            ipAddress: '::system',
          },
        })

        cancelledCount++
        cancelledNumbers.push(order.orderNumber)
        this.logger.log(`Auto-cancelled ${order.orderNumber} (payment timeout)`)
      } catch (err: any) {
        this.logger.error(`Failed to auto-cancel ${order.orderNumber}: ${err.message}`)
      }
    }

    // 5. Admin notification (summary)
    if (cancelledCount > 0) {
      try {
        await this.notifications.create({
          type: 'order_cancelled',
          title: `${cancelledCount} Bestellung${cancelledCount > 1 ? 'en' : ''} automatisch storniert`,
          body: `Zahlungstimeout: ${cancelledNumbers.join(', ')}`,
          entityType: 'order',
          channel: 'admin',
        })
      } catch (err: any) {
        this.logger.error(`Failed to create notification: ${err.message}`)
      }
    }

    this.logger.log(`Payment timeout cleanup done: ${cancelledCount}/${unpaidOrders.length} cancelled`)
  }
}
