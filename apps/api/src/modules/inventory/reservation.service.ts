import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { ReserveStockDto } from './dto/reserve-stock.dto'
import { InventoryService } from './inventory.service'

interface InventoryRow {
  id: string
  variant_id: string
  warehouse_id: string
  quantity_on_hand: number
  quantity_reserved: number
  reorder_point: number
}

@Injectable()
export class ReservationService {
  private readonly logger = new Logger(ReservationService.name)
  private readonly timeoutMinutes: number

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    config: ConfigService,
  ) {
    this.timeoutMinutes = config.get<number>('RESERVATION_TIMEOUT_MINUTES') ?? 7
  }

  // ── Reserve: SELECT FOR UPDATE ───────────────────────────────
  //
  // Pessimistic Locking garantiert: bei simultanen Requests auf
  // den letzten Artikel gewinnt exakt einer — alle anderen 409.

  async reserve(dto: ReserveStockDto) {
    const expiresAt = new Date()
    expiresAt.setMinutes(expiresAt.getMinutes() + this.timeoutMinutes)

    return this.prisma.$transaction(async (tx) => {
      // Zeile sperren — kein anderer Request kann diese Zeile
      // lesen/schreiben bis diese Transaktion committed ist
      const rows = await tx.$queryRaw<InventoryRow[]>`
        SELECT id, variant_id, warehouse_id, quantity_on_hand,
               quantity_reserved, reorder_point
        FROM inventory
        WHERE variant_id = ${dto.variantId}
          AND warehouse_id = ${dto.warehouseId}
        FOR UPDATE
      `

      if (rows.length === 0) {
        throw new NotFoundException(
          `Kein Lagerbestand für diese Variante/Lagerort-Kombination gefunden`,
        )
      }

      const row = rows[0]
      const available = row.quantity_on_hand - row.quantity_reserved

      if (available < dto.quantity) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: `Nicht genügend Bestand verfügbar`,
          available,
          requested: dto.quantity,
        })
      }

      // Reservierung atomisch erhöhen
      await tx.inventory.update({
        where: {
          variantId_warehouseId: {
            variantId: dto.variantId,
            warehouseId: dto.warehouseId,
          },
        },
        data: { quantityReserved: { increment: dto.quantity } },
      })

      // Reservierungsdatensatz anlegen
      const reservation = await tx.stockReservation.create({
        data: {
          variantId: dto.variantId,
          warehouseId: dto.warehouseId,
          orderId: dto.orderId,
          sessionId: dto.sessionId,
          quantity: dto.quantity,
          status: 'RESERVED',
          expiresAt,
        },
      })

      // Bewegungshistorie
      const newReserved = row.quantity_reserved + dto.quantity
      await tx.inventoryMovement.create({
        data: {
          variantId: dto.variantId,
          warehouseId: dto.warehouseId,
          type: 'reserved',
          quantity: dto.quantity,
          quantityBefore: row.quantity_on_hand - row.quantity_reserved,
          quantityAfter: row.quantity_on_hand - newReserved,
          referenceId: reservation.id,
          notes: `Reservierung für Session=${dto.sessionId ?? '-'} Order=${dto.orderId ?? '-'}`,
          createdBy: 'system',
        },
      })

      this.logger.log(
        `Reserviert: reservationId=${reservation.id} | qty=${dto.quantity} | expires=${expiresAt.toISOString()}`,
      )

      // Low-Stock prüfen nach Reservierung
      const newAvailable = row.quantity_on_hand - newReserved
      await this.inventoryService.checkAndAlertLowStock(
        dto.variantId,
        dto.warehouseId,
        newAvailable,
        row.reorder_point,
      )

      return reservation
    })
  }

  // ── Release: Manuell (Abbruch) ───────────────────────────────

  async release(reservationId: string, reason?: string) {
    // Use a conditional updateMany INSIDE the transaction to prevent the
    // double-release race condition. Two concurrent events can both read
    // status=RESERVED via findUnique before either writes RELEASED.
    // updateMany with { status: 'RESERVED' } filter returns count=0 if
    // the row was already flipped by a racing event → safe skip.
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.stockReservation.updateMany({
        where: { id: reservationId, status: 'RESERVED' },
        data: { status: 'RELEASED' },
      })

      // Another event already released this reservation → skip silently
      if (updated.count === 0) {
        this.logger.warn(`Release skipped (already released): reservationId=${reservationId}`)
        return
      }

      // Fetch the reservation data for the decrement + movement
      const reservation = await tx.stockReservation.findUnique({
        where: { id: reservationId },
      })
      if (!reservation) return

      await tx.inventory.update({
        where: {
          variantId_warehouseId: {
            variantId: reservation.variantId,
            warehouseId: reservation.warehouseId,
          },
        },
        data: { quantityReserved: { decrement: reservation.quantity } },
      })

      await tx.inventoryMovement.create({
        data: {
          variantId: reservation.variantId,
          warehouseId: reservation.warehouseId,
          type: 'released',
          quantity: reservation.quantity,
          referenceId: reservationId,
          notes: reason ?? 'Manuell freigegeben',
          createdBy: 'system',
        },
      })
    })

    this.logger.log(`Freigegeben: reservationId=${reservationId} | reason=${reason}`)
    return { success: true, reservationId }
  }

  // ── Confirm: Kauf abgeschlossen → SOLD ──────────────────────

  async confirm(reservationId: string, orderId: string) {
    const reservation = await this.prisma.stockReservation.findUnique({
      where: { id: reservationId },
    })

    if (!reservation) {
      throw new NotFoundException(`Reservierung "${reservationId}" nicht gefunden`)
    }

    if (reservation.status !== 'RESERVED') {
      throw new BadRequestException(
        `Reservierung hat Status "${reservation.status}" — nur RESERVED kann bestätigt werden`,
      )
    }

    const inventory = await this.prisma.inventory.findUnique({
      where: {
        variantId_warehouseId: {
          variantId: reservation.variantId,
          warehouseId: reservation.warehouseId,
        },
      },
    })

    if (!inventory) throw new NotFoundException('Lagerbestand nicht gefunden')

    const quantityBefore = inventory.quantityOnHand
    const quantityAfter = inventory.quantityOnHand - reservation.quantity

    // Hard guard against negative stock — if this triggers, an upstream component
    // has corrupted the on-hand count (e.g. duplicate confirm, parallel adjustment).
    // Block the write rather than silently going negative.
    if (quantityAfter < 0 || inventory.quantityReserved < reservation.quantity) {
      this.logger.error(
        `confirm() would produce negative stock for variantId=${reservation.variantId} warehouseId=${reservation.warehouseId}: ` +
        `onHand=${inventory.quantityOnHand} reserved=${inventory.quantityReserved} confirming=${reservation.quantity}`,
      )
      throw new ConflictException({
        statusCode: 409,
        error: 'StockUnderflow',
        message: 'Bestätigung würde negativen Lagerbestand erzeugen — abgebrochen',
        onHand: inventory.quantityOnHand,
        reserved: inventory.quantityReserved,
        requested: reservation.quantity,
      })
    }

    await this.prisma.$transaction([
      // Physisch abziehen + Reservierung aufheben
      this.prisma.inventory.update({
        where: {
          variantId_warehouseId: {
            variantId: reservation.variantId,
            warehouseId: reservation.warehouseId,
          },
        },
        data: {
          quantityOnHand: { decrement: reservation.quantity },
          quantityReserved: { decrement: reservation.quantity },
        },
      }),
      // Status CONFIRMED
      this.prisma.stockReservation.update({
        where: { id: reservationId },
        data: { status: 'CONFIRMED', orderId },
      }),
      // Bewegungshistorie
      this.prisma.inventoryMovement.create({
        data: {
          variantId: reservation.variantId,
          warehouseId: reservation.warehouseId,
          type: 'sale_online',
          quantity: -reservation.quantity,
          quantityBefore,
          quantityAfter,
          referenceId: orderId,
          notes: `Verkauf bestätigt — Reservierung ${reservationId}`,
          createdBy: 'system',
        },
      }),
    ])

    this.logger.log(
      `Bestätigt: reservationId=${reservationId} | orderId=${orderId} | qty=${reservation.quantity}`,
    )

    return { success: true, reservationId, orderId }
  }

  // ── Batch Release: Abgelaufene Reservierungen ────────────────
  // Wird vom Scheduler aufgerufen (every minute)

  async releaseExpired(): Promise<number> {
    const now = new Date()

    const expired = await this.prisma.stockReservation.findMany({
      where: { status: 'RESERVED', expiresAt: { lt: now } },
    })

    if (expired.length === 0) return 0

    let released = 0

    for (const reservation of expired) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.stockReservation.update({
            where: { id: reservation.id },
            data: { status: 'EXPIRED' },
          })

          await tx.inventory.update({
            where: {
              variantId_warehouseId: {
                variantId: reservation.variantId,
                warehouseId: reservation.warehouseId,
              },
            },
            data: { quantityReserved: { decrement: reservation.quantity } },
          })

          await tx.inventoryMovement.create({
            data: {
              variantId: reservation.variantId,
              warehouseId: reservation.warehouseId,
              type: 'released',
              quantity: reservation.quantity,
              referenceId: reservation.id,
              notes: `Automatisch freigegeben — Timeout nach ${this.timeoutMinutes} Min.`,
              createdBy: 'system:scheduler',
            },
          })
        })

        released++
      } catch (err) {
        this.logger.error(
          `Fehler beim Freigeben von Reservierung ${reservation.id}`,
          err,
        )
      }
    }

    if (released > 0) {
      this.logger.log(`Scheduler: ${released} abgelaufene Reservierung(en) freigegeben`)
    }

    return released
  }
}
