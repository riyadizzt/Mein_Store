import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { AuditService } from '../services/audit.service'
import { AdminOrdersService } from '../services/admin-orders.service'
import { AdminUsersService } from '../services/admin-users.service'
import { AdminProductsService } from '../services/admin-products.service'
import { AdminInventoryService } from '../services/admin-inventory.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { PaymentsService } from '../../payments/payments.service'
import { ShipmentsService } from '../../shipments/shipments.service'

// ── Mocks ────────────────────────────────────────────────────

const mockPrisma = {
  adminAuditLog: { create: jest.fn(), findMany: jest.fn() },
  adminNote: { create: jest.fn(), findMany: jest.fn() },
  order: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), aggregate: jest.fn(), groupBy: jest.fn() },
  orderStatusHistory: { create: jest.fn() },
  user: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  product: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  inventory: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), upsert: jest.fn() },
  inventoryMovement: { create: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
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

  it('wirft BadRequestException ohne Begründung', async () => {
    mockPrisma.order.findFirst.mockResolvedValue({ id: 'o1', status: 'confirmed' })

    await expect(
      ordersService.updateStatus('o1', 'processing', '', 'admin1', '127.0.0.1'),
    ).rejects.toThrow(BadRequestException)
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

  it('wirft BadRequestException ohne Begründung', async () => {
    await expect(
      inventoryService.adjustStock('inv1', 15, '', 'admin1', '127.0.0.1'),
    ).rejects.toThrow(BadRequestException)
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
})
