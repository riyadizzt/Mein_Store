import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { AuditService } from '../services/audit.service'
import { NotificationService } from '../services/notification.service'
import { AdminOrdersService } from '../services/admin-orders.service'
import { AdminUsersService } from '../services/admin-users.service'
import { AdminProductsService } from '../services/admin-products.service'
import { AdminInventoryService } from '../services/admin-inventory.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { PaymentsService } from '../../payments/payments.service'
import { ShipmentsService } from '../../shipments/shipments.service'
import { EmailService } from '../../email/email.service'
import { ReservationService } from '../../inventory/reservation.service'

const mockNotificationService = {
  create: jest.fn().mockResolvedValue(undefined),
  createForAllAdmins: jest.fn().mockResolvedValue(undefined),
}
const mockEmailService = { enqueue: jest.fn().mockResolvedValue(undefined) }
const mockEventEmitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) }

// ── Mocks ────────────────────────────────────────────────────

const mockPrisma = {
  adminAuditLog: { create: jest.fn(), findMany: jest.fn() },
  adminNote: { create: jest.fn(), findMany: jest.fn() },
  order: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), aggregate: jest.fn(), groupBy: jest.fn() },
  orderStatusHistory: { create: jest.fn() },
  user: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  product: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
  orderItem: { count: jest.fn() },
  productReview: { count: jest.fn() },
  coupon: { count: jest.fn() },
  promotion: { count: jest.fn() },
  inventory: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), upsert: jest.fn(), create: jest.fn() },
  inventoryMovement: { create: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
  warehouse: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  stockReservation: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  stocktake: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), delete: jest.fn(), update: jest.fn() },
  stocktakeItem: { findUnique: jest.fn(), update: jest.fn() },
  category: { findMany: jest.fn() },
  productVariant: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: { updateMany: jest.fn() },
  $transaction: jest.fn().mockImplementation((fnOrArray: any) =>
    typeof fnOrArray === 'function' ? fnOrArray(mockPrisma) : Promise.all(fnOrArray),
  ),
}

const mockPayments = { createRefund: jest.fn().mockResolvedValue({ id: 'ref1' }) }
const mockShipments = { cancelShipment: jest.fn().mockResolvedValue(undefined) }

// ── Tests ────────────────────────────────────────────────────

describe('Admin — AuditService', () => {
  let auditService: AuditService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile()
    auditService = module.get(AuditService)
  })

  it('erstellt Audit-Log-Eintrag', async () => {
    mockPrisma.adminAuditLog.create.mockResolvedValue({ id: 'log1' })

    await auditService.log({
      adminId: 'admin1',
      action: 'ORDER_CANCELLED',
      entityType: 'order',
      entityId: 'order1',
      changes: { before: { status: 'confirmed' }, after: { status: 'cancelled' } },
      ipAddress: '127.0.0.1',
    })

    expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ORDER_CANCELLED',
          entityType: 'order',
          adminId: 'admin1',
        }),
      }),
    )
  })
})

describe('Admin — AdminOrdersService', () => {
  let ordersService: AdminOrdersService

  beforeEach(async () => {
    jest.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fnOrArray: any) =>
      typeof fnOrArray === 'function' ? fnOrArray(mockPrisma) : Promise.all(fnOrArray),
    )

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminOrdersService,
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaymentsService, useValue: mockPayments },
        { provide: ShipmentsService, useValue: mockShipments },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        // Mock ReservationService — AdminOrdersService now injects it to
        // release reservations via the race-safe service method instead of
        // manually deleting DB rows and inflating quantityOnHand.
        { provide: ReservationService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile()
    ordersService = module.get(AdminOrdersService)
  })

  it('ändert Bestellstatus mit Pflicht-Kommentar', async () => {
    mockPrisma.order.findFirst.mockResolvedValue({ id: 'o1', status: 'confirmed' })
    mockPrisma.order.update.mockResolvedValue({ status: 'processing' })
    mockPrisma.orderStatusHistory.create.mockResolvedValue({})
    mockPrisma.adminAuditLog.create.mockResolvedValue({})

    const result = await ordersService.updateStatus('o1', 'processing', 'Ware wird gepackt', 'admin1', '127.0.0.1')
    expect(result.status).toBe('processing')
  })

  it('akzeptiert Status-Update auch ohne Begründung (notes optional)', async () => {
    mockPrisma.order.findFirst.mockResolvedValue({ id: 'o1', status: 'confirmed' })
    mockPrisma.order.update.mockResolvedValue({ status: 'processing' })
    mockPrisma.orderStatusHistory.create.mockResolvedValue({})

    const result = await ordersService.updateStatus('o1', 'processing', '', 'admin1', '127.0.0.1')
    expect(result.status).toBe('processing')
    // Empty notes should be normalized to null in the cancellation path; here we just verify no throw.
  })

  it('storniert + refunded automatisch', async () => {
    mockPrisma.order.findFirst.mockResolvedValue({
      id: 'o1', status: 'confirmed', deletedAt: null,
      payment: { id: 'pay1', status: 'captured', amount: 119.99 },
    })
    mockPrisma.order.update.mockResolvedValue({ status: 'cancelled' })
    mockPrisma.orderStatusHistory.create.mockResolvedValue({})
    mockPrisma.adminAuditLog.create.mockResolvedValue({})

    const result = await ordersService.cancelWithRefund('o1', 'Kundenwunsch', 'admin1', '127.0.0.1')

    expect(result.cancelled).toBe(true)
    expect(result.refunded).toBe(true)
    expect(mockPayments.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'pay1', amount: 11999 }),
      'admin1',
      expect.any(String),
    )
  })

  it('fügt Admin-Notiz hinzu', async () => {
    mockPrisma.adminNote.create.mockResolvedValue({ id: 'note1', content: 'Test' })
    const note = await ordersService.addNote('o1', 'Kundenrückfrage', 'admin1')
    expect(note.content).toBe('Test')
  })

  // ── R5: Per-Line Warehouse Change ────────────────────────────
  describe('changeItemWarehouse (R5)', () => {
    const baseOrder = {
      id: 'o1',
      orderNumber: 'ORD-2026-00001',
      deletedAt: null,
      status: 'confirmed',
      items: [
        {
          id: 'item-1',
          variantId: 'v1',
          quantity: 2,
          snapshotName: 'Test Shirt',
          snapshotSku: 'MAL-T-001',
          variant: {
            color: 'Rot', size: 'M', sku: 'MAL-T-001',
            product: { translations: [{ language: 'de', name: 'Test-Hemd' }] },
          },
        },
      ],
    }

    it('verschiebt eine einzelne Line atomic ins neue Lager', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(baseOrder)
      mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-new', name: 'Hamburg', type: 'WAREHOUSE' })
      mockPrisma.stockReservation.findFirst.mockResolvedValue({
        id: 'res-1', warehouseId: 'wh-old', quantity: 2, status: 'RESERVED',
      })
      // During the tx: existingInv present, sourceInv reserves, etc.
      mockPrisma.inventory.findFirst
        .mockResolvedValueOnce({ id: 'inv-new', quantityOnHand: 10, quantityReserved: 0 }) // existingInv check
        .mockResolvedValueOnce({ id: 'inv-old', quantityOnHand: 10, quantityReserved: 2 }) // sourceInv check
      mockPrisma.stockReservation.update.mockResolvedValue({})
      mockPrisma.inventory.updateMany.mockResolvedValue({ count: 1 })
      mockPrisma.inventoryMovement.createMany.mockResolvedValue({ count: 2 })
      mockPrisma.adminAuditLog.create.mockResolvedValue({})

      const result = await ordersService.changeItemWarehouse('o1', 'item-1', 'wh-new', 'admin1', '127.0.0.1')
      expect(result.changed).toBe(true)
      expect(result.warehouseName).toBe('Hamburg')

      // Reservation was updated to new warehouse
      expect(mockPrisma.stockReservation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'res-1' }, data: { warehouseId: 'wh-new' } }),
      )
      // Both movements created
      expect(mockPrisma.inventoryMovement.createMany).toHaveBeenCalled()
    })

    it('no-op wenn Ziel-Lager = aktuelles Lager', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(baseOrder)
      mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-same', name: 'Marzahn', type: 'WAREHOUSE' })
      mockPrisma.stockReservation.findFirst.mockResolvedValue({
        id: 'res-1', warehouseId: 'wh-same', quantity: 2, status: 'RESERVED',
      })

      const result = await ordersService.changeItemWarehouse('o1', 'item-1', 'wh-same', 'admin1', '127.0.0.1')
      expect(result.changed).toBe(false)
      expect(mockPrisma.stockReservation.update).not.toHaveBeenCalled()
    })

    it('blockiert für shipped/delivered/cancelled Orders', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ ...baseOrder, status: 'shipped' })

      await expect(
        ordersService.changeItemWarehouse('o1', 'item-1', 'wh-new', 'admin1', '127.0.0.1'),
      ).rejects.toThrow(BadRequestException)
    })

    it('wirft NoActiveReservation wenn keine aktive Reservierung existiert', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(baseOrder)
      mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-new', name: 'Hamburg', type: 'WAREHOUSE' })
      mockPrisma.stockReservation.findFirst.mockResolvedValue(null)

      await expect(
        ordersService.changeItemWarehouse('o1', 'item-1', 'wh-new', 'admin1', '127.0.0.1'),
      ).rejects.toThrow(BadRequestException)
    })

    it('mappt Postgres CHECK-constraint auf 409 StockTransferRequired', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(baseOrder)
      mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-new', name: 'Hamburg', type: 'WAREHOUSE' })
      mockPrisma.stockReservation.findFirst.mockResolvedValue({
        id: 'res-1', warehouseId: 'wh-old', quantity: 5, status: 'RESERVED',
      })
      // Simulate the CHECK-constraint firing during transaction
      mockPrisma.$transaction.mockImplementationOnce(async () => {
        throw new Error('new row for relation "inventory" violates check constraint "inventory_reserved_lte_on_hand"')
      })

      try {
        await ordersService.changeItemWarehouse('o1', 'item-1', 'wh-new', 'admin1', '127.0.0.1')
        throw new Error('should have thrown')
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException)
        expect(e.response?.error).toBe('StockTransferRequired')
        expect(e.response?.message?.de).toContain('Kein Bestand')
      }
    })
  })

  // ── R7: Consolidate Warehouse ────────────────────────────────
  describe('consolidateWarehouse (R7)', () => {
    const baseOrder = {
      id: 'o1',
      orderNumber: 'ORD-2026-00002',
      deletedAt: null,
      status: 'confirmed',
      items: [
        { id: 'i1', variantId: 'v1', quantity: 1, snapshotName: 'A', snapshotSku: 'SKU-A',
          variant: { color: 'Rot', size: 'M', sku: 'SKU-A', product: { translations: [] } } },
        { id: 'i2', variantId: 'v2', quantity: 2, snapshotName: 'B', snapshotSku: 'SKU-B',
          variant: { color: 'Blau', size: 'L', sku: 'SKU-B', product: { translations: [] } } },
      ],
    }

    it('preflight: all items available → consolidate möglich', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(baseOrder)
      mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-target', name: 'Hamburg', type: 'WAREHOUSE' })
      mockPrisma.stockReservation.findMany.mockResolvedValue([
        { id: 'r1', variantId: 'v1', warehouseId: 'wh-source', quantity: 1 },
        { id: 'r2', variantId: 'v2', warehouseId: 'wh-source', quantity: 2 },
      ])
      // Preflight: target has enough for each variant
      mockPrisma.inventory.findFirst
        .mockResolvedValueOnce({ quantityOnHand: 5, quantityReserved: 0 }) // v1 preflight
        .mockResolvedValueOnce({ quantityOnHand: 5, quantityReserved: 0 }) // v2 preflight
        // During tx: existingInv + sourceInv calls per item
        .mockResolvedValue({ id: 'inv', quantityOnHand: 5, quantityReserved: 1 })
      mockPrisma.stockReservation.update.mockResolvedValue({})
      mockPrisma.inventory.updateMany.mockResolvedValue({ count: 1 })
      mockPrisma.inventoryMovement.createMany.mockResolvedValue({ count: 2 })
      mockPrisma.order.update.mockResolvedValue({})
      mockPrisma.adminAuditLog.create.mockResolvedValue({})

      const result = await ordersService.consolidateWarehouse('o1', 'wh-target', 'admin1', '127.0.0.1', true)
      expect(result.changed).toBe(true)
      expect(result.itemsMoved).toBe(2)
    })

    it('preflight: ein Item nicht verfügbar → warnings-response ohne DB-write', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(baseOrder)
      mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-target', name: 'Hamburg', type: 'WAREHOUSE' })
      mockPrisma.stockReservation.findMany.mockResolvedValue([
        { id: 'r1', variantId: 'v1', warehouseId: 'wh-source', quantity: 1 },
        { id: 'r2', variantId: 'v2', warehouseId: 'wh-source', quantity: 5 },
      ])
      // v1 OK, v2 NOT enough in target
      mockPrisma.inventory.findFirst
        .mockResolvedValueOnce({ quantityOnHand: 5, quantityReserved: 0 }) // v1 has 5 free
        .mockResolvedValueOnce({ quantityOnHand: 2, quantityReserved: 0 }) // v2 has only 2 free, needs 5

      const result = await ordersService.consolidateWarehouse('o1', 'wh-target', 'admin1', '127.0.0.1', false)
      expect(result.changed).toBe(false)
      expect(result.needsConfirmation).toBe(true)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings?.[0].needed).toBe(5)
      expect(result.warnings?.[0].available).toBe(2)
      // Nothing was written
      expect(mockPrisma.stockReservation.update).not.toHaveBeenCalled()
      expect(mockPrisma.order.update).not.toHaveBeenCalled()
    })

    it('no-op wenn alle Items bereits im Ziel-Lager', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(baseOrder)
      mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-target', name: 'Hamburg', type: 'WAREHOUSE' })
      mockPrisma.stockReservation.findMany.mockResolvedValue([
        { id: 'r1', variantId: 'v1', warehouseId: 'wh-target', quantity: 1 },
        { id: 'r2', variantId: 'v2', warehouseId: 'wh-target', quantity: 2 },
      ])

      const result = await ordersService.consolidateWarehouse('o1', 'wh-target', 'admin1', '127.0.0.1', false)
      expect(result.changed).toBe(false)
      expect(result.itemsMoved).toBe(0)
    })

    it('blockiert für shipped-Orders', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ ...baseOrder, status: 'shipped' })

      await expect(
        ordersService.consolidateWarehouse('o1', 'wh-target', 'admin1', '127.0.0.1', true),
      ).rejects.toThrow(BadRequestException)
    })

    it('keine Reservations → changed=false, 0 moved, kein Fehler', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(baseOrder)
      mockPrisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-target', name: 'Hamburg', type: 'WAREHOUSE' })
      mockPrisma.stockReservation.findMany.mockResolvedValue([])

      const result = await ordersService.consolidateWarehouse('o1', 'wh-target', 'admin1', '127.0.0.1', true)
      expect(result.changed).toBe(false)
      expect(result.itemsMoved).toBe(0)
    })
  })
})

describe('Admin — AdminUsersService', () => {
  let usersService: AdminUsersService

  beforeEach(async () => {
    jest.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fnOrArray: any) =>
      typeof fnOrArray === 'function' ? fnOrArray(mockPrisma) : Promise.all(fnOrArray),
    )

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile()
    usersService = module.get(AdminUsersService)
  })

  it('sperrt Benutzer mit Begründung', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user1', isBlocked: false })
    mockPrisma.user.update.mockResolvedValue({})
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 })
    mockPrisma.adminAuditLog.create.mockResolvedValue({})

    await usersService.blockUser('user1', 'Betrugsverdacht', 'admin1', '127.0.0.1')

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isBlocked: true, blockReason: 'Betrugsverdacht' }),
      }),
    )
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isRevoked: true } }),
    )
  })

  it('wirft BadRequestException ohne Begründung', async () => {
    await expect(
      usersService.blockUser('user1', '', 'admin1', '127.0.0.1'),
    ).rejects.toThrow(BadRequestException)
  })

  it('entsperrt Benutzer', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user1', isBlocked: true })
    mockPrisma.user.update.mockResolvedValue({})
    mockPrisma.adminAuditLog.create.mockResolvedValue({})

    await usersService.unblockUser('user1', 'admin1', '127.0.0.1')

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isBlocked: false }),
      }),
    )
  })
})

describe('Admin — AdminProductsService', () => {
  let productsService: AdminProductsService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminProductsService,
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile()
    productsService = module.get(AdminProductsService)
  })

  it('ändert Preis mit Audit Trail', async () => {
    mockPrisma.product.findFirst.mockResolvedValue({ id: 'p1', basePrice: 29.99, salePrice: null })
    mockPrisma.product.update.mockResolvedValue({ basePrice: 24.99, salePrice: 19.99 })
    mockPrisma.adminAuditLog.create.mockResolvedValue({})

    await productsService.updatePrice('p1', 24.99, 19.99, 'admin1', '127.0.0.1')

    expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PRODUCT_PRICE_CHANGED',
          changes: expect.objectContaining({
            before: { basePrice: 29.99, salePrice: null },
            after: { basePrice: 24.99, salePrice: 19.99 },
          }),
        }),
      }),
    )
  })

  it('Bulk-Deaktivierung mehrerer Produkte', async () => {
    mockPrisma.product.updateMany.mockResolvedValue({ count: 3 })
    mockPrisma.adminAuditLog.create.mockResolvedValue({})

    const result = await productsService.bulkUpdateStatus(['p1', 'p2', 'p3'], false, 'admin1', '127.0.0.1')
    expect(result.updated).toBe(3)
  })

  describe('hardDelete', () => {
    it('wirft BadRequest wenn Produkt noch nicht soft-deleted ist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'p1', slug: 'testjacke', deletedAt: null,
        translations: [{ name: 'Testjacke' }], variants: [],
      })

      try {
        await productsService.hardDelete('p1', 'admin1', '127.0.0.1')
        fail('hardDelete should have thrown')
      } catch (e: any) {
        expect(e.status).toBe(400)
        expect(e.response.error).toBe('ProductMustBeSoftDeletedFirst')
        expect(e.response.message.de).toMatch(/Papierkorb/)
        expect(e.response.message.ar).toMatch(/نهائياً/)
      }
      expect(mockPrisma.product.delete).not.toHaveBeenCalled()
    })

    it('wirft Conflict wenn OrderItems auf eine Variante zeigen', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'p1', slug: 'testjacke', deletedAt: new Date(),
        translations: [{ name: 'Testjacke' }],
        variants: [{ id: 'v1' }, { id: 'v2' }],
      })
      mockPrisma.orderItem.count.mockResolvedValue(3)
      mockPrisma.productReview.count.mockResolvedValue(0)
      mockPrisma.coupon.count.mockResolvedValue(0)
      mockPrisma.promotion.count.mockResolvedValue(0)

      try {
        await productsService.hardDelete('p1', 'admin1', '127.0.0.1')
        fail('hardDelete should have thrown')
      } catch (e: any) {
        expect(e.status).toBe(409)
        expect(e.response.error).toBe('ProductHasReferences')
        expect(e.response.blockers.orderItems).toBe(3)
        expect(e.response.message.de).toContain('3 Bestellungen')
        expect(e.response.message.ar).toContain('3 طلب')
      }
      expect(mockPrisma.product.delete).not.toHaveBeenCalled()
    })

    it('löscht hart wenn keine Referenzen existieren', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'p1', slug: 'testjacke', deletedAt: new Date(),
        translations: [{ name: 'Testjacke' }],
        variants: [{ id: 'v1' }],
      })
      mockPrisma.orderItem.count.mockResolvedValue(0)
      mockPrisma.productReview.count.mockResolvedValue(0)
      mockPrisma.coupon.count.mockResolvedValue(0)
      mockPrisma.promotion.count.mockResolvedValue(0)
      mockPrisma.product.delete.mockResolvedValue({ id: 'p1' })
      mockPrisma.adminAuditLog.create.mockResolvedValue({})

      const result = await productsService.hardDelete('p1', 'admin1', '127.0.0.1')

      expect(mockPrisma.product.delete).toHaveBeenCalledWith({ where: { id: 'p1' } })
      expect(result).toEqual({ hardDeleted: true, name: 'Testjacke' })
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PRODUCT_HARD_DELETED',
            entityId: 'p1',
          }),
        }),
      )
    })

    it('akzeptiert Produkt ohne Varianten', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'p2', slug: 'leerprodukt', deletedAt: new Date(),
        translations: [{ name: 'Leeres Produkt' }],
        variants: [],
      })
      mockPrisma.productReview.count.mockResolvedValue(0)
      mockPrisma.coupon.count.mockResolvedValue(0)
      mockPrisma.promotion.count.mockResolvedValue(0)
      mockPrisma.product.delete.mockResolvedValue({ id: 'p2' })
      mockPrisma.adminAuditLog.create.mockResolvedValue({})

      const result = await productsService.hardDelete('p2', 'admin1', '127.0.0.1')

      expect(result.hardDeleted).toBe(true)
      // variantIds is empty → orderItem.count must be SKIPPED
      expect(mockPrisma.orderItem.count).not.toHaveBeenCalled()
      expect(mockPrisma.product.delete).toHaveBeenCalled()
    })
  })

  it('dupliziert Produkt', async () => {
    mockPrisma.product.findFirst.mockResolvedValue({
      id: 'p1', slug: 'testjacke', categoryId: 'cat1', brand: null, gender: null,
      basePrice: 99.99, salePrice: null, taxRate: 19,
      translations: [{ language: 'de', name: 'Testjacke', description: null, sizeGuide: null, metaTitle: null, metaDesc: null }],
      variants: [], images: [],
    })
    mockPrisma.product.create.mockResolvedValue({ id: 'p2', slug: 'testjacke-copy-123' })
    mockPrisma.adminAuditLog.create.mockResolvedValue({})

    const result = await productsService.duplicate('p1', 'admin1', '127.0.0.1')
    expect(result.id).toBe('p2')
  })

  describe('Variant barcode guard', () => {
    // These tests cover the invariant "every new variant must have a
    // non-empty barcode". They verify each of the 3 create/update sites
    // in AdminProductsService goes through ensureVariantBarcode().

    beforeEach(() => {
      // Common stubs shared by all barcode-guard tests
      mockPrisma.productVariant.findUnique.mockReset()
      mockPrisma.productVariant.create.mockReset()
      mockPrisma.productVariant.update.mockReset().mockResolvedValue({})
      ;(mockPrisma as any).inventory.create = jest.fn().mockResolvedValue({})
      mockPrisma.inventoryMovement.create.mockReset().mockResolvedValue({})
      ;(mockPrisma.warehouse as any).findFirst = jest.fn().mockResolvedValue({ id: 'wh1', isDefault: true })
      mockPrisma.adminAuditLog.create.mockResolvedValue({})
    })

    it('addColor: sets barcode = generated SKU when admin sends no barcode', async () => {
      // Product exists with 1 existing variant (needed for SKU prefix extraction)
      mockPrisma.product.findFirst.mockResolvedValueOnce({
        id: 'p1',
        variants: [{ sku: 'MAL-100-SCH-M' }],
      })
      mockPrisma.productVariant.findUnique.mockResolvedValue(null)
      mockPrisma.productVariant.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'v-new', ...data }))

      await productsService.addColor('p1', {
        color: 'Blau', colorHex: '#0000FF',
        sizes: ['S', 'M'],
      }, 'admin1', '127.0.0.1')

      // Both variants must have barcode === sku (not null)
      const calls = mockPrisma.productVariant.create.mock.calls
      expect(calls.length).toBe(2)
      for (const [arg] of calls) {
        expect(arg.data.barcode).toBe(arg.data.sku)
        expect(arg.data.barcode).toBeTruthy()
      }
    })

    it('addColor: accepts an explicit EAN barcode and uses it', async () => {
      mockPrisma.product.findFirst.mockResolvedValueOnce({
        id: 'p1', variants: [{ sku: 'MAL-100-SCH-M' }],
      })
      mockPrisma.productVariant.findUnique.mockResolvedValue(null)
      mockPrisma.productVariant.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'v-new', ...data }))

      await productsService.addColor('p1', {
        color: 'Blau', colorHex: '#0000FF',
        sizes: ['M'],
        barcode: '4006381333931',
      } as any, 'admin1', '127.0.0.1')

      const arg = mockPrisma.productVariant.create.mock.calls[0][0]
      expect(arg.data.barcode).toBe('4006381333931')
    })

    it('addSize: sets barcode = generated SKU (previously missing entirely)', async () => {
      mockPrisma.product.findFirst.mockResolvedValueOnce({
        id: 'p1',
        variants: [{ sku: 'MAL-100-SCH-M', color: 'Schwarz', colorHex: '#000' }],
      })
      mockPrisma.productVariant.findUnique.mockResolvedValue(null)
      mockPrisma.productVariant.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'v-new', ...data }))

      await productsService.addSize('p1', {
        size: 'XXL',
        colors: ['Schwarz'],
      }, 'admin1', '127.0.0.1')

      const arg = mockPrisma.productVariant.create.mock.calls[0][0]
      expect(arg.data.barcode).toBe(arg.data.sku)
      expect(arg.data.barcode).toBeTruthy()
    })

    it('updateVariant: empty-string barcode input falls back to SKU (cannot clear)', async () => {
      mockPrisma.productVariant.findUnique.mockResolvedValue({
        id: 'v1', sku: 'MAL-100-SCH-M', productId: 'p1',
      })
      let captured: any
      mockPrisma.productVariant.update.mockImplementation(({ data }: any) => {
        captured = data
        return Promise.resolve({ id: 'v1', ...data })
      })

      await productsService.updateVariant('v1', { barcode: '' }, 'admin1', '127.0.0.1')

      // Must NOT be null — should have fallen back to SKU
      expect(captured.barcode).toBe('MAL-100-SCH-M')
    })

    it('updateVariant: whitespace barcode input falls back to SKU', async () => {
      mockPrisma.productVariant.findUnique.mockResolvedValue({
        id: 'v1', sku: 'MAL-100-SCH-M', productId: 'p1',
      })
      let captured: any
      mockPrisma.productVariant.update.mockImplementation(({ data }: any) => {
        captured = data
        return Promise.resolve({ id: 'v1', ...data })
      })

      await productsService.updateVariant('v1', { barcode: '   ' }, 'admin1', '127.0.0.1')

      expect(captured.barcode).toBe('MAL-100-SCH-M')
    })

    it('updateVariant: valid EAN overrides SKU', async () => {
      mockPrisma.productVariant.findUnique.mockResolvedValue({
        id: 'v1', sku: 'MAL-100-SCH-M', productId: 'p1',
      })
      let captured: any
      mockPrisma.productVariant.update.mockImplementation(({ data }: any) => {
        captured = data
        return Promise.resolve({ id: 'v1', ...data })
      })

      await productsService.updateVariant('v1', { barcode: '4006381333931' }, 'admin1', '127.0.0.1')

      expect(captured.barcode).toBe('4006381333931')
    })

    it('updateVariant: omitted barcode leaves the column untouched', async () => {
      mockPrisma.productVariant.findUnique.mockResolvedValue({
        id: 'v1', sku: 'MAL-100-SCH-M', productId: 'p1',
      })
      let captured: any
      mockPrisma.productVariant.update.mockImplementation(({ data }: any) => {
        captured = data
        return Promise.resolve({ id: 'v1', ...data })
      })

      // Only update priceModifier, don't send barcode at all
      await productsService.updateVariant('v1', { priceModifier: 5 }, 'admin1', '127.0.0.1')

      // The data passed to .update MUST NOT contain a barcode field at
      // all — otherwise we would overwrite the existing value with
      // the SKU default, which is wrong for pre-existing rows.
      expect(captured.barcode).toBeUndefined()
      expect(captured.priceModifier).toBe(5)
    })
  })
})

describe('Admin — AdminInventoryService', () => {
  let inventoryService: AdminInventoryService

  beforeEach(async () => {
    jest.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fnOrArray: any) =>
      typeof fnOrArray === 'function' ? fnOrArray(mockPrisma) : Promise.all(fnOrArray),
    )

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminInventoryService,
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile()
    inventoryService = module.get(AdminInventoryService)
  })

  it('manuelle Bestandskorrektur mit Audit Trail', async () => {
    mockPrisma.inventory.findUnique.mockResolvedValue({
      id: 'inv1', variantId: 'v1', warehouseId: 'wh1', quantityOnHand: 10,
    })
    mockPrisma.inventory.update.mockResolvedValue({})
    mockPrisma.inventoryMovement.create.mockResolvedValue({})
    mockPrisma.adminAuditLog.create.mockResolvedValue({})

    const result = await inventoryService.adjustStock('inv1', 15, 'Nachzählung', 'admin1', '127.0.0.1')

    expect(result.before).toBe(10)
    expect(result.after).toBe(15)
    expect(result.diff).toBe(5)
  })

  it('akzeptiert Bestandskorrektur auch ohne Begründung (notes optional)', async () => {
    mockPrisma.inventory.findUnique.mockResolvedValue({
      id: 'inv1', variantId: 'v1', warehouseId: 'wh1', quantityOnHand: 10,
    })
    mockPrisma.inventory.update.mockResolvedValue({})
    mockPrisma.inventoryMovement.create.mockResolvedValue({})
    mockPrisma.adminAuditLog.create.mockResolvedValue({})

    const result = await inventoryService.adjustStock('inv1', 15, '', 'admin1', '127.0.0.1')
    expect(result.diff).toBe(5)
  })

  it('Transfer zwischen Lagern', async () => {
    mockPrisma.inventory.findUnique.mockResolvedValue({
      id: 'inv1', variantId: 'v1', warehouseId: 'wh1', quantityOnHand: 20, quantityReserved: 5,
    })
    mockPrisma.inventory.update.mockResolvedValue({})
    mockPrisma.inventory.upsert.mockResolvedValue({})
    mockPrisma.inventoryMovement.createMany.mockResolvedValue({ count: 2 })
    mockPrisma.adminAuditLog.create.mockResolvedValue({})

    const result = await inventoryService.transfer('inv1', 'wh2', 10, 'admin1', '127.0.0.1')

    expect(result.transferred).toBe(10)
  })

  it('wirft BadRequestException bei ungenügendem Bestand', async () => {
    mockPrisma.inventory.findUnique.mockResolvedValue({
      id: 'inv1', quantityOnHand: 10, quantityReserved: 8, // only 2 available
    })

    await expect(
      inventoryService.transfer('inv1', 'wh2', 5, 'admin1', '127.0.0.1'),
    ).rejects.toThrow(BadRequestException)
  })

  describe('Stocktake', () => {
    it('wirft BadRequest wenn warehouseId fehlt', async () => {
      try {
        await inventoryService.startStocktake('', null, 'admin1')
        fail('should have thrown')
      } catch (e: any) {
        expect(e.status).toBe(400)
        expect(e.response.error).toBe('WarehouseRequired')
      }
    })

    it('wirft Conflict wenn bereits eine Inventur im Lager läuft', async () => {
      mockPrisma.warehouse.findUnique.mockResolvedValue({ id: 'wh1', name: 'Hamburg' })
      mockPrisma.stocktake.findFirst.mockResolvedValue({ id: 'existing-st' })

      try {
        await inventoryService.startStocktake('wh1', null, 'admin1')
        fail('should have thrown')
      } catch (e: any) {
        expect(e.status).toBe(409)
        expect(e.response.error).toBe('StocktakeAlreadyInProgress')
        expect(e.response.existingId).toBe('existing-st')
      }
      // Inventory snapshot MUST NOT run — we bailed early.
      expect(mockPrisma.inventory.findMany).not.toHaveBeenCalled()
    })

    it('startet Inventur mit Inventar-Snapshot + Audit-Log', async () => {
      mockPrisma.warehouse.findUnique.mockResolvedValue({ id: 'wh1', name: 'Hamburg' })
      mockPrisma.stocktake.findFirst.mockResolvedValue(null)
      mockPrisma.inventory.findMany.mockResolvedValue([
        { variantId: 'v1', quantityOnHand: 10 },
        { variantId: 'v2', quantityOnHand: 5 },
      ])
      mockPrisma.stocktake.create.mockResolvedValue({ id: 'st1', items: [] })
      mockPrisma.adminAuditLog.create.mockResolvedValue({})

      const result = await inventoryService.startStocktake('wh1', null, 'admin1')

      expect(result.id).toBe('st1')
      expect(mockPrisma.stocktake.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            warehouseId: 'wh1', adminId: 'admin1', status: 'in_progress',
            items: { create: [
              { variantId: 'v1', expectedQty: 10 },
              { variantId: 'v2', expectedQty: 5 },
            ]},
          }),
        }),
      )
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'STOCKTAKE_STARTED' }),
        }),
      )
    })

    it('löscht laufende Inventur', async () => {
      mockPrisma.stocktake.findUnique.mockResolvedValue({
        id: 'st1', status: 'in_progress', warehouseId: 'wh1', categoryId: null, _count: { items: 5 },
      })
      mockPrisma.stocktake.delete.mockResolvedValue({})
      mockPrisma.adminAuditLog.create.mockResolvedValue({})

      const result = await inventoryService.deleteStocktake('st1', 'admin1', '127.0.0.1')

      expect(result.deleted).toBe(true)
      expect(mockPrisma.stocktake.delete).toHaveBeenCalledWith({ where: { id: 'st1' } })
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'STOCKTAKE_DELETED' }),
        }),
      )
    })

    it('wirft BadRequest beim Versuch eine abgeschlossene Inventur zu löschen', async () => {
      mockPrisma.stocktake.findUnique.mockResolvedValue({
        id: 'st1', status: 'completed', warehouseId: 'wh1', categoryId: null, _count: { items: 5 },
      })

      try {
        await inventoryService.deleteStocktake('st1', 'admin1', '127.0.0.1')
        fail('should have thrown')
      } catch (e: any) {
        expect(e.status).toBe(400)
        expect(e.response.error).toBe('CanOnlyDeleteInProgress')
      }
      expect(mockPrisma.stocktake.delete).not.toHaveBeenCalled()
    })

    it('Korrektur-Inventur übernimmt actualQty der Quelle als neues expectedQty', async () => {
      mockPrisma.stocktake.findUnique.mockResolvedValue({
        id: 'src', status: 'completed', warehouseId: 'wh1', categoryId: 'cat1',
        items: [
          { variantId: 'v1', expectedQty: 10, actualQty: 8, difference: -2 },
          { variantId: 'v2', expectedQty: 5, actualQty: null, difference: null }, // defensively handled
        ],
      })
      mockPrisma.stocktake.findFirst.mockResolvedValue(null)
      mockPrisma.stocktake.create.mockResolvedValue({ id: 'new-st', items: [] })
      mockPrisma.adminAuditLog.create.mockResolvedValue({})

      const result = await inventoryService.startCorrectionStocktake('src', 'admin1')

      expect(result.id).toBe('new-st')
      expect(mockPrisma.stocktake.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            warehouseId: 'wh1',
            categoryId: 'cat1',
            notes: 'correction_of:src',
            items: { create: [
              { variantId: 'v1', expectedQty: 8 },  // from actualQty
              { variantId: 'v2', expectedQty: 5 },  // fallback to expectedQty since actualQty=null
            ]},
          }),
        }),
      )
    })

    it('Korrektur ist nur für abgeschlossene Inventuren erlaubt', async () => {
      mockPrisma.stocktake.findUnique.mockResolvedValue({
        id: 'src', status: 'in_progress', warehouseId: 'wh1', items: [],
      })

      try {
        await inventoryService.startCorrectionStocktake('src', 'admin1')
        fail('should have thrown')
      } catch (e: any) {
        expect(e.status).toBe(400)
        expect(e.response.error).toBe('CanOnlyCorrectCompleted')
      }
    })
  })

  describe('exportCsv', () => {
    // Shared helpers for building mock rows — keeps each test concise.
    const mkInvRow = (overrides: Partial<any> = {}) => ({
      quantityOnHand: 10, quantityReserved: 2, reorderPoint: 5, maxStock: 100,
      variant: {
        sku: 'SKU-1', barcode: 'B-1', color: 'Schwarz', size: 'M',
        product: {
          basePrice: 50, salePrice: null,
          translations: [{ name: 'Hose' }],
          category: { translations: [{ name: 'Hosen' }] },
        },
      },
      warehouse: { name: 'Marzahn' },
      location: { name: null },
      ...overrides,
    })

    it('existing mode: emits one row per inventory record, no 500 cap', async () => {
      // Build 750 rows — the old code would have capped at 500.
      const fakeRows = Array.from({ length: 750 }, (_, i) => mkInvRow({
        variant: {
          sku: `SKU-${i}`, barcode: `B-${i}`, color: 'Rot', size: 'L',
          product: {
            basePrice: 30, salePrice: null,
            translations: [{ name: `Prod ${i}` }],
            category: { translations: [{ name: 'Test' }] },
          },
        },
      }))
      mockPrisma.inventory.findMany.mockResolvedValue(fakeRows)

      const csv = await inventoryService.exportCsv({ mode: 'existing' })
      const lines = csv.trim().split('\n')
      // 1 header + 750 data
      expect(lines.length).toBe(751)
      expect(lines[0]).toContain('SKU;Barcode;Produkt')
      // findMany must be called with take=50000 (not 500/700)
      expect(mockPrisma.inventory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50_000 }),
      )
    })

    it('existing mode: escapes semicolons in product names (CSV injection safe)', async () => {
      mockPrisma.inventory.findMany.mockResolvedValue([
        mkInvRow({
          variant: {
            sku: 'SKU-X', barcode: null, color: 'Schwarz', size: 'M',
            product: {
              basePrice: 50, salePrice: null,
              translations: [{ name: 'Hose; kurz' }],  // contains ;
              category: { translations: [{ name: 'Hosen' }] },
            },
          },
        }),
      ])
      const csv = await inventoryService.exportCsv({ mode: 'existing' })
      expect(csv).toContain('"Hose; kurz"')
    })

    it('existing mode: status filter applied correctly (out_of_stock)', async () => {
      mockPrisma.inventory.findMany.mockResolvedValue([
        mkInvRow({ quantityOnHand: 10, quantityReserved: 2 }), // avail=8 → in_stock
        mkInvRow({ quantityOnHand: 0, quantityReserved: 0 }),  // avail=0 → out
      ])
      const csv = await inventoryService.exportCsv({ mode: 'existing', status: 'out_of_stock' })
      const dataLines = csv.trim().split('\n').slice(1)
      expect(dataLines.length).toBe(1)
      expect(dataLines[0]).toContain('out_of_stock')
    })

    it('matrix mode: emits row per (variant × warehouse) with 0 for missing combos', async () => {
      mockPrisma.warehouse.findMany.mockResolvedValue([
        { id: 'wh1', name: 'Marzahn' },
        { id: 'wh2', name: 'Hamburg' },
      ])
      mockPrisma.productVariant.findMany.mockResolvedValue([
        {
          id: 'v1', sku: 'SKU-1', barcode: 'B-1', color: 'Schwarz', size: 'M',
          product: {
            basePrice: 50, salePrice: null,
            translations: [{ name: 'Hose' }],
            category: { translations: [{ name: 'Hosen' }] },
          },
        },
      ])
      // Variant v1 has stock only in Marzahn, nothing in Hamburg.
      mockPrisma.inventory.findMany.mockResolvedValue([
        {
          variantId: 'v1', warehouseId: 'wh1',
          quantityOnHand: 10, quantityReserved: 0,
          reorderPoint: 5, maxStock: 100, location: null,
        },
      ])

      const csv = await inventoryService.exportCsv({ mode: 'matrix' })
      const dataLines = csv.trim().split('\n').slice(1)
      expect(dataLines.length).toBe(2) // 1 variant × 2 warehouses
      // First row should be Marzahn with actual stock
      expect(dataLines[0]).toContain('Marzahn')
      expect(dataLines[0]).toContain(';10;0;10;') // qty;reserved;avail
      // Second row should be Hamburg with 0-stock
      expect(dataLines[1]).toContain('Hamburg')
      expect(dataLines[1]).toContain(';0;0;0;')
      expect(dataLines[1]).toContain('out_of_stock')
    })

    it('matrix mode: status filter still applies to zero-rows', async () => {
      mockPrisma.warehouse.findMany.mockResolvedValue([
        { id: 'wh1', name: 'Marzahn' }, { id: 'wh2', name: 'Hamburg' },
      ])
      mockPrisma.productVariant.findMany.mockResolvedValue([
        {
          id: 'v1', sku: 'SKU-1', barcode: null, color: 'Rot', size: 'L',
          product: {
            basePrice: 50, salePrice: null,
            translations: [{ name: 'Shirt' }],
            category: { translations: [{ name: 'Oberteile' }] },
          },
        },
      ])
      mockPrisma.inventory.findMany.mockResolvedValue([
        {
          variantId: 'v1', warehouseId: 'wh1',
          quantityOnHand: 20, quantityReserved: 0,
          reorderPoint: 5, maxStock: 100, location: null,
        },
      ])

      // Asking for out_of_stock should exclude the Marzahn row (qty=20 → in_stock)
      // and include the Hamburg row (synthesized 0).
      const csv = await inventoryService.exportCsv({ mode: 'matrix', status: 'out_of_stock' })
      const dataLines = csv.trim().split('\n').slice(1)
      expect(dataLines.length).toBe(1)
      expect(dataLines[0]).toContain('Hamburg')
    })

    it('matrix mode: resolves categoryId to include subcategories', async () => {
      mockPrisma.category.findMany.mockResolvedValue([
        { id: 'sub1' }, { id: 'sub2' },
      ])
      mockPrisma.warehouse.findMany.mockResolvedValue([{ id: 'wh1', name: 'W' }])
      mockPrisma.productVariant.findMany.mockResolvedValue([])
      mockPrisma.inventory.findMany.mockResolvedValue([])

      await inventoryService.exportCsv({ mode: 'matrix', categoryId: 'parent' })

      expect(mockPrisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { parentId: 'parent' } }),
      )
      expect(mockPrisma.productVariant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            product: expect.objectContaining({
              categoryId: { in: ['parent', 'sub1', 'sub2'] },
            }),
          }),
        }),
      )
    })

    it('matrix mode: honors warehouseId filter (degrades to single location)', async () => {
      mockPrisma.warehouse.findMany.mockResolvedValue([
        { id: 'wh1', name: 'Hamburg' }, // only the one the filter asked for
      ])
      mockPrisma.productVariant.findMany.mockResolvedValue([
        {
          id: 'v1', sku: 'SKU-1', barcode: null, color: 'Blau', size: 'S',
          product: {
            basePrice: 20, salePrice: null,
            translations: [{ name: 'T' }],
            category: { translations: [{ name: 'X' }] },
          },
        },
      ])
      mockPrisma.inventory.findMany.mockResolvedValue([])

      const csv = await inventoryService.exportCsv({ mode: 'matrix', warehouseId: 'wh1' })
      const dataLines = csv.trim().split('\n').slice(1)
      expect(dataLines.length).toBe(1)
      expect(dataLines[0]).toContain('Hamburg')
      expect(mockPrisma.warehouse.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, id: 'wh1' },
        }),
      )
    })
  })
})
