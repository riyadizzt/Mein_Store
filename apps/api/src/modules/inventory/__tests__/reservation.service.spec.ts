/**
 * ReservationService unit tests.
 *
 * Covers:
 *   - Reservation creation (happy path)
 *   - Capacity guard: 409 when not enough stock
 *   - Bug 12 regression: hard guard against negative stock in confirm()
 *   - Release / Confirm / ReleaseExpired state transitions
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { ReservationService } from '../reservation.service'
import { InventoryService } from '../inventory.service'
import { PrismaService } from '../../../prisma/prisma.service'

function buildPrisma() {
  const mock: any = {
    inventory: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    stockReservation: {
      // R13 added an out-of-transaction findUnique call after release() to
      // resolve the variantId for ISR tag invalidation. Default to null so
      // existing idempotency tests don't need to opt into the mock — the
      // resulting revalidate call is a no-op in that case.
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      // C15.3 — confirm() now uses updateMany WHERE status='RESERVED'
      // as the atomic claim. Default mock returns count: 1 (winner)
      // so happy-path tests proceed normally. Race-tests in the new
      // suite override this to count: 0 (race-loser path).
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    productVariant: {
      // R13 — revalidateProductTags resolves slugs via productVariant.findMany.
      // Default to an empty list so the helper gracefully no-ops in all
      // existing tests.
      findMany: jest.fn().mockResolvedValue([]),
    },
    inventoryMovement: { create: jest.fn() },
  }
  mock.$transaction = jest.fn().mockImplementation((fnOrArray: any) =>
    typeof fnOrArray === 'function' ? fnOrArray(mock) : Promise.all(fnOrArray),
  )
  mock.$queryRaw = jest.fn()
  return mock
}

const mockInventoryService = {
  checkAndAlertLowStock: jest.fn().mockResolvedValue(undefined),
}

const mockConfig = {
  get: jest.fn((key: string) => (key === 'RESERVATION_TIMEOUT_MINUTES' ? 7 : undefined)),
}

async function makeService(prisma: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ReservationService,
      { provide: PrismaService, useValue: prisma },
      { provide: InventoryService, useValue: mockInventoryService },
      { provide: ConfigService, useValue: mockConfig },
    ],
  }).compile()
  return module.get<ReservationService>(ReservationService)
}

describe('ReservationService', () => {
  let prisma: any

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = buildPrisma()
  })

  describe('reserve', () => {
    it('reserviert Bestand bei ausreichend verfügbar', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'inv1',
          variant_id: 'v1',
          warehouse_id: 'wh1',
          quantity_on_hand: 10,
          quantity_reserved: 2,
          reorder_point: 3,
        },
      ])
      prisma.stockReservation.create.mockResolvedValue({
        id: 'res1',
        quantity: 3,
      })

      const service = await makeService(prisma)
      const result = await service.reserve({
        variantId: 'v1',
        warehouseId: 'wh1',
        quantity: 3,
        sessionId: 's1',
      })

      expect(result.id).toBe('res1')
      expect(prisma.inventory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { quantityReserved: { increment: 3 } },
        }),
      )
    })

    it('wirft NotFoundException wenn keine Inventory-Zeile existiert', async () => {
      prisma.$queryRaw.mockResolvedValue([])

      const service = await makeService(prisma)
      await expect(
        service.reserve({ variantId: 'v_ghost', warehouseId: 'wh1', quantity: 1 }),
      ).rejects.toThrow(NotFoundException)
    })

    it('wirft ConflictException wenn nicht genug verfügbar (available < requested)', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'inv1',
          variant_id: 'v1',
          warehouse_id: 'wh1',
          quantity_on_hand: 5,
          quantity_reserved: 4, // available = 1
          reorder_point: 0,
        },
      ])

      const service = await makeService(prisma)
      await expect(
        service.reserve({ variantId: 'v1', warehouseId: 'wh1', quantity: 3 }),
      ).rejects.toThrow(ConflictException)
    })

    it('reserviert genau bis zum verfügbaren Maximum (boundary)', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'inv1',
          variant_id: 'v1',
          warehouse_id: 'wh1',
          quantity_on_hand: 5,
          quantity_reserved: 0,
          reorder_point: 0,
        },
      ])
      prisma.stockReservation.create.mockResolvedValue({ id: 'res-edge', quantity: 5 })

      const service = await makeService(prisma)
      await expect(
        service.reserve({ variantId: 'v1', warehouseId: 'wh1', quantity: 5 }),
      ).resolves.toBeDefined()
    })
  })

  describe('confirm — Bug 12 regression: negative stock guard', () => {
    it('wirft ConflictException StockUnderflow wenn quantityOnHand zu klein wäre', async () => {
      prisma.stockReservation.findUnique.mockResolvedValue({
        id: 'res1',
        variantId: 'v1',
        warehouseId: 'wh1',
        quantity: 5,
        status: 'RESERVED',
      })
      prisma.inventory.findUnique.mockResolvedValue({
        id: 'inv1',
        variantId: 'v1',
        warehouseId: 'wh1',
        quantityOnHand: 3, // less than reservation
        quantityReserved: 5,
      })

      const service = await makeService(prisma)
      await expect(service.confirm('res1', 'order1')).rejects.toThrow(ConflictException)

      // Critical: the transaction must NOT have been called when the guard triggers
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('wirft StockUnderflow auch wenn quantityReserved zu klein ist (drift)', async () => {
      prisma.stockReservation.findUnique.mockResolvedValue({
        id: 'res1',
        variantId: 'v1',
        warehouseId: 'wh1',
        quantity: 4,
        status: 'RESERVED',
      })
      prisma.inventory.findUnique.mockResolvedValue({
        id: 'inv1',
        variantId: 'v1',
        warehouseId: 'wh1',
        quantityOnHand: 100,
        quantityReserved: 1, // less than what we want to release
      })

      const service = await makeService(prisma)
      await expect(service.confirm('res1', 'order1')).rejects.toThrow(ConflictException)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('confirm-happy-path: zieht Bestand ab wenn alle Invarianten passen', async () => {
      prisma.stockReservation.findUnique.mockResolvedValue({
        id: 'res-ok',
        variantId: 'v1',
        warehouseId: 'wh1',
        quantity: 2,
        status: 'RESERVED',
      })
      prisma.inventory.findUnique.mockResolvedValue({
        id: 'inv1',
        variantId: 'v1',
        warehouseId: 'wh1',
        quantityOnHand: 10,
        quantityReserved: 2,
      })

      const service = await makeService(prisma)
      const result = await service.confirm('res-ok', 'order-ok')

      expect(result.success).toBe(true)
      expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('wirft NotFoundException wenn Reservierung fehlt', async () => {
      prisma.stockReservation.findUnique.mockResolvedValue(null)
      const service = await makeService(prisma)
      await expect(service.confirm('ghost', 'order1')).rejects.toThrow(NotFoundException)
    })

    // ── C15.3 contract change ────────────────────────────────────
    //
    // PRE-C15.3 (this test pre-2026-05-01):
    //   confirm() on an already-CONFIRMED reservation threw
    //   BadRequestException ("nur RESERVED kann bestätigt werden").
    //   Caller had to wrap with try/catch to be idempotent. A
    //   concurrent webhook + cron retry pair would produce a 4xx
    //   error in the loser's path even though the work was done
    //   correctly by the winner.
    //
    // POST-C15.3 (this test from 2026-05-01):
    //   confirm() returns a silent no-op result `{ idempotent: true,
    //   reservationId, orderId }` when the reservation is already
    //   CONFIRMED. This aligns with the Variante-B atomic-claim
    //   pattern where racing callers cooperatively no-op rather
    //   than throw. Backfill scripts, cron re-syncs, parallel
    //   webhook+cron emits all become safe to re-run without
    //   wrapper try/catch.
    //
    // Reason: Bug-1 (ORD-20260430-000001 incident, 2026-04-30) +
    //   ADR-3 owner-approved Variante B in C15.3. See commit
    //   message of C15.3 for full rationale + race-safety analysis.
    //
    // Note for maintainers: confirm() with status NEITHER
    // 'RESERVED' nor 'CONFIRMED' (e.g. legacy 'CANCELLED' /
    // 'EXPIRED' rows) STILL throws BadRequestException — that
    // path is unchanged. Only the CONFIRMED branch flipped from
    // throw to no-op.
    it('C15.3 — gibt { idempotent: true } zurück wenn Reservierung bereits CONFIRMED (silent no-op statt throw)', async () => {
      prisma.stockReservation.findUnique.mockResolvedValue({
        id: 'res-done',
        variantId: 'v1',
        warehouseId: 'wh1',
        quantity: 1,
        status: 'CONFIRMED',
        orderId: 'order1',
      })
      const service = await makeService(prisma)
      const result = await service.confirm('res-done', 'order1')
      expect(result).toEqual({ idempotent: true, reservationId: 'res-done', orderId: 'order1' })
      // Defense-in-depth: idempotent path MUST NOT touch DB beyond
      // the initial findUnique read. No transaction, no inventory
      // update, no movement-create.
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('restockFromConfirmed — R9: Post-Payment-Cancel Pfad', () => {
    it('findet keine CONFIRMED Reservierungen → no-op ohne DB-Writes', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([])

      const service = await makeService(prisma)
      const result = await service.restockFromConfirmed('orderX', 'test', 'admin1')

      expect(result.restocked).toBe(0)
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(prisma.inventory.update).not.toHaveBeenCalled()
    })

    it('flippt CONFIRMED → RELEASED und inkrementiert quantityOnHand am Reservation-Warehouse', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([
        { id: 'res1', variantId: 'v1', warehouseId: 'wh-marzahn', quantity: 2, orderId: 'orderX', status: 'CONFIRMED' },
      ])
      prisma.stockReservation.updateMany = jest.fn().mockResolvedValue({ count: 1 })
      prisma.inventory.findUnique.mockResolvedValue({
        id: 'inv1', variantId: 'v1', warehouseId: 'wh-marzahn', quantityOnHand: 43, quantityReserved: 0,
      })

      const service = await makeService(prisma)
      const result = await service.restockFromConfirmed('orderX', 'ORD-XX cancel', 'admin1')

      expect(result.restocked).toBe(1)
      // Atomic claim: updateMany WHERE status=CONFIRMED
      expect(prisma.stockReservation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'res1', status: 'CONFIRMED' }, data: { status: 'RELEASED' } }),
      )
      // Increment onHand at the reservation's recorded warehouse
      expect(prisma.inventory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { variantId_warehouseId: { variantId: 'v1', warehouseId: 'wh-marzahn' } },
          data: { quantityOnHand: { increment: 2 } },
        }),
      )
      // NO quantityReserved decrement — confirm() already did that at capture
      expect(prisma.inventory.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ quantityReserved: expect.anything() }) }),
      )
    })

    it('erstellt genau eine InventoryMovement pro restockter Reservierung', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([
        { id: 'res1', variantId: 'v1', warehouseId: 'wh1', quantity: 3, orderId: 'orderX', status: 'CONFIRMED' },
        { id: 'res2', variantId: 'v2', warehouseId: 'wh1', quantity: 1, orderId: 'orderX', status: 'CONFIRMED' },
      ])
      prisma.stockReservation.updateMany = jest.fn().mockResolvedValue({ count: 1 })
      prisma.inventory.findUnique.mockResolvedValue({ quantityOnHand: 10, quantityReserved: 0 })

      const service = await makeService(prisma)
      const result = await service.restockFromConfirmed('orderX', 'cancel', 'admin1')

      expect(result.restocked).toBe(2)
      expect(prisma.inventoryMovement.create).toHaveBeenCalledTimes(2)
      // Movement type must be return_received (matches reconciliation expectations)
      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'return_received' }) }),
      )
    })

    it('ist idempotent: racing caller hat bereits geflippt → count=0 → skip ohne DB-Write', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([
        { id: 'res1', variantId: 'v1', warehouseId: 'wh1', quantity: 2, orderId: 'orderX', status: 'CONFIRMED' },
      ])
      // Racer already flipped the row to RELEASED between findMany and our updateMany
      prisma.stockReservation.updateMany = jest.fn().mockResolvedValue({ count: 0 })

      const service = await makeService(prisma)
      const result = await service.restockFromConfirmed('orderX', 'cancel', 'admin1')

      expect(result.restocked).toBe(0)
      // No inventory writes because claim failed
      expect(prisma.inventory.update).not.toHaveBeenCalled()
      expect(prisma.inventoryMovement.create).not.toHaveBeenCalled()
    })

    it('findet NUR CONFIRMED, NICHT RESERVED (sauber getrennte Pfade)', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([])

      const service = await makeService(prisma)
      await service.restockFromConfirmed('orderX', 'test', 'admin1')

      // Critical separation from release(): filter MUST be CONFIRMED, never RESERVED
      expect(prisma.stockReservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orderId: 'orderX', status: 'CONFIRMED' }),
        }),
      )
    })

    it('variantIds-Filter begrenzt auf Partial-Cancel-Scope', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([])

      const service = await makeService(prisma)
      await service.restockFromConfirmed('orderX', 'partial', 'admin1', ['v1', 'v2'])

      expect(prisma.stockReservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orderId: 'orderX',
            status: 'CONFIRMED',
            variantId: { in: ['v1', 'v2'] },
          }),
        }),
      )
    })

    it('bricht sauber ab wenn Inventory-Row fehlt (Status bleibt geflippt, aber kein Increment)', async () => {
      prisma.stockReservation.findMany.mockResolvedValue([
        { id: 'res1', variantId: 'v1', warehouseId: 'wh-deleted', quantity: 2, orderId: 'orderX', status: 'CONFIRMED' },
      ])
      prisma.stockReservation.updateMany = jest.fn().mockResolvedValue({ count: 1 })
      prisma.inventory.findUnique.mockResolvedValue(null) // warehouse row gone

      const service = await makeService(prisma)
      const result = await service.restockFromConfirmed('orderX', 'edge', 'admin1')

      // Count stays 0 because we couldn't increment
      expect(result.restocked).toBe(0)
      expect(prisma.inventory.update).not.toHaveBeenCalled()
      expect(prisma.inventoryMovement.create).not.toHaveBeenCalled()
    })
  })

  describe('release', () => {
    it('gibt aktive Reservierung frei und verringert quantityReserved', async () => {
      // updateMany returns count=1 (reservation was RESERVED → now RELEASED)
      prisma.stockReservation.updateMany = jest.fn().mockResolvedValue({ count: 1 })
      prisma.stockReservation.findUnique.mockResolvedValue({
        id: 'res1',
        variantId: 'v1',
        warehouseId: 'wh1',
        quantity: 3,
        status: 'RELEASED', // after updateMany it's now RELEASED
      })

      const service = await makeService(prisma)
      await service.release('res1', 'customer-cancel')

      expect(prisma.stockReservation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'res1', status: 'RESERVED' } }),
      )
      expect(prisma.inventory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { quantityReserved: { decrement: 3 } },
        }),
      )
    })

    it('überspringt doppelten Release (Idempotenz)', async () => {
      // updateMany returns count=0 (already released by a racing event)
      prisma.stockReservation.updateMany = jest.fn().mockResolvedValue({ count: 0 })

      const service = await makeService(prisma)
      // Should NOT throw — just skip silently
      await service.release('res1')

      expect(prisma.inventory.update).not.toHaveBeenCalled()
    })
  })
})
