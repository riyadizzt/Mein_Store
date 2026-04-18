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
    // R3 Gap 2 — stock-insufficiency error builder calls findUnique to hydrate
    // the 3-language product name for the customer-facing error payload.
    findUnique: jest.fn().mockResolvedValue({
      sku: 'SKU-001',
      color: 'Schwarz',
      size: 'M',
      product: {
        translations: [
          { language: 'de', name: 'Test-Produkt' },
          { language: 'en', name: 'Test product' },
          { language: 'ar', name: 'منتج تجريبي' },
        ],
      },
    }),
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
    // R3 Gap 1 — stock check is now MAX-per-warehouse via findMany, not SUM
    // via aggregate. Default to a single warehouse row with plenty of stock
    // so the happy-path tests keep passing.
    findMany: jest.fn().mockResolvedValue([{ quantityOnHand: 100, quantityReserved: 0 }]),
    updateMany: jest.fn(),
    aggregate: jest.fn().mockResolvedValue({ _sum: { quantityOnHand: 100, quantityReserved: 0 } }),
  },
  // stockReservation.findMany is called by orders.service.create() after
  // emitAsync(ORDER_EVENTS.CREATED) to look up reservation IDs tied to
  // the new order. Defaults to empty — tests that care about the
  // reservationIds write override this with a mockResolvedValueOnce.
  stockReservation: {
    findMany: jest.fn().mockResolvedValue([]),
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

    // Regression for 15.04.2026 incident: emitAsync return value cannot
    // be trusted for @OnEvent(..., { async: true }) listeners in
    // @nestjs/event-emitter 3.x, so we query the StockReservation table
    // directly AFTER emitAsync and use those IDs. This test verifies
    // that path: a successful reservation write ends up in notes even
    // if the event emitter returns an empty array.
    it('schreibt reservationIds in notes via direkter DB-Query (nicht via emitAsync-return)', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ seq: 1 }])
      mockPrisma.productVariant.findMany.mockResolvedValue([makeVariant('v1', 'SKU-001')])
      mockPrisma.order.create.mockResolvedValue(makeOrder('order1'))
      mockPrisma.order.update.mockResolvedValue({})

      // emitAsync returns EMPTY — simulating the broken-return-value case
      mockEventEmitter.emitAsync.mockResolvedValue([])

      // But the DB query finds 2 reservations (the listener DID create them,
      // only their IDs weren't propagated back via the return value)
      mockPrisma.stockReservation.findMany.mockResolvedValueOnce([
        { id: 'res-alpha' },
        { id: 'res-beta' },
      ])

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
        'corr-reservation-db-query',
      )

      // The stockReservation query must have been called with the new order id
      expect(mockPrisma.stockReservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orderId: 'order1', status: 'RESERVED' }),
          select: { id: true },
        }),
      )

      // order.update must have been called with notes containing BOTH reservation ids
      const notesUpdates = mockPrisma.order.update.mock.calls.filter(
        (call: any) => call[0]?.data?.notes?.includes?.('reservationIds'),
      )
      expect(notesUpdates.length).toBeGreaterThanOrEqual(1)
      const savedNotes = JSON.parse(notesUpdates[0][0].data.notes)
      expect(savedNotes.reservationIds).toEqual(['res-alpha', 'res-beta'])
    })

    it('lässt notes unverändert wenn KEINE Reservations gefunden wurden', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ seq: 1 }])
      mockPrisma.productVariant.findMany.mockResolvedValue([makeVariant('v1', 'SKU-001')])
      mockPrisma.order.create.mockResolvedValue(makeOrder('order2'))
      mockPrisma.order.update.mockResolvedValue({})
      mockEventEmitter.emitAsync.mockResolvedValue([])
      mockPrisma.stockReservation.findMany.mockResolvedValueOnce([])  // none

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
        'corr-no-reservations',
      )

      // No call to update() with reservationIds in the payload
      const notesUpdates = mockPrisma.order.update.mock.calls.filter(
        (call: any) => call[0]?.data?.notes?.includes?.('reservationIds'),
      )
      expect(notesUpdates.length).toBe(0)
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

  // ── R3 Gap 1 + Gap 2: Stock-Check MAX-per-Warehouse + structured error ──
  //
  // Covers the regression where a cart line of qty=6 would pass a SUM-over-
  // warehouses check (5+5=10>=6) but then explode inside reserve() because
  // no single warehouse had 6 units available. The new check uses MAX, which
  // agrees with what reserve() can actually do.
  describe('Stock-Check (R3 Gap 1 + Gap 2)', () => {
    function seedBaseCreate() {
      mockPrisma.$queryRaw.mockResolvedValue([{ seq: 1 }])
      mockPrisma.productVariant.findMany.mockResolvedValue([makeVariant('v1', 'SKU-001')])
      mockPrisma.order.create.mockResolvedValue(makeOrder('o1'))
      mockPrisma.order.update.mockResolvedValue({})
      mockEventEmitter.emitAsync.mockResolvedValue([['res1']])
    }

    const basePayload = {
      items: [{ variantId: 'v1', warehouseId: 'wh1', quantity: 6 }],
      countryCode: 'DE',
      shippingAddress: {
        firstName: 'Test', lastName: 'User', street: 'Teststr', houseNumber: '1',
        postalCode: '10117', city: 'Berlin', country: 'DE',
      },
      paymentMethod: 'stripe_card',
      guestEmail: 'test@example.com',
    }

    it('R3 Gap 1: rejects when split stock 5+5 cannot cover qty=6 from any single warehouse', async () => {
      seedBaseCreate()
      // Split stock: 5 in A + 5 in B → MAX=5, cart wants 6 → must reject
      mockPrisma.inventory.findMany.mockResolvedValue([
        { quantityOnHand: 5, quantityReserved: 0 },
        { quantityOnHand: 5, quantityReserved: 0 },
      ])

      let caught: any = null
      try {
        await service.create(basePayload as any, 'user1', 'corr')
      } catch (e: any) {
        caught = e
      }
      expect(caught).not.toBeNull()
      // Even though SUM=10, error must fire because MAX=5 < 6
      expect(caught?.response?.error).toBe('InsufficientStockInAnyWarehouse')
      expect(caught?.response?.data?.maxAvailable).toBe(5)
      expect(caught?.response?.data?.requested).toBe(6)
    })

    it('R3 Gap 1: accepts when ONE warehouse has enough (6 alone, even split rest)', async () => {
      seedBaseCreate()
      mockPrisma.inventory.findMany.mockResolvedValue([
        { quantityOnHand: 6, quantityReserved: 0 }, // This one can cover it
        { quantityOnHand: 2, quantityReserved: 0 },
      ])

      // Should not throw the stock-error; other failures (coupon etc) are fine
      await service.create(basePayload as any, 'user1', 'corr')
      expect(mockPrisma.order.create).toHaveBeenCalled()
    })

    it('R3 Gap 2: error shape includes 3-language message + data payload', async () => {
      seedBaseCreate()
      mockPrisma.inventory.findMany.mockResolvedValue([
        { quantityOnHand: 2, quantityReserved: 0 },
      ])

      try {
        await service.create(basePayload as any, 'user1', 'corr')
        throw new Error('expected throw')
      } catch (e: any) {
        expect(e.response?.statusCode).toBe(409)
        expect(e.response?.error).toBe('InsufficientStockInAnyWarehouse')
        expect(typeof e.response?.message).toBe('object')
        expect(typeof e.response?.message?.de).toBe('string')
        expect(typeof e.response?.message?.en).toBe('string')
        expect(typeof e.response?.message?.ar).toBe('string')
        expect(e.response?.data?.variantId).toBe('v1')
        expect(e.response?.data?.requested).toBe(6)
        expect(e.response?.data?.maxAvailable).toBe(2)
        // Message wording for the 3 locales differs when out-of-stock vs reduce-qty
        expect(e.response?.message?.de).toContain('Nur noch 2')
        expect(e.response?.message?.en).toContain('Only 2')
      }
    })

    it('R3 Gap 2: out-of-stock wording when maxAvailable=0', async () => {
      seedBaseCreate()
      mockPrisma.inventory.findMany.mockResolvedValue([
        { quantityOnHand: 3, quantityReserved: 3 }, // all reserved
      ])

      try {
        await service.create(basePayload as any, 'user1', 'corr')
        throw new Error('expected throw')
      } catch (e: any) {
        expect(e.response?.data?.maxAvailable).toBe(0)
        expect(e.response?.message?.de).toContain('nicht mehr verfügbar')
        expect(e.response?.message?.en).toContain('out of stock')
        expect(e.response?.message?.ar).toContain('غير متوفر')
      }
    })

    it('R3 Gap 2: does NOT leak per-warehouse availability (only maxAvailable)', async () => {
      seedBaseCreate()
      mockPrisma.inventory.findMany.mockResolvedValue([
        { quantityOnHand: 5, quantityReserved: 0 },
        { quantityOnHand: 2, quantityReserved: 0 },
        { quantityOnHand: 1, quantityReserved: 0 },
      ])

      try {
        await service.create(basePayload as any, 'user1', 'corr')
        throw new Error('expected throw')
      } catch (e: any) {
        // Only a single number, not an array of warehouses
        expect(e.response?.data?.maxAvailable).toBe(5)
        expect(e.response?.data?.warehouses).toBeUndefined()
        expect(e.response?.data?.perWarehouse).toBeUndefined()
      }
    })
  })
})
