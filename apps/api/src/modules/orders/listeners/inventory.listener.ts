import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { ReservationService } from '../../inventory/reservation.service'
import {
  ORDER_EVENTS,
  OrderCreatedEvent,
  OrderCancelledEvent,
  OrderConfirmedEvent,
} from '../events/order.events'

@Injectable()
export class InventoryListener {
  private readonly logger = new Logger(InventoryListener.name)

  constructor(private readonly reservationService: ReservationService) {}

  // ── Bestellung erstellt → Bestand reservieren ────────────────
  //
  // COMPENSATION LOGIC: Wenn Item N fehlschlägt, werden alle
  // erfolgreich reservierten Items 0..N-1 wieder freigegeben.
  // Bei Fehler wird die Exception zur emitAsync() hochgereicht.

  @OnEvent(ORDER_EVENTS.CREATED, { async: true })
  async handleOrderCreated(event: OrderCreatedEvent): Promise<string[]> {
    const { orderId, orderNumber, correlationId, items } = event
    const reservationIds: string[] = []

    this.logger.log(
      `[${correlationId}] Reservierung starten: orderId=${orderId} | ${items.length} Artikel`,
    )

    try {
      for (const item of items) {
        const reservation = await this.reservationService.reserve({
          variantId: item.variantId,
          warehouseId: item.warehouseId,
          quantity: item.quantity,
          orderId,
          sessionId: item.reservationSessionId,
        })
        reservationIds.push(reservation.id)
      }

      this.logger.log(
        `[${correlationId}] Reservierung erfolgreich: orderId=${orderId} | reservations=${reservationIds.join(',')}`,
      )

      return reservationIds
    } catch (err) {
      // ── COMPENSATION: alle bisherigen Reservierungen freigeben ─
      this.logger.warn(
        `[${correlationId}] Reservierung fehlgeschlagen für orderId=${orderId} | Compensation starten für ${reservationIds.length} Reservierung(en)`,
      )

      for (const reservationId of reservationIds) {
        try {
          await this.reservationService.release(
            reservationId,
            `compensation-rollback: order=${orderNumber}`,
          )
        } catch (releaseErr) {
          this.logger.error(
            `[${correlationId}] Compensation-Release fehlgeschlagen: reservationId=${reservationId}`,
            releaseErr,
          )
        }
      }

      throw err // Fehler hochreichen → OrdersService bricht ab
    }
  }

  // ── Bestellung bestätigt → Bestand physisch abziehen ─────────

  @OnEvent(ORDER_EVENTS.CONFIRMED, { async: true })
  async handleOrderConfirmed(event: OrderConfirmedEvent): Promise<void> {
    const { orderId, orderNumber, correlationId, reservationIds } = event

    this.logger.log(
      `[${correlationId}] Bestand bestätigen: orderId=${orderId} | reservations=${reservationIds.length}`,
    )

    for (const reservationId of reservationIds) {
      try {
        await this.reservationService.confirm(reservationId, orderId)
      } catch (err) {
        this.logger.error(
          `[${correlationId}] Confirm fehlgeschlagen: reservationId=${reservationId} | order=${orderNumber}`,
          err,
        )
        throw err
      }
    }
  }

  // ── Bestellung storniert → Bestand freigeben ─────────────────

  @OnEvent(ORDER_EVENTS.CANCELLED, { async: true })
  async handleOrderCancelled(event: OrderCancelledEvent): Promise<void> {
    const { orderId, orderNumber, correlationId, reservationIds, reason } = event

    if (reservationIds.length === 0) return

    this.logger.log(
      `[${correlationId}] Bestand freigeben nach Storno: orderId=${orderId} | reason=${reason}`,
    )

    for (const reservationId of reservationIds) {
      try {
        await this.reservationService.release(
          reservationId,
          `order-cancelled: ${reason} (${orderNumber})`,
        )
      } catch (err) {
        this.logger.error(
          `[${correlationId}] Release nach Storno fehlgeschlagen: reservationId=${reservationId}`,
          err,
        )
        // Nicht werfen — andere Reservierungen trotzdem freigeben
      }
    }
  }
}
