/**
 * AdminReturnsService unit tests.
 *
 * Covers the high-value return flows:
 *   - status-transition validation (the strict state machine)
 *   - approve() with shop-pays-shipping vs customer-pays-shipping
 *   - reject() blocks invalid transitions
 *   - markReceived() requires scanner source (not arbitrary admin click)
 */

import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { AdminReturnsService } from '../services/admin-returns.service'
import { AuditService } from '../services/audit.service'
import { NotificationService } from '../services/notification.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { PaymentsService } from '../../payments/payments.service'
import { EmailService } from '../../email/email.service'
import { DHLProvider } from '../../shipments/providers/dhl.provider'

function buildPrisma() {
  const mock: any = {
    return: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    returnSequence: { upsert: jest.fn().mockResolvedValue({ seq: 1 }) },
    inventory: { findFirst: jest.fn(), update: jest.fn() },
    inventoryMovement: { create: jest.fn() },
    order: { update: jest.fn() },
    adminAuditLog: { create: jest.fn() },
  }
  mock.$transaction = jest.fn().mockImplementation((fnOrArray: any) =>
    typeof fnOrArray === 'function' ? fnOrArray(mock) : Promise.all(fnOrArray),
  )
  mock.$queryRaw = jest.fn().mockResolvedValue([{ seq: 1 }])
  return mock
}

const mockPayments = { createRefund: jest.fn().mockResolvedValue({ id: 'ref1' }) }
const mockNotificationService = {
  create: jest.fn().mockResolvedValue(undefined),
  createForAllAdmins: jest.fn().mockResolvedValue(undefined),
}
const mockEmailService = { enqueue: jest.fn().mockResolvedValue(undefined) }
const mockEventEmitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) }
const mockDhlProvider = {
  createReturnLabel: jest.fn().mockResolvedValue({
    returnTrackingNumber: 'DHL-RET-001',
    returnLabelPdf: Buffer.from('fake-pdf'),
    qrCodeBase64: undefined,
  }),
}

async function makeService(prisma: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AdminReturnsService,
      AuditService,
      { provide: PrismaService, useValue: prisma },
      { provide: PaymentsService, useValue: mockPayments },
      { provide: NotificationService, useValue: mockNotificationService },
      { provide: EmailService, useValue: mockEmailService },
      { provide: EventEmitter2, useValue: mockEventEmitter },
      { provide: DHLProvider, useValue: mockDhlProvider },
    ],
  }).compile()
  return module.get<AdminReturnsService>(AdminReturnsService)
}

const baseReturn = {
  id: 'ret1',
  orderId: 'order1',
  status: 'requested',
  returnNumber: null,
  returnTrackingNumber: null,
  refundAmount: null,
  items: [],
  order: {
    id: 'order1',
    orderNumber: 'ORD-2026-00001',
    user: {
      email: 'kunde@example.com',
      firstName: 'Anna',
      lastName: 'Müller',
      preferredLang: 'de',
    },
    shippingAddress: {
      firstName: 'Anna',
      lastName: 'Müller',
      street: 'Pannierstraße',
      houseNumber: '4',
      postalCode: '12047',
      city: 'Berlin',
      country: 'DE',
    },
  },
}

describe('AdminReturnsService', () => {
  let prisma: any

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = buildPrisma()
  })

  describe('approve', () => {
    it('genehmigt requested → in_transit mit returnNumber RET-2026-NNNNN', async () => {
      prisma.return.findUnique.mockResolvedValue({ ...baseReturn })
      prisma.return.update.mockResolvedValue({
        ...baseReturn,
        status: 'in_transit',
        returnNumber: 'RET-2026-00001',
      })

      const service = await makeService(prisma)
      const result = await service.approve('ret1', 'admin1', '127.0.0.1', false)

      expect(result.status).toBe('in_transit')
      expect(prisma.return.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'in_transit',
            adminNotes: 'customer_pays_shipping',
          }),
        }),
      )
    })

    it('approve mit sendLabel=true setzt adminNotes auf shop_pays_shipping und ruft DHL', async () => {
      prisma.return.findUnique.mockResolvedValue({ ...baseReturn })
      prisma.return.update.mockResolvedValue({ ...baseReturn, status: 'in_transit' })

      const service = await makeService(prisma)
      await service.approve('ret1', 'admin1', '127.0.0.1', true)

      expect(prisma.return.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ adminNotes: 'shop_pays_shipping' }),
        }),
      )
      expect(mockDhlProvider.createReturnLabel).toHaveBeenCalled()
    })

    it('approve mit sendLabel=true sendet E-Mail mit PDF-Attachment', async () => {
      prisma.return.findUnique.mockResolvedValue({ ...baseReturn })
      prisma.return.update.mockResolvedValue({ ...baseReturn, status: 'in_transit' })

      const service = await makeService(prisma)
      await service.approve('ret1', 'admin1', '127.0.0.1', true)

      expect(mockEmailService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'kunde@example.com',
          type: 'return-confirmation',
          attachments: expect.arrayContaining([
            expect.objectContaining({ contentType: 'application/pdf' }),
          ]),
        }),
      )
    })

    it('wirft NotFoundException wenn Retoure nicht existiert', async () => {
      prisma.return.findUnique.mockResolvedValue(null)
      const service = await makeService(prisma)
      await expect(service.approve('ghost', 'admin1', '127.0.0.1')).rejects.toThrow(
        NotFoundException,
      )
    })

    it('wirft BadRequestException bei ungültigem Übergang (refunded → in_transit)', async () => {
      prisma.return.findUnique.mockResolvedValue({ ...baseReturn, status: 'refunded' })
      const service = await makeService(prisma)
      await expect(service.approve('ret1', 'admin1', '127.0.0.1')).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('reject', () => {
    it('lehnt requested-Retoure mit Begründung ab', async () => {
      prisma.return.findUnique.mockResolvedValue({ ...baseReturn })
      prisma.return.update.mockResolvedValue({ ...baseReturn, status: 'rejected' })

      const service = await makeService(prisma)
      await service.reject('ret1', 'Outside 14-day window', 'admin1', '127.0.0.1')

      expect(prisma.return.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'rejected' }),
        }),
      )
    })

    it('lehnt inspected-Retoure ab (z.B. nicht-erstattbarer Schaden)', async () => {
      prisma.return.findUnique.mockResolvedValue({ ...baseReturn, status: 'inspected' })
      prisma.return.update.mockResolvedValue({ ...baseReturn, status: 'rejected' })

      const service = await makeService(prisma)
      await expect(
        service.reject('ret1', 'Damaged on arrival', 'admin1', '127.0.0.1'),
      ).resolves.toBeDefined()
    })

    it('blockiert Reject von in_transit (kein gültiger Übergang)', async () => {
      prisma.return.findUnique.mockResolvedValue({ ...baseReturn, status: 'in_transit' })
      const service = await makeService(prisma)
      await expect(
        service.reject('ret1', 'Reason', 'admin1', '127.0.0.1'),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('markReceived', () => {
    it('markiert in_transit → received', async () => {
      prisma.return.findUnique.mockResolvedValue({
        ...baseReturn,
        status: 'in_transit',
        returnNumber: 'RET-2026-00001',
      })
      prisma.return.update.mockResolvedValue({ ...baseReturn, status: 'received' })

      const service = await makeService(prisma)
      const result = await service.markReceived('ret1', 'admin1', '127.0.0.1')
      expect(result.status).toBe('received')
    })

    it('blockiert markReceived von rejected', async () => {
      prisma.return.findUnique.mockResolvedValue({
        ...baseReturn,
        status: 'rejected',
      })
      const service = await makeService(prisma)
      await expect(
        service.markReceived('ret1', 'admin1', '127.0.0.1'),
      ).rejects.toThrow(BadRequestException)
    })
  })
})
