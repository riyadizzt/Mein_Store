/**
 * Concurrency Tests — Anti-Überverkauf
 *
 * Testet: 10 gleichzeitige Requests auf den letzten verfügbaren Artikel.
 * Erwartung: Genau 1 Reservierung erfolgreich, 9 bekommen 409 Conflict.
 *
 * Voraussetzung: Docker Test-DB läuft
 *   docker compose -f docker-compose.test.yml up -d
 */
import { PrismaClient } from '@prisma/client'
import { ReservationService } from '../../inventory/reservation.service'
import { PrismaService } from '../../../prisma/prisma.service'

const TEST_DB_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres_test@localhost:5433/omnichannel_test'

describe('Orders — Concurrency (Anti-Überverkauf)', () => {
  let prisma: PrismaClient
  let reservationService: ReservationService
  let warehouseId: string
  let variantId: string

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } })
    await prisma.$connect()

    // Services direkt instantiieren (kein NestJS DI für Concurrency-Tests)
    const prismaService = prisma as unknown as PrismaService
    const inventoryService = { checkAndAlertLowStock: jest.fn() } as any
    reservationService = new ReservationService(
      prismaService,
      inventoryService,
      { get: () => 15 } as any, // ConfigService mock
    )
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    // Test-Daten für jeden Test frisch anlegen
    await prisma.stockReservation.deleteMany()
    await prisma.inventoryMovement.deleteMany()
    await prisma.inventory.deleteMany()
    await prisma.productVariant.deleteMany()
    await prisma.product.deleteMany()
    await prisma.category.deleteMany()
    await prisma.warehouse.deleteMany()

    const warehouse = await prisma.warehouse.create({
      data: { name: 'Concurrency-Test-Lager', type: 'WAREHOUSE', isDefault: true },
    })
    warehouseId = warehouse.id

    const category = await prisma.category.create({
      data: {
        slug: 'concurrency-test',
        translations: { create: { language: 'de', name: 'Test' } },
      },
    })

    const product = await prisma.product.create({
      data: {
        slug: 'letztes-stueck',
        categoryId: category.id,
        basePrice: 50,
        taxRate: 19,
        translations: { create: { language: 'de', name: 'Letztes Stück' } },
        variants: {
          create: {
            sku: 'LAST-ONE',
            inventory: {
              create: {
                warehouseId: warehouse.id,
                quantityOnHand: 1, // NUR 1 verfügbar!
                quantityReserved: 0,
              },
            },
          },
        },
      },
      include: { variants: true },
    })

    variantId = product.variants[0].id
  })

  // ── Kerntest: 10 simultane Requests auf den letzten Artikel ───

  it('garantiert: exakt 1 Erfolg, Rest 409 — bei 10 simultanen Anfragen', async () => {
    const CONCURRENT_REQUESTS = 10

    // Alle 10 Requests gleichzeitig starten
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
        reservationService.reserve({
          variantId,
          warehouseId,
          quantity: 1,
          sessionId: `session-concurrent-${i}`,
        }),
      ),
    )

    const successes = results.filter((r) => r.status === 'fulfilled')
    const failures = results.filter((r) => r.status === 'rejected')

    // KRITISCH: Genau 1 Erfolg
    expect(successes).toHaveLength(1)

    // KRITISCH: 9 Fehler (409 ConflictException)
    expect(failures).toHaveLength(CONCURRENT_REQUESTS - 1)

    // Alle Fehler sind 409 (nicht 500!)
    for (const failure of failures) {
      const err = (failure as PromiseRejectedResult).reason
      expect(err?.status ?? err?.response?.statusCode).toBe(409)
    }

    // Bestand darf NIEMALS negativ werden
    const inventory = await prisma.inventory.findFirst({
      where: { variantId, warehouseId },
    })
    expect(inventory!.quantityOnHand).toBe(1)        // physisch unverändert
    expect(inventory!.quantityReserved).toBe(1)       // genau 1 reserviert
    expect(inventory!.quantityOnHand - inventory!.quantityReserved).toBe(0) // 0 verfügbar
  }, 30000)

  // ── Test 2: 5 Artikel, 10 simultane Requests ─────────────────

  it('reserviert genau 5 von 5 Artikeln bei 10 Requests', async () => {
    // Bestand auf 5 setzen
    await prisma.inventory.updateMany({
      where: { variantId, warehouseId },
      data: { quantityOnHand: 5, quantityReserved: 0 },
    })

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        reservationService.reserve({
          variantId,
          warehouseId,
          quantity: 1,
          sessionId: `session-5of10-${i}`,
        }),
      ),
    )

    const successes = results.filter((r) => r.status === 'fulfilled')
    const failures = results.filter((r) => r.status === 'rejected')

    expect(successes).toHaveLength(5)
    expect(failures).toHaveLength(5)

    const inventory = await prisma.inventory.findFirst({ where: { variantId, warehouseId } })
    expect(inventory!.quantityReserved).toBe(5)
    expect(inventory!.quantityOnHand - inventory!.quantityReserved).toBe(0)
  }, 30000)
})
