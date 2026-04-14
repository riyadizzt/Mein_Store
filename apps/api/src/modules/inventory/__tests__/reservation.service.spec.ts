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
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common'
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

    it('wirft BadRequestException wenn Reservierung bereits CONFIRMED', async () => {
      prisma.stockReservation.findUnique.mockResolvedValue({
        id: 'res-done',
        variantId: 'v1',
        warehouseId: 'wh1',
        quantity: 1,
        status: 'CONFIRMED',
      })
      const service = await makeService(prisma)
      await expect(service.confirm('res-done', 'order1')).rejects.toThrow(BadRequestException)
    })
  })

  describe('release', () => {
    it('gibt aktive Reservierung frei und verringert quantityReserved', async () => {
      prisma.stockReservation.findUnique.mockResolvedValue({
        id: 'res1',
        variantId: 'v1',
        warehouseId: 'wh1',
        quantity: 3,
        status: 'RESERVED',
      })

      const service = await makeService(prisma)
      const result = await service.release('res1', 'customer-cancel')

      expect(result.success).toBe(true)
      expect(prisma.inventory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { quantityReserved: { decrement: 3 } },
        }),
      )
    })

    it('wirft BadRequestException wenn Reservierung schon RELEASED', async () => {
      prisma.stockReservation.findUnique.mockResolvedValue({
        id: 'res1',
        status: 'RELEASED',
      })
      const service = await makeService(prisma)
      await expect(service.release('res1')).rejects.toThrow(BadRequestException)
    })
  })
})
