/**
 * C15.3 — reservation.service.confirm() RACE tests (R-5 scenarios).
 *
 * Owner-decision R-5: three distinct race scenarios, NOT just the
 * 100-on-same-reservation case:
 *
 *   (a) 100 parallel calls on the SAME reservation
 *       → exactly 1 winner (count=1), 99 silent no-ops
 *       → exactly 1 inventoryMovement-row written
 *       → onHand decremented exactly 1× the reservation.quantity
 *
 *   (b) 100 parallel calls on 100 DIFFERENT reservations
 *       → no cross-contamination: each reservation gets its own
 *         winner + movement-row
 *       → 100 inventoryMovement rows total
 *       → 100 successful confirmations, 0 idempotent shortcuts
 *
 *   (c) 50 reservations × 2 parallel calls each (mixed production
 *       realism: multiple parallel eBay-pulls each with a slight
 *       retry, never 100× the same call)
 *       → for each reservation, exactly 1 of the 2 wins
 *       → 50 movement-rows total (not 100), 50 winners + 50
 *         idempotent no-ops
 *
 * These tests use a SHARED IN-MEMORY mock that simulates the atomic-
 * claim semantics of Postgres updateMany WHERE status='RESERVED':
 *   - the FIRST updateMany call for a given id sees status=RESERVED,
 *     flips it, and returns { count: 1 }
 *   - subsequent updateMany calls for the same id see status=
 *     CONFIRMED, return { count: 0 }
 *
 * The mock is intentionally simple — we are testing the SERVICE'S
 * use of the updateMany contract, not Postgres itself. Postgres-
 * level race-safety is part of its own well-tested behaviour.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { ReservationService } from '../reservation.service'
import { InventoryService } from '../inventory.service'
import { PrismaService } from '../../../prisma/prisma.service'

/**
 * Build a shared-state prisma mock that simulates atomic claim
 * semantics across many concurrent confirm() calls.
 *
 * State model:
 *   reservationStates: Map<reservationId, { status, quantity, ... }>
 *   inventoryByVariant: Map<variantId-warehouseId, { onHand, reserved }>
 *
 * The mock's updateMany checks the WHERE.status='RESERVED' filter
 * atomically (single-threaded JS — no actual race) and flips state
 * exactly once per id.
 */
function buildSharedStatePrisma(seed: {
  reservations: Array<{ id: string; variantId: string; warehouseId: string; quantity: number }>
  inventory: Array<{ variantId: string; warehouseId: string; onHand: number; reserved: number }>
}) {
  const reservationStates = new Map<string, any>()
  for (const r of seed.reservations) {
    reservationStates.set(r.id, {
      id: r.id,
      variantId: r.variantId,
      warehouseId: r.warehouseId,
      quantity: r.quantity,
      status: 'RESERVED',
      orderId: null,
    })
  }
  const invStates = new Map<string, any>()
  for (const inv of seed.inventory) {
    const k = `${inv.variantId}|${inv.warehouseId}`
    invStates.set(k, {
      id: `inv-${k}`,
      variantId: inv.variantId,
      warehouseId: inv.warehouseId,
      quantityOnHand: inv.onHand,
      quantityReserved: inv.reserved,
    })
  }
  const movementsCreated: any[] = []

  const mock: any = {
    inventory: {
      findUnique: jest.fn(({ where }: any) => {
        const k = `${where.variantId_warehouseId.variantId}|${where.variantId_warehouseId.warehouseId}`
        return Promise.resolve(invStates.get(k) ?? null)
      }),
      update: jest.fn(({ where, data }: any) => {
        const k = `${where.variantId_warehouseId.variantId}|${where.variantId_warehouseId.warehouseId}`
        const inv = invStates.get(k)
        if (!inv) return Promise.resolve(null)
        if (data.quantityOnHand?.decrement) inv.quantityOnHand -= data.quantityOnHand.decrement
        if (data.quantityReserved?.decrement) inv.quantityReserved -= data.quantityReserved.decrement
        return Promise.resolve(inv)
      }),
      updateMany: jest.fn(),
    },
    stockReservation: {
      findUnique: jest.fn(({ where }: any) => {
        return Promise.resolve(reservationStates.get(where.id) ?? null)
      }),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      // Atomic-claim simulation: only the first call where the
      // WHERE-status matches gets count: 1. All subsequent calls
      // see CONFIRMED status and get count: 0.
      updateMany: jest.fn(({ where, data }: any) => {
        const r = reservationStates.get(where.id)
        if (!r) return Promise.resolve({ count: 0 })
        if (where.status && r.status !== where.status) {
          return Promise.resolve({ count: 0 })
        }
        // Winner: flip status atomically.
        r.status = data.status
        r.orderId = data.orderId
        return Promise.resolve({ count: 1 })
      }),
    },
    productVariant: { findMany: jest.fn().mockResolvedValue([]) },
    inventoryMovement: {
      create: jest.fn((args: any) => {
        movementsCreated.push(args.data)
        return Promise.resolve({ id: `mov-${movementsCreated.length}`, ...args.data })
      }),
    },
  }
  mock.$transaction = jest.fn().mockImplementation((fnOrArray: any) =>
    typeof fnOrArray === 'function' ? fnOrArray(mock) : Promise.all(fnOrArray),
  )
  mock.$queryRaw = jest.fn()

  return { prisma: mock, reservationStates, invStates, movementsCreated }
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

describe('ReservationService.confirm() — C15.3 race tests (R-5)', () => {
  // ─────────────────────────────────────────────────────────────
  // Scenario (a): 100 calls on the SAME reservation
  // ─────────────────────────────────────────────────────────────

  it('(a) 100 parallel calls on SAME reservation → exactly 1 winner, 99 idempotent, 1 movement-row', async () => {
    const { prisma, movementsCreated, invStates } = buildSharedStatePrisma({
      reservations: [{ id: 'res-1', variantId: 'v1', warehouseId: 'wh1', quantity: 1 }],
      inventory: [{ variantId: 'v1', warehouseId: 'wh1', onHand: 100, reserved: 100 }],
    })
    const service = await makeService(prisma)

    const calls = Array.from({ length: 100 }, () => service.confirm('res-1', 'ord-1'))
    const results = await Promise.all(calls)

    const winners = results.filter((r) => 'success' in r && r.success)
    const idempotents = results.filter((r) => 'idempotent' in r && r.idempotent)
    expect(winners).toHaveLength(1)
    expect(idempotents).toHaveLength(99)

    // Exactly 1 movement-row written, NOT 100
    expect(movementsCreated).toHaveLength(1)
    expect(movementsCreated[0]).toMatchObject({
      type: 'sale_online',
      referenceId: 'ord-1',
      quantity: -1,
    })

    // onHand decremented exactly 1× quantity (100 → 99), NOT 100×
    const inv = invStates.get('v1|wh1')
    expect(inv.quantityOnHand).toBe(99)
    expect(inv.quantityReserved).toBe(99)
  })

  // ─────────────────────────────────────────────────────────────
  // Scenario (b): 100 calls on 100 DIFFERENT reservations
  // ─────────────────────────────────────────────────────────────

  it('(b) 100 parallel calls on 100 DIFFERENT reservations → no cross-contamination, 100 winners + 100 movements', async () => {
    const reservationCount = 100
    const reservations = Array.from({ length: reservationCount }, (_, i) => ({
      id: `res-${i}`,
      variantId: 'v1',
      warehouseId: 'wh1',
      quantity: 1,
    }))
    const { prisma, movementsCreated, invStates } = buildSharedStatePrisma({
      reservations,
      inventory: [{ variantId: 'v1', warehouseId: 'wh1', onHand: 200, reserved: 200 }],
    })
    const service = await makeService(prisma)

    const calls = reservations.map((r) => service.confirm(r.id, `ord-${r.id}`))
    const results = await Promise.all(calls)

    // All 100 should be winners (different reservation IDs, no race)
    const winners = results.filter((r) => 'success' in r && r.success)
    expect(winners).toHaveLength(reservationCount)
    expect(results.filter((r) => 'idempotent' in r && r.idempotent)).toHaveLength(0)

    // 100 movement-rows total
    expect(movementsCreated).toHaveLength(reservationCount)

    // Each row has its own referenceId → no cross-contamination
    const refIds = new Set(movementsCreated.map((m) => m.referenceId))
    expect(refIds.size).toBe(reservationCount)

    // onHand decremented by 100 (one per reservation)
    const inv = invStates.get('v1|wh1')
    expect(inv.quantityOnHand).toBe(100) // 200 - 100
  })

  // ─────────────────────────────────────────────────────────────
  // Scenario (c): 50 reservations × 2 parallel calls each
  // ─────────────────────────────────────────────────────────────

  it('(c) 50 reservations × 2 parallel calls → exactly 50 winners + 50 idempotent + 50 movement-rows', async () => {
    const reservationCount = 50
    const reservations = Array.from({ length: reservationCount }, (_, i) => ({
      id: `res-${i}`,
      variantId: 'v1',
      warehouseId: 'wh1',
      quantity: 1,
    }))
    const { prisma, movementsCreated, invStates } = buildSharedStatePrisma({
      reservations,
      inventory: [{ variantId: 'v1', warehouseId: 'wh1', onHand: 100, reserved: 100 }],
    })
    const service = await makeService(prisma)

    // 2 parallel confirm() calls per reservation = 100 calls total
    const calls: Promise<any>[] = []
    for (const r of reservations) {
      calls.push(service.confirm(r.id, `ord-${r.id}`))
      calls.push(service.confirm(r.id, `ord-${r.id}`)) // duplicate
    }
    const results = await Promise.all(calls)

    const winners = results.filter((r) => 'success' in r && r.success)
    const idempotents = results.filter((r) => 'idempotent' in r && r.idempotent)
    expect(winners).toHaveLength(reservationCount) // 50 winners
    expect(idempotents).toHaveLength(reservationCount) // 50 idempotent

    // Exactly 50 movement-rows (one per reservation, not per call)
    expect(movementsCreated).toHaveLength(reservationCount)

    // onHand decremented by exactly 50 (1 per reservation, not 2)
    const inv = invStates.get('v1|wh1')
    expect(inv.quantityOnHand).toBe(50) // 100 - 50
    expect(inv.quantityReserved).toBe(50)
  })
})
