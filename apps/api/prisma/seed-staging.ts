/**
 * Staging Seed Script — Testdaten für lokales Staging
 *
 * Erstellt: 10 Kategorien, 50 Produkte mit Varianten, 3 Lager,
 *           5 Shipping Zones, 5 Test-User, 20 Testbestellungen
 *
 * Ausführen: npx ts-node apps/api/prisma/seed-staging.ts
 */
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

const COLORS = ['Schwarz', 'Weiß', 'Blau', 'Rot', 'Grün', 'Grau', 'Beige']
const COLOR_HEX: Record<string, string> = {
  Schwarz: '#000000', Weiß: '#FFFFFF', Blau: '#2563eb', Rot: '#dc2626',
  Grün: '#16a34a', Grau: '#6b7280', Beige: '#d2b48c',
}
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']

async function main() {
  console.log('🌱 Staging Seed gestartet...\n')

  // ── Clean ──────────────────────────────────────────────
  console.log('🗑️  Lösche bestehende Daten...')
  await prisma.orderStatusHistory.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.adminNote.deleteMany()
  await prisma.adminAuditLog.deleteMany()
  await prisma.couponUsage.deleteMany()
  await prisma.return.deleteMany()
  await prisma.shipment.deleteMany()
  await prisma.refund.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.invoice.deleteMany()
  await prisma.webhookEvent.deleteMany()
  await prisma.order.deleteMany()
  await prisma.stockReservation.deleteMany()
  await prisma.inventoryMovement.deleteMany()
  await prisma.inventory.deleteMany()
  await prisma.productImage.deleteMany()
  await prisma.productVariant.deleteMany()
  await prisma.productTranslation.deleteMany()
  await prisma.product.deleteMany()
  await prisma.categoryTranslation.deleteMany()
  await prisma.category.deleteMany()
  await prisma.warehouse.deleteMany()
  await prisma.shippingZone.deleteMany()
  await prisma.wishlistItem.deleteMany()
  await prisma.gdprConsent.deleteMany()
  await prisma.dataExportRequest.deleteMany()
  await prisma.emailChangeRequest.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.passwordReset.deleteMany()
  await prisma.address.deleteMany()
  await prisma.idempotencyKey.deleteMany()
  await prisma.user.deleteMany()

  // ── Warehouses (3) ────────────────────────────────────
  console.log('🏭 Erstelle 3 Lager...')
  const warehouses = await Promise.all([
    prisma.warehouse.create({ data: { name: 'Hauptlager Berlin', type: 'WAREHOUSE', isDefault: true } }),
    prisma.warehouse.create({ data: { name: 'Außenlager Hamburg', type: 'WAREHOUSE' } }),
    prisma.warehouse.create({ data: { name: 'Shopify POS München', type: 'STORE' } }),
  ])

  // ── Shipping Zones (5) ────────────────────────────────
  console.log('🚚 Erstelle 5 Versandzonen...')
  await prisma.shippingZone.createMany({
    data: [
      { zoneName: 'Deutschland', countryCodes: ['DE'], basePrice: 4.99, freeShippingThreshold: 100 },
      { zoneName: 'Österreich', countryCodes: ['AT'], basePrice: 8.99, freeShippingThreshold: 150 },
      { zoneName: 'Schweiz', countryCodes: ['CH'], basePrice: 12.99, freeShippingThreshold: 200 },
      { zoneName: 'Benelux', countryCodes: ['NL', 'BE', 'LU'], basePrice: 9.99, freeShippingThreshold: 150 },
      { zoneName: 'Frankreich + Polen', countryCodes: ['FR', 'PL'], basePrice: 11.99, freeShippingThreshold: 200 },
    ],
  })

  // ── Categories (10) ───────────────────────────────────
  console.log('📁 Erstelle 10 Kategorien...')
  const categoryData = [
    { slug: 'jacken', de: 'Jacken & Mäntel', en: 'Jackets & Coats', ar: 'جاكيتات ومعاطف' },
    { slug: 'hosen', de: 'Hosen', en: 'Pants', ar: 'بنطلونات' },
    { slug: 'hemden', de: 'Hemden & Blusen', en: 'Shirts & Blouses', ar: 'قمصان وبلوزات' },
    { slug: 'kleider', de: 'Kleider & Röcke', en: 'Dresses & Skirts', ar: 'فساتين وتنانير' },
    { slug: 'schuhe', de: 'Schuhe', en: 'Shoes', ar: 'أحذية' },
    { slug: 't-shirts', de: 'T-Shirts', en: 'T-Shirts', ar: 'تيشيرتات' },
    { slug: 'pullover', de: 'Pullover & Strick', en: 'Sweaters & Knitwear', ar: 'سويتر وتريكو' },
    { slug: 'accessoires', de: 'Accessoires', en: 'Accessories', ar: 'إكسسوارات' },
    { slug: 'sportswear', de: 'Sportbekleidung', en: 'Sportswear', ar: 'ملابس رياضية' },
    { slug: 'kinder', de: 'Kinderbekleidung', en: "Children's Clothing", ar: 'ملابس أطفال' },
  ]

  const categories = []
  for (const cat of categoryData) {
    const created = await prisma.category.create({
      data: {
        slug: cat.slug,
        imageUrl: `https://placehold.co/400x300/1a1a2e/ffffff?text=${encodeURIComponent(cat.de)}`,
        translations: {
          create: [
            { language: 'de', name: cat.de },
            { language: 'en', name: cat.en },
            { language: 'ar', name: cat.ar },
          ],
        },
      },
    })
    categories.push(created)
  }

  // ── Products (50) with Variants ───────────────────────
  console.log('👕 Erstelle 50 Produkte mit Varianten...')
  const productNames = [
    'Winterjacke Classic', 'Daunenjacke Slim', 'Lederjacke Biker', 'Regenmantel City', 'Bomberjacke Urban',
    'Chino Regular', 'Jeans Slim Fit', 'Jogginghose Comfort', 'Shorts Summer', 'Cargohose Worker',
    'Hemd Business', 'Bluse Elegant', 'Flanellhemd Casual', 'Leinenhemd Summer', 'Denimhemd Vintage',
    'Maxikleid Floral', 'Minikleid Party', 'Bleistiftrock Business', 'Sommerkleid Boho', 'Wickelkleid Classic',
    'Sneaker Urban', 'Boots Leder', 'Sandalen Comfort', 'Pumps Elegant', 'Laufschuhe Sport',
    'T-Shirt Basic', 'T-Shirt Graphic', 'T-Shirt Oversized', 'Polo Classic', 'V-Neck Basic',
    'Strickpullover Merino', 'Hoodie Oversize', 'Cardigan Lang', 'Rollkragenpullover', 'Fleecejacke Outdoor',
    'Schal Kaschmir', 'Mütze Wolle', 'Gürtel Leder', 'Sonnenbrille Retro', 'Rucksack City',
    'Jogginghose Sport', 'Sport-BH Medium', 'Trainingsjacke', 'Radlerhose', 'Yoga-Leggings',
    'Kinderkleid Sommer', 'Kinder-Hoodie', 'Kinder-Jeans', 'Baby-Body Set', 'Kinder-Sneaker',
  ]

  const products = []
  for (let i = 0; i < 50; i++) {
    const catIndex = Math.floor(i / 5)
    const basePrice = Math.round((Math.random() * 120 + 19.99) * 100) / 100
    const hasSale = Math.random() > 0.7
    const salePrice = hasSale ? Math.round(basePrice * (0.6 + Math.random() * 0.2) * 100) / 100 : null

    const product = await prisma.product.create({
      data: {
        slug: productNames[i].toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        categoryId: categories[catIndex].id,
        basePrice,
        salePrice,
        taxRate: 19,
        isActive: true,
        isFeatured: i < 10,
        publishedAt: new Date(),
        translations: {
          create: [
            { language: 'de', name: productNames[i], description: `Hochwertige ${productNames[i]} aus der Malak Kollektion. Premium-Qualität, nachhaltig produziert.` },
            { language: 'en', name: productNames[i].replace('ü', 'ue').replace('ö', 'oe').replace('ä', 'ae'), description: `High-quality ${productNames[i]} from the Malak collection. Premium quality, sustainably produced.` },
          ],
        },
        images: {
          create: [
            { url: `https://placehold.co/600x600/e2e8f0/1a1a2e?text=${encodeURIComponent(productNames[i].slice(0, 12))}`, isPrimary: true, sortOrder: 0 },
            { url: `https://placehold.co/600x600/f0e2e8/1a1a2e?text=${encodeURIComponent(productNames[i].slice(0, 12))}+2`, sortOrder: 1 },
          ],
        },
        variants: {
          create: [0, 1, 2].map((vi) => {
            const color = COLORS[Math.floor(Math.random() * COLORS.length)]
            const size = SIZES[vi + 1] // S, M, L
            return {
              sku: `MAL-${String(i + 1).padStart(3, '0')}-${color.slice(0, 3).toUpperCase()}-${size}`,
              color,
              colorHex: COLOR_HEX[color],
              size,
              weightGrams: 300 + Math.floor(Math.random() * 700),
              isActive: true,
              inventory: {
                create: {
                  warehouseId: warehouses[0].id,
                  quantityOnHand: 5 + Math.floor(Math.random() * 50),
                  reorderPoint: 5,
                },
              },
            }
          }),
        },
      },
      include: { variants: true },
    })
    products.push(product)
  }

  // ── Users (5) ─────────────────────────────────────────
  console.log('👤 Erstelle 5 Test-User...')
  const passwordHash = await bcrypt.hash('Test1234!', 12)

  const users = await Promise.all([
    prisma.user.create({
      data: {
        email: 'admin@malak-bekleidung.com', passwordHash, firstName: 'Admin', lastName: 'Malak',
        role: 'super_admin', isVerified: true,
        gdprConsents: { create: { consentType: 'data_processing', isGranted: true, grantedAt: new Date(), consentVersion: '1.0', ipAddress: '127.0.0.1', source: 'registration' } },
      },
    }),
    prisma.user.create({
      data: {
        email: 'staff@malak-bekleidung.com', passwordHash, firstName: 'Lager', lastName: 'Mitarbeiter',
        role: 'admin', isVerified: true,
        gdprConsents: { create: { consentType: 'data_processing', isGranted: true, grantedAt: new Date(), consentVersion: '1.0', ipAddress: '127.0.0.1', source: 'registration' } },
      },
    }),
    prisma.user.create({
      data: {
        email: 'anna@test.de', passwordHash, firstName: 'Anna', lastName: 'Müller',
        role: 'customer', isVerified: true, preferredLang: 'de',
        addresses: { create: { firstName: 'Anna', lastName: 'Müller', street: 'Hauptstraße', houseNumber: '1', postalCode: '10115', city: 'Berlin', country: 'DE', isDefaultShipping: true, isDefaultBilling: true } },
        gdprConsents: { create: { consentType: 'data_processing', isGranted: true, grantedAt: new Date(), consentVersion: '1.0', ipAddress: '127.0.0.1', source: 'registration' } },
      },
    }),
    prisma.user.create({
      data: {
        email: 'john@test.de', passwordHash, firstName: 'John', lastName: 'Smith',
        role: 'customer', isVerified: true, preferredLang: 'en',
        addresses: { create: { firstName: 'John', lastName: 'Smith', street: 'Berliner Str.', houseNumber: '42', postalCode: '80331', city: 'München', country: 'DE', isDefaultShipping: true } },
        gdprConsents: { create: { consentType: 'data_processing', isGranted: true, grantedAt: new Date(), consentVersion: '1.0', ipAddress: '127.0.0.1', source: 'registration' } },
      },
    }),
    prisma.user.create({
      data: {
        email: 'ahmed@test.de', passwordHash, firstName: 'أحمد', lastName: 'محمد',
        role: 'customer', isVerified: true, preferredLang: 'ar',
        addresses: { create: { firstName: 'أحمد', lastName: 'محمد', street: 'Kurfürstendamm', houseNumber: '100', postalCode: '10719', city: 'Berlin', country: 'DE', isDefaultShipping: true } },
        gdprConsents: { create: { consentType: 'data_processing', isGranted: true, grantedAt: new Date(), consentVersion: '1.0', ipAddress: '127.0.0.1', source: 'registration' } },
      },
    }),
  ])

  // ── Orders (20) ───────────────────────────────────────
  console.log('📦 Erstelle 20 Testbestellungen...')
  const statuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']
  const customers = [users[2], users[3], users[4]]

  for (let i = 0; i < 20; i++) {
    const customer = customers[i % 3]
    const status = statuses[i % statuses.length]
    const variant = products[i % 50].variants[0]
    const qty = 1 + Math.floor(Math.random() * 3)
    const unitPrice = Number(products[i % 50].basePrice)
    const totalPrice = unitPrice * qty
    const shippingCost = totalPrice >= 100 ? 0 : 4.99
    const taxAmount = (totalPrice + shippingCost) * 0.19 / 1.19

    await prisma.order.create({
      data: {
        orderNumber: `ORD-20260326-${String(i + 1).padStart(6, '0')}`,
        userId: customer.id,
        status: status as any,
        subtotal: totalPrice,
        shippingCost,
        taxAmount: Math.round(taxAmount * 100) / 100,
        totalAmount: totalPrice + shippingCost,
        currency: 'EUR',
        ...(status === 'cancelled' && { cancelledAt: new Date(), cancelReason: 'Staging test' }),
        createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
        items: {
          create: {
            variantId: variant.id,
            quantity: qty,
            unitPrice,
            taxRate: 19,
            totalPrice,
            snapshotName: products[i % 50].slug,
            snapshotSku: variant.sku,
          },
        },
        statusHistory: {
          create: { fromStatus: null, toStatus: 'pending', source: 'system', createdBy: 'seed' },
        },
      },
    })
  }

  console.log('\n✅ Staging Seed abgeschlossen!')
  console.log(`   📁 10 Kategorien`)
  console.log(`   👕 50 Produkte (150 Varianten)`)
  console.log(`   🏭 3 Lager`)
  console.log(`   🚚 5 Versandzonen`)
  console.log(`   👤 5 User (1 Super-Admin, 1 Admin, 3 Kunden)`)
  console.log(`   📦 20 Bestellungen`)
  console.log(`\n🔑 Test-Accounts:`)
  console.log(`   Super-Admin: admin@malak-bekleidung.com / Test1234!`)
  console.log(`   Admin:       staff@malak-bekleidung.com / Test1234!`)
  console.log(`   Kunde DE:    anna@test.de   / Test1234!`)
  console.log(`   Kunde EN:    john@test.de   / Test1234!`)
  console.log(`   Kunde AR:    ahmed@test.de  / Test1234!`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
