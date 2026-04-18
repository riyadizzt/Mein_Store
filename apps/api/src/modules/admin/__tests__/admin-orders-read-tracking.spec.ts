/**
 * Admin-order read-tracking tests.
 *
 * Covers the Gmail-inbox behaviour introduced on 17.04.2026: findOne() now
 * marks the order as viewed on the first admin detail-open and leaves it
 * alone on every subsequent open. The sidebar "unread" badge decrements
 * as admins click through orders.
 *
 * All prisma access is mocked — the tests exercise the pure business logic.
 */
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { AdminOrdersService } from '../services/admin-orders.service'
import { AuditService } from '../services/audit.service'
import { NotificationService } from '../services/notification.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { PaymentsService } from '../../payments/payments.service'
import { ShipmentsService } from '../../shipments/shipments.service'
import { EmailService } from '../../email/email.service'
import { ReservationService } from '../../inventory/reservation.service'

function buildPrisma(orderRow: any) {
  const mock: any = {
    order: {
      findFirst: jest.fn().mockResolvedValue(orderRow),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    adminNote: { findMany: jest.fn().mockResolvedValue([]) },
    // R4 added: findOne now fetches active stock reservations to decorate
    // items[] with their fulfillmentWarehouse. The read-tracking tests don't
    // care about that data — an empty array is enough to satisfy the call.
    stockReservation: { findMany: jest.fn().mockResolvedValue([]) },
  }
  return mock
}

async function makeService(prisma: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AdminOrdersService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: { log: jest.fn() } },
      { provide: NotificationService, useValue: { create: jest.fn(), createForAllAdmins: jest.fn() } },
      { provide: PaymentsService, useValue: {} },
      { provide: ShipmentsService, useValue: {} },
      { provide: EmailService, useValue: { enqueue: jest.fn() } },
      { provide: EventEmitter2, useValue: { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) } },
      { provide: ReservationService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
    ],
  }).compile()
  return module.get(AdminOrdersService)
}

const baseOrder = {
  id: 'order-1',
  orderNumber: 'ORD-2026-00001',
  deletedAt: null,
  status: 'pending',
  firstViewedByAdminAt: null,
  firstViewedByAdmin: null,
  user: null,
  items: [],
  payment: null,
  shipment: null,
  returns: [],
  statusHistory: [],
  shippingAddress: null,
  fulfillmentWarehouse: null,
}

describe('AdminOrdersService.findOne — read-tracking', () => {
  beforeEach(() => jest.clearAllMocks())

  it('marks the order as viewed on first open (adminId provided, firstViewedByAdminAt is null)', async () => {
    const prisma = buildPrisma(baseOrder)
    const svc = await makeService(prisma)

    await svc.findOne('order-1', 'admin-42')

    // Let the fire-and-forget update complete its microtask.
    await new Promise((resolve) => setImmediate(resolve))

    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1', firstViewedByAdminAt: null },
        data: expect.objectContaining({
          firstViewedByAdminAt: expect.any(Date),
          firstViewedByAdmin: 'admin-42',
        }),
      }),
    )
  })

  it('does NOT mark again on subsequent open — first writer wins (firstViewedByAdminAt already set)', async () => {
    const prisma = buildPrisma({
      ...baseOrder,
      firstViewedByAdminAt: new Date('2026-04-15T10:00:00Z'),
      firstViewedByAdmin: 'admin-first',
    })
    const svc = await makeService(prisma)

    await svc.findOne('order-1', 'admin-later')

    await new Promise((resolve) => setImmediate(resolve))
    expect(prisma.order.updateMany).not.toHaveBeenCalled()
  })

  it('does NOT mark when adminId is undefined (e.g. unauthenticated read path)', async () => {
    const prisma = buildPrisma(baseOrder)
    const svc = await makeService(prisma)

    await svc.findOne('order-1' /* no adminId */)

    await new Promise((resolve) => setImmediate(resolve))
    expect(prisma.order.updateMany).not.toHaveBeenCalled()
  })

  it('never propagates updateMany failures to the caller (fire-and-forget safety)', async () => {
    const prisma = buildPrisma(baseOrder)
    prisma.order.updateMany.mockRejectedValue(new Error('DB timeout'))
    const svc = await makeService(prisma)

    // Detail-view must return successfully even if the tracking write fails.
    const result = await svc.findOne('order-1', 'admin-42')
    expect(result).toMatchObject({ id: 'order-1', orderNumber: 'ORD-2026-00001' })
    // Let the rejected promise settle to avoid unhandled-rejection warnings.
    await new Promise((resolve) => setImmediate(resolve))
  })

  it('uses the atomic updateMany-WHERE-IS-NULL pattern so concurrent opens do not overwrite', async () => {
    // Prisma's updateMany with WHERE clause guarantees first-writer-wins
    // semantics at the DB layer. This test asserts the WHERE clause is
    // present — without it, two simultaneous tabs could both succeed and
    // the later write would clobber the earlier firstViewedByAdmin id.
    const prisma = buildPrisma(baseOrder)
    const svc = await makeService(prisma)

    await svc.findOne('order-1', 'admin-42')
    await new Promise((resolve) => setImmediate(resolve))

    const call = prisma.order.updateMany.mock.calls[0][0]
    expect(call.where.firstViewedByAdminAt).toBe(null)
  })
})
