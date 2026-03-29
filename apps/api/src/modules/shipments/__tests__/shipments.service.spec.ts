import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { ShipmentsService } from '../shipments.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { SHIPMENT_PROVIDERS } from '../shipment-provider.interface'
import { KlarnaProvider } from '../../payments/providers/klarna.provider'
import { PaymentsService } from '../../payments/payments.service'
import { EmailService } from '../../email/email.service'

// ── Mocks ────────────────────────────────────────────────────

const mockPrisma = {
  order: { findFirst: jest.fn(), update: jest.fn() },
  shipment: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  orderStatusHistory: { create: jest.fn() },
  return: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  payment: { update: jest.fn() },
  $transaction: jest.fn().mockImplementation((fn: any) =>
    typeof fn === 'function' ? fn(mockPrisma) : Promise.all(fn),
  ),
}

const mockEventEmitter = { emit: jest.fn() }

const mockDhlProvider = {
  providerName: 'dhl',
  createShipment: jest.fn().mockResolvedValue({
    providerShipmentId: 'DHL-SHP-001',
    trackingNumber: '00340434161094042557',
    trackingUrl: 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=00340434161094042557',
    labelPdf: Buffer.from('fake-pdf'),
  }),
  deleteShipment: jest.fn().mockResolvedValue(undefined),
  createReturnLabel: jest.fn().mockResolvedValue({
    returnTrackingNumber: '00340434161094099999',
    returnLabelPdf: Buffer.from('fake-return-pdf'),
  }),
}

const mockKlarnaProvider = { capturePayment: jest.fn().mockResolvedValue(undefined) }
const mockPaymentsService = { createRefund: jest.fn().mockResolvedValue({ id: 'ref1' }) }
const mockEmailService = { enqueue: jest.fn().mockResolvedValue(undefined) }

// ── Helpers ──────────────────────────────────────────────────

const makeOrder = (overrides = {}) => ({
  id: 'order1',
  orderNumber: 'ORD-20260326-000001',
  status: 'confirmed',
  totalAmount: 119.99,
  deletedAt: null,
  userId: 'user1',
  shippingAddress: {
    firstName: 'Anna', lastName: 'Müller',
    street: 'Hauptstraße', houseNumber: '1',
    postalCode: '10115', city: 'Berlin', country: 'DE',
  },
  shipment: null,
  payment: null,
  returns: [],
  items: [{ quantity: 1, variant: { weightGrams: 500 } }],
  user: { email: 'anna@malak-bekleidung.com', firstName: 'Anna', preferredLang: 'de' },
  ...overrides,
})

// ── Tests ────────────────────────────────────────────────────

describe('ShipmentsService', () => {
  let service: ShipmentsService

  beforeEach(async () => {
    jest.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fn: any) =>
      typeof fn === 'function' ? fn(mockPrisma) : Promise.all(fn),
    )

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: KlarnaProvider, useValue: mockKlarnaProvider },
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: SHIPMENT_PROVIDERS, useValue: [mockDhlProvider] },
      ],
    }).compile()

    service = module.get<ShipmentsService>(ShipmentsService)
  })

  // ── createShipment ─────────────────────────────────────────

  describe('createShipment', () => {
    it('erstellt DHL Sendung mit Tracking-Nummer', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(makeOrder())
      mockPrisma.shipment.create.mockResolvedValue({ id: 'shp1' })
      mockPrisma.order.update.mockResolvedValue({})
      mockPrisma.orderStatusHistory.create.mockResolvedValue({})

      const result = await service.createShipment(
        { orderId: 'order1', carrier: 'dhl' as any },
        'admin1',
        'corr1',
      )

      expect(result.trackingNumber).toBe('00340434161094042557')
      expect(mockDhlProvider.createShipment).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientName: 'Anna Müller',
          postalCode: '10115',
          weight: 500,
        }),
      )
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'shipped' } }),
      )
    })

    it('wirft ConflictException wenn Sendung bereits existiert', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(makeOrder({ shipment: { id: 'shp1' } }))

      await expect(
        service.createShipment({ orderId: 'order1', carrier: 'dhl' as any }, 'admin1', 'corr1'),
      ).rejects.toThrow(ConflictException)
    })

    it('wirft BadRequestException wenn Order-Status nicht passt', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(makeOrder({ status: 'pending' }))

      await expect(
        service.createShipment({ orderId: 'order1', carrier: 'dhl' as any }, 'admin1', 'corr1'),
      ).rejects.toThrow(BadRequestException)
    })

    it('captured Klarna bei Versand automatisch', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(
        makeOrder({ payment: { id: 'pay1', provider: 'KLARNA', status: 'authorized', providerPaymentId: 'klarna-123' } }),
      )
      mockPrisma.shipment.create.mockResolvedValue({ id: 'shp1' })
      mockPrisma.order.update.mockResolvedValue({})
      mockPrisma.orderStatusHistory.create.mockResolvedValue({})
      mockPrisma.payment.update.mockResolvedValue({})

      await service.createShipment({ orderId: 'order1', carrier: 'dhl' as any }, 'admin1', 'corr1')

      expect(mockKlarnaProvider.capturePayment).toHaveBeenCalledWith('klarna-123', 11999)
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'captured' }) }),
      )
    })

    it('emittiert STATUS_CHANGED Event', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(makeOrder())
      mockPrisma.shipment.create.mockResolvedValue({ id: 'shp1' })
      mockPrisma.order.update.mockResolvedValue({})
      mockPrisma.orderStatusHistory.create.mockResolvedValue({})

      await service.createShipment({ orderId: 'order1', carrier: 'dhl' as any }, 'admin1', 'corr1')

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'order.status_changed',
        expect.objectContaining({ toStatus: 'shipped' }),
      )
    })
  })

  // ── updateTrackingStatus ──────────────────────────────────

  describe('updateTrackingStatus', () => {
    it('aktualisiert Shipment + Order Status bei delivered', async () => {
      mockPrisma.shipment.findFirst.mockResolvedValue({
        id: 'shp1', status: 'in_transit', carrier: 'dhl',
        order: { id: 'order1', status: 'shipped', orderNumber: 'ORD-001' },
      })
      mockPrisma.shipment.update.mockResolvedValue({})
      mockPrisma.order.update.mockResolvedValue({})
      mockPrisma.orderStatusHistory.create.mockResolvedValue({})

      await service.updateTrackingStatus('00340434161094042557', 'delivered', 'corr1')

      expect(mockPrisma.shipment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'delivered' }) }),
      )
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'delivered' } }),
      )
    })

    it('ignoriert bereits aktuellen Status', async () => {
      mockPrisma.shipment.findFirst.mockResolvedValue({
        id: 'shp1', status: 'delivered', carrier: 'dhl',
        order: { id: 'order1', status: 'delivered' },
      })

      await service.updateTrackingStatus('tracking', 'delivered', 'corr')
      expect(mockPrisma.shipment.update).not.toHaveBeenCalled()
    })
  })

  // ── createReturnRequest ───────────────────────────────────

  describe('createReturnRequest', () => {
    it('erstellt Rücksendung mit Return-Label innerhalb 14-Tage Frist', async () => {
      const deliveredAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
      mockPrisma.order.findFirst.mockResolvedValue(
        makeOrder({
          status: 'delivered',
          shipment: { id: 'shp1', carrier: 'dhl', deliveredAt, trackingNumber: 'DHL-123' },
          returns: [],
        }),
      )
      mockPrisma.return.create.mockResolvedValue({
        id: 'ret1', status: 'label_sent', returnTrackingNumber: '00340434161094099999',
      })
      mockPrisma.order.update.mockResolvedValue({})

      const result = await service.createReturnRequest(
        'order1',
        { reason: 'wrong_size' as any },
        'user1',
        'corr1',
      )

      expect(result.returnTrackingNumber).toBe('00340434161094099999')
      expect(mockDhlProvider.createReturnLabel).toHaveBeenCalled()
    })

    it('wirft BadRequestException wenn 14-Tage abgelaufen', async () => {
      const deliveredAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) // 20 days ago
      mockPrisma.order.findFirst.mockResolvedValue(
        makeOrder({
          status: 'delivered',
          shipment: { id: 'shp1', carrier: 'dhl', deliveredAt, trackingNumber: 'DHL-123' },
          returns: [],
        }),
      )

      await expect(
        service.createReturnRequest('order1', { reason: 'wrong_size' as any }, 'user1', 'corr1'),
      ).rejects.toThrow(BadRequestException)
    })

    it('wirft ConflictException bei doppeltem Return-Request', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(
        makeOrder({
          status: 'delivered',
          shipment: { id: 'shp1', deliveredAt: new Date() },
          returns: [{ id: 'ret1', status: 'requested' }],
        }),
      )

      await expect(
        service.createReturnRequest('order1', { reason: 'wrong_size' as any }, 'user1', 'corr1'),
      ).rejects.toThrow(ConflictException)
    })

    it('wirft BadRequestException wenn Bestellung nicht delivered', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(
        makeOrder({ status: 'shipped', shipment: { id: 'shp1', deliveredAt: null }, returns: [] }),
      )

      await expect(
        service.createReturnRequest('order1', { reason: 'wrong_size' as any }, 'user1', 'corr1'),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ── markReturnReceived ────────────────────────────────────

  describe('markReturnReceived', () => {
    it('markiert Return als received und löst Auto-Refund aus', async () => {
      mockPrisma.return.findFirst.mockResolvedValue({
        id: 'ret1', status: 'in_transit', reason: 'wrong_size',
        order: { payment: { id: 'pay1', status: 'captured', amount: 119.99 } },
      })
      mockPrisma.return.update.mockResolvedValue({})

      await service.markReturnReceived('ret1', 'admin1', 'corr1')

      expect(mockPaymentsService.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: 'pay1', amount: 11999 }),
        'admin1',
        'corr1',
      )
      expect(mockPrisma.return.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'refunded' }) }),
      )
    })
  })

  // ── cancelShipment ────────────────────────────────────────

  describe('cancelShipment', () => {
    it('storniert Sendung bei DHL wenn noch nicht versendet', async () => {
      mockPrisma.shipment.findFirst.mockResolvedValue({
        id: 'shp1', status: 'label_created', carrier: 'dhl', providerShipmentId: 'DHL-SHP-001',
      })
      mockPrisma.shipment.update.mockResolvedValue({})

      await service.cancelShipment('order1', 'corr1')

      expect(mockDhlProvider.deleteShipment).toHaveBeenCalledWith('DHL-SHP-001')
      expect(mockPrisma.shipment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'cancelled' } }),
      )
    })

    it('wirft BadRequestException wenn bereits versendet', async () => {
      mockPrisma.shipment.findFirst.mockResolvedValue({
        id: 'shp1', status: 'in_transit', carrier: 'dhl',
      })

      await expect(service.cancelShipment('order1', 'corr1')).rejects.toThrow(BadRequestException)
    })
  })
})
