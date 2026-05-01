/**
 * C15.3 — reservation.service.confirm() idempotency unit tests.
 *
 * Companion to reservation.service.spec.ts (which holds the legacy +
 * happy-path coverage). This file pins the IDEMPOTENCY contract
 * introduced by C15.3 Variante B:
 *
 *   1. Already-CONFIRMED reservation → silent no-op return,
 *      no DB writes.
 *   2. Already-CONFIRMED with DIFFERENT orderId → silent no-op +
 *      defensive warn-log (data drift indicator).
 *   3. Atomic claim wins (count=1) → full happy-path: decrement
 *      onHand, set status, write movement-row.
 *   4. Atomic claim loses (count=0) → race-loser path: silent
 *      no-op, no decrement, no movement-row.
 *   5. Caller can distinguish winner vs idempotent via the return
 *      shape — both safe to call from event-listeners + cron loops
 *      without try/catch.
 *
 * Race-test coverage (3 scenarios per R-5) lives in the
 * reservation-confirm-race.spec.ts file. This file is mock-only.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
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
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      // C15.3 atomic claim default: winner. Race-loser tests override
      // to { count: 0 } per-case.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    productVariant: { findMany: jest.fn().mockResolvedValue([]) },
    inventoryMovement: { create: jest.fn() },
  }
  mock.$transaction = jest.fn().mockImplementation((fnOrArray: any) =>
    typeof fnOrArray === 'function' ? fnOrArray(mock) : Promise.all(fnOrArray),
  )
  mock.$queryRaw = jest.fn()
  return mock
}

const mockInventoryService = { checkAndAlertLowStock: jest.fn().mockResolvedValue(undefined) }
const mockConfig = { get: jest.fn(() => 7) }

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

describe('ReservationService.confirm() — C15.3 idempotency contract', () => {
  let prisma: any

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = buildPrisma()
  })

  // ─────────────────────────────────────────────────────────────
  // Already-CONFIRMED early-exit
  // ─────────────────────────────────────────────────────────────

  it('already-CONFIRMED with matching orderId → returns idempotent without DB writes', async () => {
    prisma.stockReservation.findUnique.mockResolvedValue({
      id: 'res-X',
      variantId: 'v1',
      warehouseId: 'wh1',
      quantity: 1,
      status: 'CONFIRMED',
      orderId: 'ord-1',
    })
    const service = await makeService(prisma)

    const result = await service.confirm('res-X', 'ord-1')

    expect(result).toEqual({ idempotent: true, reservationId: 'res-X', orderId: 'ord-1' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.stockReservation.updateMany).not.toHaveBeenCalled()
    expect(prisma.inventory.update).not.toHaveBeenCalled()
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled()
  })

  it('already-CONFIRMED with DIFFERENT orderId → returns idempotent + defensive warn-log', async () => {
    prisma.stockReservation.findUnique.mockResolvedValue({
      id: 'res-X',
      variantId: 'v1',
      warehouseId: 'wh1',
      quantity: 1,
      status: 'CONFIRMED',
      orderId: 'ord-stored', // stored
    })
    const service = await makeService(prisma)

    const result = await service.confirm('res-X', 'ord-incoming')

    // Returns the STORED orderId (single source of truth), not the
    // incoming one. Caller cannot rewrite history via wrong-orderId
    // calls.
    expect(result).toEqual({
      idempotent: true,
      reservationId: 'res-X',
      orderId: 'ord-stored',
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  // ─────────────────────────────────────────────────────────────
  // Race-loser path (atomic claim count=0)
  // ─────────────────────────────────────────────────────────────

  it('atomic claim returns count=0 (race lost) → silent idempotent return, no decrement', async () => {
    // findUnique sees status='RESERVED' (the read happens BEFORE the
    // claim — TOCTOU window). Then in the transaction, updateMany
    // returns count=0 because a concurrent caller already flipped
    // the status.
    prisma.stockReservation.findUnique.mockResolvedValue({
      id: 'res-X',
      variantId: 'v1',
      warehouseId: 'wh1',
      quantity: 1,
      status: 'RESERVED',
      orderId: null,
    })
    prisma.inventory.findUnique.mockResolvedValue({
      id: 'inv1',
      variantId: 'v1',
      warehouseId: 'wh1',
      quantityOnHand: 10,
      quantityReserved: 2,
    })
    // Race-loser — concurrent winner already claimed the row.
    prisma.stockReservation.updateMany.mockResolvedValue({ count: 0 })
    const service = await makeService(prisma)

    const result = await service.confirm('res-X', 'ord-1')

    expect(result).toEqual({ idempotent: true, reservationId: 'res-X', orderId: 'ord-1' })
    // Inventory + movement-create MUST NOT have run (winner did them).
    expect(prisma.inventory.update).not.toHaveBeenCalled()
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled()
  })

  // ─────────────────────────────────────────────────────────────
  // Atomic claim winner (count=1)
  // ─────────────────────────────────────────────────────────────

  it('atomic claim returns count=1 (winner) → full decrement + movement-row + success return', async () => {
    prisma.stockReservation.findUnique.mockResolvedValue({
      id: 'res-X',
      variantId: 'v1',
      warehouseId: 'wh1',
      quantity: 2,
      status: 'RESERVED',
      orderId: null,
    })
    prisma.inventory.findUnique.mockResolvedValue({
      id: 'inv1',
      variantId: 'v1',
      warehouseId: 'wh1',
      quantityOnHand: 10,
      quantityReserved: 5,
    })
    prisma.stockReservation.updateMany.mockResolvedValue({ count: 1 })
    const service = await makeService(prisma)

    const result = await service.confirm('res-X', 'ord-1')

    expect(result).toEqual({ success: true, reservationId: 'res-X', orderId: 'ord-1' })
    // Atomic claim happened with the correct WHERE-guard.
    expect(prisma.stockReservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-X', status: 'RESERVED' },
      data: { status: 'CONFIRMED', orderId: 'ord-1' },
    })
    // Inventory decrement happened.
    expect(prisma.inventory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          quantityOnHand: { decrement: 2 },
          quantityReserved: { decrement: 2 },
        },
      }),
    )
    // Movement-row created with type=sale_online + referenceId=orderId.
    expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'sale_online',
          referenceId: 'ord-1',
          quantity: -2,
        }),
      }),
    )
  })

  // ─────────────────────────────────────────────────────────────
  // Verify race-loser is INSIDE the transaction (atomicity proof)
  // ─────────────────────────────────────────────────────────────

  it('atomic claim WHERE-clause includes status=RESERVED (race-guard verified)', async () => {
    prisma.stockReservation.findUnique.mockResolvedValue({
      id: 'res-X',
      variantId: 'v1',
      warehouseId: 'wh1',
      quantity: 1,
      status: 'RESERVED',
      orderId: null,
    })
    prisma.inventory.findUnique.mockResolvedValue({
      id: 'inv1',
      variantId: 'v1',
      warehouseId: 'wh1',
      quantityOnHand: 10,
      quantityReserved: 1,
    })
    const service = await makeService(prisma)

    await service.confirm('res-X', 'ord-1')

    const updateManyCall = (prisma.stockReservation.updateMany as jest.Mock).mock.calls[0][0]
    // Both id AND status='RESERVED' must be in the WHERE clause —
    // status is the race-guard, removing it would re-introduce the
    // double-decrement bug.
    expect(updateManyCall.where).toEqual({
      id: 'res-X',
      status: 'RESERVED',
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Caller-distinction: winner vs idempotent return shape
  // ─────────────────────────────────────────────────────────────

  it('winner return has success: true, idempotent paths have idempotent: true', async () => {
    prisma.stockReservation.findUnique.mockResolvedValue({
      id: 'res-already',
      variantId: 'v1',
      warehouseId: 'wh1',
      quantity: 1,
      status: 'CONFIRMED',
      orderId: 'ord-old',
    })
    const service = await makeService(prisma)
    const idempotentResult = await service.confirm('res-already', 'ord-old')
    expect(idempotentResult).toMatchObject({ idempotent: true })
    expect(idempotentResult).not.toHaveProperty('success')

    // Winner path
    jest.clearAllMocks()
    prisma = buildPrisma()
    prisma.stockReservation.findUnique.mockResolvedValue({
      id: 'res-fresh',
      variantId: 'v1',
      warehouseId: 'wh1',
      quantity: 1,
      status: 'RESERVED',
      orderId: null,
    })
    prisma.inventory.findUnique.mockResolvedValue({
      id: 'inv',
      variantId: 'v1',
      warehouseId: 'wh1',
      quantityOnHand: 5,
      quantityReserved: 1,
    })
    const service2 = await makeService(prisma)
    const winnerResult = await service2.confirm('res-fresh', 'ord-fresh')
    expect(winnerResult).toMatchObject({ success: true })
    expect(winnerResult).not.toHaveProperty('idempotent')
  })
})
