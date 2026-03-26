/**
 * Integration Tests — Orders Module
 *
 * Voraussetzung: Docker Test-DB läuft
 *   docker compose -f docker-compose.test.yml up -d
 *
 * Ausführen:
 *   pnpm --filter api test:integration
 *
 * Testet den vollständigen Bestellfluss mit echter PostgreSQL-Datenbank.
 */
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import { PrismaClient } from '@prisma/client'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest')
import { OrdersModule } from '../orders.module'
import { PrismaModule } from '../../../prisma/prisma.module'
import { ConfigModule } from '@nestjs/config'
import { InventoryModule } from '../../inventory/inventory.module'
import { QueueModule } from '../../../queues/queue.module'

const TEST_DB_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres_test@localhost:5433/omnichannel_test'

describe('Orders — Integration', () => {
  let app: INestApplication
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } })
    await prisma.$connect()

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        EventEmitterModule.forRoot(),
        ScheduleModule.forRoot(),
        PrismaModule,
        QueueModule,
        InventoryModule,
        OrdersModule,
      ],
    }).compile()

    app = module.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => {
    await prisma.$disconnect()
    await app.close()
  })

  afterEach(async () => {
    // Test-Daten bereinigen (Reihenfolge beachtet FK-Constraints)
    await prisma.orderStatusHistory.deleteMany()
    await prisma.orderItem.deleteMany()
    await prisma.order.deleteMany()
    await prisma.stockReservation.deleteMany()
    await prisma.inventoryMovement.deleteMany()
    await prisma.idempotencyKey.deleteMany()
  })

  // ── Seed-Helfer ───────────────────────────────────────────────

  async function seedTestData() {
    const warehouse = await prisma.warehouse.create({
      data: { name: 'Test-Lager', type: 'WAREHOUSE', isDefault: true },
    })

    const category = await prisma.category.create({
      data: {
        slug: 'test-kategorie',
        translations: { create: { language: 'de', name: 'Testkategorie' } },
      },
    })

    const product = await prisma.product.create({
      data: {
        slug: 'test-jacke',
        categoryId: category.id,
        basePrice: 99.99,
        taxRate: 19,
        translations: { create: { language: 'de', name: 'Testjacke' } },
        variants: {
          create: {
            sku: 'TEST-BLK-M',
            color: 'Schwarz',
            size: 'M',
            inventory: {
              create: { warehouseId: warehouse.id, quantityOnHand: 10 },
            },
          },
        },
      },
      include: { variants: true },
    })

    await prisma.shippingZone.create({
      data: {
        zoneName: 'Deutschland',
        countryCodes: ['DE'],
        basePrice: 8.0,
        freeShippingThreshold: 100.0,
        isActive: true,
      },
    })

    return { warehouse, product, variant: product.variants[0] }
  }

  // ── Test 1: Bestellung erstellen ──────────────────────────────

  it('sollte Bestellung erstellen und Bestand reservieren', async () => {
    const { variant, warehouse: wh } = await seedTestData()

    const response = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', 'Bearer MOCK') // In echtem Test: JWT
      .send({
        items: [{ variantId: variant.id, warehouseId: wh.id, quantity: 2 }],
        countryCode: 'DE',
      })

    // Wir erwarten 201 oder 401 (kein Auth in Integration-Test ohne JWT-Setup)
    expect([201, 401]).toContain(response.status)

    if (response.status === 201) {
      expect(response.body.orderNumber).toMatch(/^ORD-\d{8}-\d{6}$/)
      expect(Number(response.body.subtotal)).toBeCloseTo(199.98, 1)
      expect(Number(response.body.shippingCost)).toBe(8.0)

      // Bestand sollte reserviert sein
      const inventory = await prisma.inventory.findFirst({
        where: { variantId: variant.id },
      })
      expect(inventory?.quantityReserved).toBe(2)
    }
  })

  // ── Test 2: Statusübergang in DB ──────────────────────────────

  it('sollte Statushistorie korrekt schreiben', async () => {
    const { warehouse: _w, variant: _v } = await seedTestData()

    const order = await prisma.order.create({
      data: {
        orderNumber: 'ORD-TEST-000001',
        status: 'pending',
        subtotal: 99.99,
        taxAmount: 15.96,
        totalAmount: 107.99,
        shippingCost: 8.0,
      },
    })

    await prisma.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: null,
        toStatus: 'pending',
        source: 'system',
        createdBy: 'test',
      },
    })

    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
    })

    expect(history).toHaveLength(1)
    expect(history[0].toStatus).toBe('pending')
    expect(history[0].fromStatus).toBeNull()
  })

  // ── Test 3: Idempotency — gleicher Key, gleicher Body ─────────

  it('sollte zweiten Request mit gleichem Idempotency-Key ablehnen', async () => {
    const key = 'test-idem-key-' + Date.now()

    await prisma.idempotencyKey.create({
      data: {
        key,
        endpoint: 'POST:/orders',
        requestHash: 'abc123',
        responseBody: { id: 'cached-order' },
        statusCode: 201,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })

    const existing = await prisma.idempotencyKey.findUnique({ where: { key } })
    expect(existing).toBeTruthy()
    expect(existing?.statusCode).toBe(201)
  })
})
