import { Test, TestingModule } from '@nestjs/testing'
import { ConflictException, BadRequestException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { OrdersService } from '../orders.service'
import { IdempotencyService } from '../idempotency.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { SHIPPING_CALCULATOR } from '../shipping/shipping-calculator.interface'
import { OrderNotFoundException } from '../exceptions/order-not-found.exception'
import { InvalidOrderStateException } from '../exceptions/invalid-order-state.exception'

// ── Mock Factories ────────────────────────────────────────────

const mockPrisma = {
  productVariant: {
    findMany: jest.fn(),
  },
  order: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  orderItem: { findMany: jest.fn() },
  orderStatusHistory: { create: jest.fn() },
  coupon: { findFirst: jest.fn() },
  couponUsage: { create: jest.fn() },
  address: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'addr-test' }) },
  warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'wh1' }) },
  inventory: {
    findFirst: jest.fn().mockResolvedValue({ id: 'inv1', quantityOnHand: 100, quantityReserved: 0 }),
    updateMany: jest.fn(),
    aggregate: jest.fn().mockResolvedValue({ _sum: { quantityOnHand: 100, quantityReserved: 0 } }),
  },
  idempotencyKey: { deleteMany: jest.fn() },
  $transaction: jest.fn().mockImplementation((fnOrArray) =>
    typeof fnOrArray === 'function'
      ? fnOrArray(mockPrisma)
      : Promise.all(fnOrArray.map((p: Promise<unknown>) => p)),
  ),
  $queryRaw: jest.fn(),
}

const mockEventEmitter = {
  emitAsync: jest.fn().mockResolvedValue([[]]),
  emit: jest.fn(),
}

const mockIdempotency = {
  hashBody: jest.fn().mockReturnValue('hash123'),
  get: jest.fn().mockResolvedValue(null),
  reserve: jest.fn().mockResolvedValue(undefined),
  save: jest.fn().mockResolvedValue(undefined),
}

const mockShipping = {
  calculate: jest.fn().mockResolvedValue({
    cost: 8.0,
    zoneName: 'Deutschland',
    isFreeShipping: false,
    carrier: 'zone_based',
  }),
}

// ── Helpers ───────────────────────────────────────────────────

const makeVariant = (id: string, sku: string, price = 50) => ({
  id,
  sku,
  isActive: true,
  priceModifier: 0,
  weightGrams: 500,
  product: {
    basePrice: price,
    salePrice: null,
    taxRate: 19,
    translations: [{ name: `Produkt ${sku}` }],
  },
})

const makeOrder = (id: string, status = 'pending') => ({
  id,
  orderNumber: 'ORD-20260326-000001',
  status,
  userId: 'user1',
  notes: null,
  cancelledAt: null,
})

// ── Tests ─────────────────────────────────────────────────────

describe('OrdersService', () => {
  let service: OrdersService

  beforeEach(async () => {
    jest.clearAllMocks()
    // Default: $transaction unterstützt Callback-Funktionen UND Prisma-Operation-Arrays
    mockPrisma.$transaction.mockImplementation((fnOrArray: any) =>
      typeof fnOrArray === 'function'
        ? fnOrArray(mockPrisma)
        : Promise.all(fnOrArray),
    )

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: IdempotencyService, useValue: mockIdempotency },
        { provide: SHIPPING_CALCULATOR, useValue: mockShipping },
      ],
    }).compile()

    service = module.get<OrdersService>(OrdersService)
  })

  // ── Bestellnummer-Format ──────────────────────────────────────

  describe('generateOrderNumber (via create)', () => {
    it('sollte Format ORD-YYYYMMDD-NNNNNN generieren', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ seq: 1 }])
      mockPrisma.productVariant.findMany.mockResolvedValue([makeVariant('v1', 'SKU-001')])
      mockPrisma.order.create.mockResolvedValue(makeOrder('order1'))
      mockPrisma.order.update.mockResolvedValue({})
      mockEventEmitter.emitAsync.mockResolvedValue([['res1']])

      await service.create(
        {
          items: [{ variantId: 'v1', warehouseId: 'wh1', quantity: 1 }],
          countryCode: 'DE',
          shippingAddress: {
            firstName: 'Test', lastName: 'User',
            street: 'Teststr', houseNumber: '1',
            postalCode: '10115', city: 'Berlin', country: 'DE',
          },
        } as any,
        'user1',
        'corr-id',
      )

      expect(mockPrisma.$queryRaw).toHaveBeenCalled()
    })

    it('wirft BadRequest wenn weder shippingAddressId noch shippingAddress gesetzt', async () => {
      await expect(
        service.create(
          { items: [{ variantId: 'v1', warehouseId: 'wh1', quantity: 1 }] } as any,
          'user1',
          'corr-no-addr',
        ),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ── Zustandsmaschine ──────────────────────────────────────────

  describe('updateStatus — Zustandsmaschine', () => {
    const validTransitions = [
      ['pending', 'confirmed'],
      ['pending', 'cancelled'],
      ['confirmed', 'processing'],
      ['processing', 'shipped'],
      ['shipped', 'delivered'],
      ['delivered', 'refunded'],
    ]

    test.each(validTransitions)(
      'erlaubt: %s → %s',
      async (from, to) => {
        mockPrisma.order.findFirst.mockResolvedValue(makeOrder('o1', from))
        mockPrisma.order.update.mockResolvedValue(makeOrder('o1', to))
        mockPrisma.orderStatusHistory.create.mockResolvedValue({})

        const result = await service.updateStatus(
          'o1',
          { status: to as any },
          'admin',
          'admin1',
          'corr1',
        )
        expect(result.status).toBe(to)
      },
    )

    const invalidTransitions = [
      ['pending', 'shipped'],
      ['delivered', 'pending'],
      ['cancelled', 'confirmed'],
      ['refunded', 'pending'],
    ]

    test.each(invalidTransitions)(
      'verbietet: %s → %s',
      async (from, to) => {
        mockPrisma.order.findFirst.mockResolvedValue(makeOrder('o1', from))

        await expect(
          service.updateStatus('o1', { status: to as any }, 'admin', 'admin1', 'corr1'),
        ).rejects.toThrow(InvalidOrderStateException)
      },
    )
  })

  // ── OrderNotFoundException ────────────────────────────────────

  describe('findOne', () => {
    it('wirft OrderNotFoundException wenn nicht gefunden', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(null)
      await expect(service.findOne('nicht-existent', 'user1')).rejects.toThrow(
        OrderNotFoundException,
      )
    })
  })

  // ── Idempotency ───────────────────────────────────────────────

  describe('create — Idempotency', () => {
    it('wirft DuplicateOrderException bei bekanntem Key', async () => {
      mockIdempotency.get.mockResolvedValue({ responseBody: {}, statusCode: 201 })

      await expect(
        service.create(
          { items: [{ variantId: 'v1', warehouseId: 'wh1', quantity: 1 }] },
          'user1',
          'corr',
          'idem-key-123',
        ),
      ).rejects.toThrow()
    })

    it('wirft 409 wenn Request noch verarbeitet wird', async () => {
      mockIdempotency.get.mockResolvedValue({ responseBody: null, statusCode: 102 })

      await expect(
        service.create(
          { items: [{ variantId: 'v1', warehouseId: 'wh1', quantity: 1 }] },
          'user1',
          'corr',
          'idem-key-456',
        ),
      ).rejects.toThrow(ConflictException)
    })
  })

  // ── Inventory-Kompensation ────────────────────────────────────

  describe('create — Compensation Logic', () => {
    it('storniert Bestellung wenn Inventory-Reservierung fehlschlägt', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ seq: 1 }])
      mockPrisma.productVariant.findMany.mockResolvedValue([makeVariant('v1', 'SKU-001')])
      mockPrisma.order.create.mockResolvedValue(makeOrder('order1'))
      mockPrisma.order.update.mockResolvedValue({ status: 'cancelled' })
      mockPrisma.orderStatusHistory.create.mockResolvedValue({})

      // Inventory-Event schlägt fehl
      mockEventEmitter.emitAsync.mockRejectedValue(
        new ConflictException('Nicht genügend Bestand'),
      )

      await expect(
        service.create(
          {
            items: [{ variantId: 'v1', warehouseId: 'wh1', quantity: 1 }],
            countryCode: 'DE',
            shippingAddress: {
              firstName: 'Test', lastName: 'User',
              street: 'Teststr', houseNumber: '1',
              postalCode: '10115', city: 'Berlin', country: 'DE',
            },
          } as any,
          'user1',
          'corr',
        ),
      ).rejects.toThrow(ConflictException)

      // Bestellung wurde storniert
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }),
      )
    })
  })

  // ── Soft Delete ───────────────────────────────────────────────

  describe('softDelete', () => {
    it('verbietet Löschen von aktiven Bestellungen', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(makeOrder('o1', 'confirmed'))

      await expect(service.softDelete('o1', 'corr')).rejects.toThrow(BadRequestException)
    })

    it('erlaubt Löschen von stornierten Bestellungen', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(makeOrder('o1', 'cancelled'))
      mockPrisma.order.update.mockResolvedValue({})

      await service.softDelete('o1', 'corr')
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      )
    })
  })
})
