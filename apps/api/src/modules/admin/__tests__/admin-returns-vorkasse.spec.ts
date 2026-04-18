/**
 * Vorkasse-specific admin-returns tests.
 *
 * Covers the markRefundTransferred() flow: the admin-only "Banküberweisung
 * ausgeführt" button that flips a Refund row from status=PENDING to PROCESSED
 * after the admin has manually wired the refund amount from the shop bank
 * account. Until this flip happens, Vorkasse refunds are invisible to finance
 * reports (which filter on status='PROCESSED'), causing the reported daily
 * and monthly revenue to be over-reported.
 *
 * The unit tests here mock the Prisma layer entirely — no DB I/O. The guards
 * are the contract: wrong provider, non-PENDING status, missing refund, and
 * the audit-log side effect must all behave as specified.
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
    refund: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
  }
  return mock
}

async function makeService(prisma: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AdminReturnsService,
      AuditService,
      { provide: PrismaService, useValue: prisma },
      { provide: PaymentsService, useValue: { createRefund: jest.fn() } },
      {
        provide: NotificationService,
        useValue: {
          create: jest.fn().mockResolvedValue(undefined),
          createForAllAdmins: jest.fn().mockResolvedValue(undefined),
        },
      },
      { provide: EmailService, useValue: { enqueue: jest.fn() } },
      { provide: EventEmitter2, useValue: { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) } },
      {
        provide: DHLProvider,
        useValue: { createReturnLabel: jest.fn() },
      },
    ],
  }).compile()
  return module.get<AdminReturnsService>(AdminReturnsService)
}

describe('AdminReturnsService.markRefundTransferred', () => {
  let prisma: any
  let svc: AdminReturnsService

  beforeEach(async () => {
    jest.clearAllMocks()
    prisma = buildPrisma()
    svc = await makeService(prisma)
  })

  const pendingVorkasseRefund = {
    id: 'refund-1',
    status: 'PENDING',
    amount: 42.5,
    processedAt: null,
    payment: {
      provider: 'VORKASSE',
      orderId: 'order-1',
      order: { orderNumber: 'ORD-2026-00042' },
    },
  }

  it('flips PENDING→PROCESSED and sets processedAt for Vorkasse refunds (happy path)', async () => {
    prisma.refund.findUnique.mockResolvedValue(pendingVorkasseRefund)
    prisma.refund.update.mockResolvedValue({
      ...pendingVorkasseRefund,
      status: 'PROCESSED',
      processedAt: new Date('2026-04-17T12:00:00Z'),
    })

    const result = await svc.markRefundTransferred('refund-1', 'admin-1', '127.0.0.1')

    expect(prisma.refund.update).toHaveBeenCalledWith({
      where: { id: 'refund-1' },
      data: expect.objectContaining({
        status: 'PROCESSED',
        processedAt: expect.any(Date),
      }),
    })
    expect(result.status).toBe('PROCESSED')
    expect(result.processedAt).toBeInstanceOf(Date)
  })

  it('writes an audit log entry with action VORKASSE_REFUND_CONFIRMED on success', async () => {
    prisma.refund.findUnique.mockResolvedValue(pendingVorkasseRefund)
    prisma.refund.update.mockResolvedValue({
      ...pendingVorkasseRefund,
      status: 'PROCESSED',
      processedAt: new Date(),
    })

    await svc.markRefundTransferred('refund-1', 'admin-42', '10.0.0.5')

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'VORKASSE_REFUND_CONFIRMED',
          entityType: 'refund',
          entityId: 'refund-1',
          adminId: 'admin-42',
          ipAddress: '10.0.0.5',
        }),
      }),
    )
  })

  it('rejects non-Vorkasse refunds with OnlyVorkasseSupported', async () => {
    prisma.refund.findUnique.mockResolvedValue({
      ...pendingVorkasseRefund,
      payment: { provider: 'STRIPE', orderId: 'order-1', order: { orderNumber: 'ORD-X' } },
    })

    await expect(svc.markRefundTransferred('refund-1', 'admin-1', '127.0.0.1')).rejects.toThrow(
      BadRequestException,
    )
    expect(prisma.refund.update).not.toHaveBeenCalled()
  })

  it('rejects already-PROCESSED refunds (idempotency guard) with RefundNotPending', async () => {
    prisma.refund.findUnique.mockResolvedValue({
      ...pendingVorkasseRefund,
      status: 'PROCESSED',
      processedAt: new Date('2026-04-10T00:00:00Z'),
    })

    await expect(svc.markRefundTransferred('refund-1', 'admin-1', '127.0.0.1')).rejects.toThrow(
      BadRequestException,
    )
    expect(prisma.refund.update).not.toHaveBeenCalled()
  })

  it('rejects FAILED refunds with RefundNotPending — they must be re-issued not upgraded', async () => {
    prisma.refund.findUnique.mockResolvedValue({
      ...pendingVorkasseRefund,
      status: 'FAILED',
    })

    await expect(svc.markRefundTransferred('refund-1', 'admin-1', '127.0.0.1')).rejects.toThrow(
      BadRequestException,
    )
    expect(prisma.refund.update).not.toHaveBeenCalled()
  })

  it('rejects non-existent refundId with RefundNotFound', async () => {
    prisma.refund.findUnique.mockResolvedValue(null)

    await expect(svc.markRefundTransferred('ghost-id', 'admin-1', '127.0.0.1')).rejects.toThrow(
      NotFoundException,
    )
    expect(prisma.refund.update).not.toHaveBeenCalled()
  })

  it('does not throw if audit-log write fails (best-effort audit)', async () => {
    prisma.refund.findUnique.mockResolvedValue(pendingVorkasseRefund)
    prisma.refund.update.mockResolvedValue({
      ...pendingVorkasseRefund,
      status: 'PROCESSED',
      processedAt: new Date(),
    })
    prisma.adminAuditLog.create.mockRejectedValue(new Error('audit DB down'))

    // The flip is the critical path — audit failure must NOT roll it back.
    const result = await svc.markRefundTransferred('refund-1', 'admin-1', '127.0.0.1')
    expect(result.status).toBe('PROCESSED')
  })
})
