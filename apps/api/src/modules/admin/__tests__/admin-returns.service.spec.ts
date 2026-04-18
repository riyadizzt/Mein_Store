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
    inventory: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    inventoryMovement: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    stockReservation: {
      findFirst: jest.fn(),
    },
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

  // ── R10-B Teil 1: restockItem warehouse fallback chain ────────
  //
  // restockItem is private; we drive it through inspect() with
  // condition='ok'. Each test shapes the prisma mocks to force a
  // different branch of the chain to win, then asserts the update+
  // movement landed at the expected warehouse.
  describe('R10-B Teil 1 — restockItem warehouse fallback chain', () => {
    function makeReceivedReturn(variantId = 'v1', orderItemId = 'oi1', qty = 2) {
      return {
        ...baseReturn,
        id: 'ret1',
        status: 'received',
        returnNumber: 'RET-2026-00001',
        returnItems: [{ itemId: orderItemId, variantId, quantity: qty, unitPrice: 10 }],
        order: {
          ...baseReturn.order,
          id: 'order1',
          items: [
            {
              id: orderItemId,
              variantId,
              snapshotName: 'Test',
              snapshotSku: 'MAL-T-001',
              quantity: qty,
              unitPrice: 10,
              totalPrice: 20,
            },
          ],
        },
      }
    }

    it('1. explicit warehouseId im Inspect → Restock landet dort', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      // Scanner/Reservation nicht befragt weil explicit WH
      prisma.inventory.findFirst.mockResolvedValue({
        id: 'inv-explicit',
        variantId: 'v1',
        warehouseId: 'wh-explicit',
        quantityOnHand: 5,
        quantityReserved: 0,
      })

      const service = await makeService(prisma)
      await service.inspect(
        'ret1',
        [{ itemId: 'oi1', condition: 'ok', warehouseId: 'wh-explicit' }],
        'admin1',
        '127.0.0.1',
      )

      // inventory.findFirst should have been called with the explicit WH
      expect(prisma.inventory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { variantId: 'v1', warehouseId: 'wh-explicit' },
        }),
      )
      // Movement was created at wh-explicit
      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ warehouseId: 'wh-explicit', type: 'return_received' }),
        }),
      )
    })

    it('2. Edge-case: Scanner-Fallback in restockItem greift nur wenn Dedup-Guard NICHT trifft', async () => {
      // The scanner-based fallback in restockItem() exists as a safety net
      // for the case where the Dedup-Guard (Teil 2) was bypassed — e.g. a
      // legacy movement without the expected "Return scan:" notes prefix,
      // or a manually-deleted scanner row. Under the NORMAL flow, the
      // Dedup-Guard wins first and restockItem is never called.
      //
      // This test sets up such an edge case: a scanner-like movement exists
      // in the restockItem-specific lookup but the Dedup-Guard returns null.
      // To simulate: return null on the first findFirst call (Dedup-Guard),
      // return the scanner movement on the second (restockItem fallback).
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      prisma.inventoryMovement.findFirst
        .mockResolvedValueOnce(null) // Dedup-Guard: no scanner found → falls through
        .mockResolvedValueOnce({ warehouseId: 'wh-scanner' }) // restockItem fallback
      prisma.inventory.findFirst.mockResolvedValue({
        id: 'inv-scanner',
        variantId: 'v1',
        warehouseId: 'wh-scanner',
        quantityOnHand: 3,
        quantityReserved: 0,
      })

      const service = await makeService(prisma)
      await service.inspect('ret1', [{ itemId: 'oi1', condition: 'ok' }], 'admin1', '127.0.0.1')

      // Both lookups ran (dedup first, then restockItem's scanner fallback)
      expect(prisma.inventoryMovement.findFirst).toHaveBeenCalledTimes(2)
      // Inventory-fetch aims at the scanner's warehouse (from restockItem fallback)
      expect(prisma.inventory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { variantId: 'v1', warehouseId: 'wh-scanner' },
        }),
      )
    })

    it('3. kein Scanner, aber Reservation existiert → Reservation-Warehouse gewinnt', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      prisma.inventoryMovement.findFirst.mockResolvedValue(null)
      prisma.stockReservation.findFirst.mockResolvedValue({
        warehouseId: 'wh-reservation',
      })
      prisma.inventory.findFirst.mockResolvedValue({
        id: 'inv-res',
        variantId: 'v1',
        warehouseId: 'wh-reservation',
        quantityOnHand: 1,
        quantityReserved: 0,
      })

      const service = await makeService(prisma)
      await service.inspect('ret1', [{ itemId: 'oi1', condition: 'ok' }], 'admin1', '127.0.0.1')

      expect(prisma.stockReservation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            variantId: 'v1',
            orderId: 'order1',
            status: { in: ['RESERVED', 'CONFIRMED', 'RELEASED'] },
          }),
        }),
      )
      expect(prisma.inventory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { variantId: 'v1', warehouseId: 'wh-reservation' },
        }),
      )
    })

    it('4. nichts resolved → Fallback auf Default-Warehouse (isDefault ordering)', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      prisma.inventoryMovement.findFirst.mockResolvedValue(null)
      prisma.stockReservation.findFirst.mockResolvedValue(null)
      // Default-Fallback path: findFirst WITHOUT explicit warehouseId
      prisma.inventory.findFirst.mockResolvedValue({
        id: 'inv-default',
        variantId: 'v1',
        warehouseId: 'wh-default',
        quantityOnHand: 0,
        quantityReserved: 0,
      })

      const service = await makeService(prisma)
      await service.inspect('ret1', [{ itemId: 'oi1', condition: 'ok' }], 'admin1', '127.0.0.1')

      // The final call uses isDefault-ordered lookup (no concrete warehouseId)
      const defaultLookup = prisma.inventory.findFirst.mock.calls.find((c: any[]) =>
        c[0]?.orderBy?.warehouse?.isDefault === 'desc',
      )
      expect(defaultLookup).toBeDefined()
    })

    it('5. explicit WH ohne Inventory-Row → erstellt Row statt 500', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      // Findet keine Row bei explicit WH
      prisma.inventory.findFirst.mockResolvedValue(null)
      prisma.inventory.create.mockResolvedValue({
        id: 'inv-new',
        variantId: 'v1',
        warehouseId: 'wh-explicit',
        quantityOnHand: 0,
        quantityReserved: 0,
      })

      const service = await makeService(prisma)
      await service.inspect(
        'ret1',
        [{ itemId: 'oi1', condition: 'ok', warehouseId: 'wh-explicit' }],
        'admin1',
        '127.0.0.1',
      )

      expect(prisma.inventory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            variantId: 'v1',
            warehouseId: 'wh-explicit',
            quantityOnHand: 0,
          }),
        }),
      )
    })
  })

  // ── R10-B Teil 2: Dedup-Guard against double-restock ─────────
  //
  // The Scanner-Flow (admin-inventory.service.ts:processReturnScan) booked
  // the return into a concrete warehouse. The Inspect-Flow normally runs
  // AFTER the scanner, so without guard, condition=ok would add a second
  // return_received movement. This block verifies that the guard:
  //   A) skips restockItem when a scanner movement exists
  //   B) still runs restockItem when there is no scanner movement (legacy)
  //   C) emits the dedicated audit action only when skips happened
  //   D) damaged condition is unaffected by the guard (damage = no restock anyway)
  describe('R10-B Teil 2 — Dedup-Guard gegen Double-Restock', () => {
    function makeReceivedReturn(variantId = 'v1', orderItemId = 'oi1', qty = 2) {
      return {
        ...baseReturn,
        id: 'ret1',
        status: 'received',
        returnNumber: 'RET-2026-00001',
        returnItems: [{ itemId: orderItemId, variantId, quantity: qty, unitPrice: 10 }],
        order: {
          ...baseReturn.order,
          id: 'order1',
          items: [
            {
              id: orderItemId,
              variantId,
              snapshotName: 'Test',
              snapshotSku: 'MAL-T-001',
              quantity: qty,
              unitPrice: 10,
              totalPrice: 20,
            },
          ],
        },
      }
    }

    it('A. Scanner-Movement existiert → Dedup greift → KEIN zweiter restockItem-Call', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      // Dedup-Guard findet das scanner-movement:
      prisma.inventoryMovement.findFirst.mockResolvedValue({
        id: 'scanner-move-1',
        warehouseId: 'wh-scanner',
      })

      const service = await makeService(prisma)
      await service.inspect('ret1', [{ itemId: 'oi1', condition: 'ok' }], 'admin1', '127.0.0.1')

      // Dedup-Guard-Query lief:
      expect(prisma.inventoryMovement.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            variantId: 'v1',
            type: 'return_received',
            notes: { startsWith: 'Return scan: RET-2026-00001' },
          }),
        }),
      )
      // KEIN inventory.update (restockItem wurde nicht aufgerufen)
      expect(prisma.inventory.update).not.toHaveBeenCalled()
      // KEIN zweiter inventoryMovement.create (kein Double-Booking)
      expect(prisma.inventoryMovement.create).not.toHaveBeenCalled()
    })

    it('B. Kein Scanner-Movement → Dedup greift NICHT → restockItem läuft normal', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      // Dedup-Guard findet NICHTS:
      prisma.inventoryMovement.findFirst.mockResolvedValue(null)
      prisma.stockReservation.findFirst.mockResolvedValue(null)
      prisma.inventory.findFirst.mockResolvedValue({
        id: 'inv1',
        variantId: 'v1',
        warehouseId: 'wh-default',
        quantityOnHand: 5,
        quantityReserved: 0,
      })

      const service = await makeService(prisma)
      await service.inspect('ret1', [{ itemId: 'oi1', condition: 'ok' }], 'admin1', '127.0.0.1')

      // inventory.update wurde ausgeführt (legacy / edge case path)
      expect(prisma.inventory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { quantityOnHand: { increment: 2 } },
        }),
      )
      // inventoryMovement.create für den Restock
      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'return_received' }),
        }),
      )
    })

    it('C. Audit-Action RETURN_INSPECTED_NO_DOUBLE_RESTOCK nur bei Skip', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      prisma.inventoryMovement.findFirst.mockResolvedValue({ warehouseId: 'wh-scanner' })

      // We need AuditService's log method to be spy-able. It's injected as
      // the real class with its prisma-backed impl, but prisma.adminAuditLog
      // already has create: jest.fn() via buildPrisma.
      const service = await makeService(prisma)
      await service.inspect('ret1', [{ itemId: 'oi1', condition: 'ok' }], 'admin1', '127.0.0.1')

      // Two audit calls expected: RETURN_INSPECTED + RETURN_INSPECTED_NO_DOUBLE_RESTOCK
      const actions = prisma.adminAuditLog.create.mock.calls.map((c: any[]) => c[0]?.data?.action)
      expect(actions).toContain('RETURN_INSPECTED')
      expect(actions).toContain('RETURN_INSPECTED_NO_DOUBLE_RESTOCK')
    })

    it('D. Kein Dedup-Audit wenn kein Skip (normaler Restock)', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      prisma.inventoryMovement.findFirst.mockResolvedValue(null) // no scanner
      prisma.stockReservation.findFirst.mockResolvedValue(null)
      prisma.inventory.findFirst.mockResolvedValue({
        id: 'inv1', variantId: 'v1', warehouseId: 'wh1',
        quantityOnHand: 0, quantityReserved: 0,
      })

      const service = await makeService(prisma)
      await service.inspect('ret1', [{ itemId: 'oi1', condition: 'ok' }], 'admin1', '127.0.0.1')

      const actions = prisma.adminAuditLog.create.mock.calls.map((c: any[]) => c[0]?.data?.action)
      expect(actions).toContain('RETURN_INSPECTED')
      expect(actions).not.toContain('RETURN_INSPECTED_NO_DOUBLE_RESTOCK')
    })

    it('E. Damaged-Condition: Dedup-Lookup passiert im createDamagedMovement (Teil 3), nicht im ok-Pfad', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      // No scanner movement → damaged falls to legacy "documentation only" branch
      prisma.inventoryMovement.findFirst.mockResolvedValue(null)
      prisma.inventory.findFirst.mockResolvedValue({
        id: 'inv1', variantId: 'v1', warehouseId: 'wh1',
        quantityOnHand: 5, quantityReserved: 0,
      })

      const service = await makeService(prisma)
      await service.inspect('ret1', [{ itemId: 'oi1', condition: 'damaged' }], 'admin1', '127.0.0.1')

      // NO ok-path dedup skip was recorded (dedupSkipCount stays 0)
      const actions = prisma.adminAuditLog.create.mock.calls.map((c: any[]) => c[0]?.data?.action)
      expect(actions).not.toContain('RETURN_INSPECTED_NO_DOUBLE_RESTOCK')
      // No inventory.update for damaged-without-scanner (legacy doc-only)
      expect(prisma.inventory.update).not.toHaveBeenCalled()
    })
  })

  // ── R10-B Teil 3: Damaged-Pfad mit echtem Decrement ───────────
  //
  // When the scanner has already booked the return into a warehouse AND
  // the admin marks the item as damaged, the stock must leave the
  // sellable bucket. This block verifies:
  //   A) Scanner exists + damaged → real decrement at scanner warehouse
  //   B) No scanner + damaged → no decrement (legacy doc-only)
  //   C) Audit action RETURN_DAMAGED_REMOVED_FROM_STOCK fires only on decrement
  //   D) Scanner exists but inventory row gone → logs + skips safely
  //   E) Movement notes differentiate the two paths for auditability
  describe('R10-B Teil 3 — Damaged-Pfad mit echtem Decrement', () => {
    function makeReceivedReturn(variantId = 'v1', orderItemId = 'oi1', qty = 2) {
      return {
        ...baseReturn,
        id: 'ret1',
        status: 'received',
        returnNumber: 'RET-2026-00001',
        returnItems: [{ itemId: orderItemId, variantId, quantity: qty, unitPrice: 10 }],
        order: {
          ...baseReturn.order,
          id: 'order1',
          items: [
            {
              id: orderItemId,
              variantId,
              snapshotName: 'Test',
              snapshotSku: 'MAL-T-001',
              quantity: qty,
              unitPrice: 10,
              totalPrice: 20,
            },
          ],
        },
      }
    }

    it('A. Scanner + damaged → Decrement im Scanner-Warehouse', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      // Scanner-Movement vorhanden
      prisma.inventoryMovement.findFirst.mockResolvedValue({
        warehouseId: 'wh-scanner',
      })
      // Inventory-Row am Scanner-WH vorhanden
      prisma.inventory.findFirst.mockResolvedValue({
        id: 'inv-scanner',
        variantId: 'v1',
        warehouseId: 'wh-scanner',
        quantityOnHand: 5,
        quantityReserved: 0,
      })

      const service = await makeService(prisma)
      await service.inspect('ret1', [{ itemId: 'oi1', condition: 'damaged' }], 'admin1', '127.0.0.1')

      // Decrement wurde ausgeführt
      expect(prisma.inventory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { quantityOnHand: { decrement: 2 } },
        }),
      )
      // Movement type=damaged, quantity negativ, Before=5 After=3
      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'damaged',
            quantity: -2,
            quantityBefore: 5,
            quantityAfter: 3,
            warehouseId: 'wh-scanner',
            notes: expect.stringContaining('Damaged removal after scan'),
          }),
        }),
      )
    })

    it('B. Kein Scanner + damaged → legacy doc-only (kein Decrement)', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      prisma.inventoryMovement.findFirst.mockResolvedValue(null) // no scanner
      prisma.inventory.findFirst.mockResolvedValue({
        id: 'inv-default',
        variantId: 'v1',
        warehouseId: 'wh-default',
        quantityOnHand: 10,
        quantityReserved: 0,
      })

      const service = await makeService(prisma)
      await service.inspect('ret1', [{ itemId: 'oi1', condition: 'damaged' }], 'admin1', '127.0.0.1')

      // KEIN inventory.update
      expect(prisma.inventory.update).not.toHaveBeenCalled()
      // Movement mit Before==After (doc-only)
      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'damaged',
            quantityBefore: 10,
            quantityAfter: 10,
            notes: expect.stringContaining('no scan'),
          }),
        }),
      )
    })

    it('C. Audit RETURN_DAMAGED_REMOVED_FROM_STOCK nur bei Decrement', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      prisma.inventoryMovement.findFirst.mockResolvedValue({ warehouseId: 'wh-s' })
      prisma.inventory.findFirst.mockResolvedValue({
        id: 'inv-s', variantId: 'v1', warehouseId: 'wh-s',
        quantityOnHand: 5, quantityReserved: 0,
      })

      const service = await makeService(prisma)
      await service.inspect('ret1', [{ itemId: 'oi1', condition: 'damaged' }], 'admin1', '127.0.0.1')

      const actions = prisma.adminAuditLog.create.mock.calls.map((c: any[]) => c[0]?.data?.action)
      expect(actions).toContain('RETURN_INSPECTED')
      expect(actions).toContain('RETURN_DAMAGED_REMOVED_FROM_STOCK')
    })

    it('D. Kein RETURN_DAMAGED_REMOVED_FROM_STOCK wenn kein Decrement passierte', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      prisma.inventoryMovement.findFirst.mockResolvedValue(null) // no scanner
      prisma.inventory.findFirst.mockResolvedValue({
        id: 'inv1', variantId: 'v1', warehouseId: 'wh1',
        quantityOnHand: 3, quantityReserved: 0,
      })

      const service = await makeService(prisma)
      await service.inspect('ret1', [{ itemId: 'oi1', condition: 'damaged' }], 'admin1', '127.0.0.1')

      const actions = prisma.adminAuditLog.create.mock.calls.map((c: any[]) => c[0]?.data?.action)
      expect(actions).not.toContain('RETURN_DAMAGED_REMOVED_FROM_STOCK')
    })

    it('E. Scanner existiert aber Inventory-Row fehlt → safe skip mit Log-Warning', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReceivedReturn())
      prisma.return.update.mockResolvedValue({})
      prisma.inventoryMovement.findFirst.mockResolvedValue({ warehouseId: 'wh-gone' })
      // Inventory-Row fehlt (gelöscht nach Scanner aber vor Inspect)
      prisma.inventory.findFirst.mockResolvedValue(null)

      const service = await makeService(prisma)
      await service.inspect('ret1', [{ itemId: 'oi1', condition: 'damaged' }], 'admin1', '127.0.0.1')

      // KEIN inventory.update (row fehlt)
      expect(prisma.inventory.update).not.toHaveBeenCalled()
      // Movement trotzdem erstellt (Doku) mit warehouseId vom Scanner
      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'damaged',
            warehouseId: 'wh-gone',
            notes: expect.stringContaining('inv row missing'),
          }),
        }),
      )
      // KEIN Dekrement-Audit-Log
      const actions = prisma.adminAuditLog.create.mock.calls.map((c: any[]) => c[0]?.data?.action)
      expect(actions).not.toContain('RETURN_DAMAGED_REMOVED_FROM_STOCK')
    })
  })
})
