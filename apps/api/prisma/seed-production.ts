/**
 * Production Seed — NUR essenzielle Daten
 * KEINE Testprodukte, KEINE Testbestellungen
 *
 * Erstellt: 1 Super-Admin, 5 Shipping Zones, 1 Standardlager
 */
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  console.log('🚀 Production Seed gestartet...\n')

  // ── Admin User ────────────────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@malak-bekleidung.com'
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) {
    console.error('❌ ADMIN_PASSWORD Umgebungsvariable muss gesetzt sein!')
    process.exit(1)
  }

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } })
  if (!existing) {
    const hash = await bcrypt.hash(adminPassword, 12)
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: hash,
        firstName: 'Admin',
        lastName: 'Malak',
        role: 'super_admin',
        isVerified: true,
        gdprConsents: {
          create: {
            consentType: 'data_processing',
            isGranted: true,
            grantedAt: new Date(),
            consentVersion: '1.0',
            ipAddress: 'seed',
            source: 'registration',
          },
        },
      },
    })
    console.log(`✅ Super-Admin erstellt: ${adminEmail}`)
  } else {
    console.log(`ℹ️  Admin existiert bereits: ${adminEmail}`)
  }

  // ── Warehouse ─────────────────────────────────────────
  const whCount = await prisma.warehouse.count()
  if (whCount === 0) {
    await prisma.warehouse.create({
      data: { name: 'Hauptlager', type: 'WAREHOUSE', isDefault: true },
    })
    console.log('✅ Standardlager erstellt')
  }

  // ── Shipping Zones ────────────────────────────────────
  const zoneCount = await prisma.shippingZone.count()
  if (zoneCount === 0) {
    await prisma.shippingZone.createMany({
      data: [
        { zoneName: 'Deutschland', countryCodes: ['DE'], basePrice: 4.99, freeShippingThreshold: 100, isActive: true },
        { zoneName: 'Österreich', countryCodes: ['AT'], basePrice: 8.99, freeShippingThreshold: 150, isActive: true },
        { zoneName: 'Schweiz', countryCodes: ['CH'], basePrice: 12.99, freeShippingThreshold: 200, isActive: true },
        { zoneName: 'Benelux', countryCodes: ['NL', 'BE', 'LU'], basePrice: 9.99, freeShippingThreshold: 150, isActive: true },
        { zoneName: 'EU West', countryCodes: ['FR', 'PL'], basePrice: 11.99, freeShippingThreshold: 200, isActive: true },
      ],
    })
    console.log('✅ 5 Versandzonen erstellt')
  }

  console.log('\n✅ Production Seed abgeschlossen.')
  console.log('   Nächster Schritt: Produkte über Admin Dashboard anlegen.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
