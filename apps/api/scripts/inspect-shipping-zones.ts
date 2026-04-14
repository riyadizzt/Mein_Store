import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const zones = await prisma.shippingZone.findMany({ where: { deletedAt: null } })
  console.log(`Found ${zones.length} shipping zones:`)
  for (const z of zones) {
    console.log(`\n  ${z.zoneName}  [active=${z.isActive}]`)
    console.log(`    countryCodes: ${JSON.stringify(z.countryCodes)}`)
    console.log(`    basePrice: ${z.basePrice}  weightSurchargePerKg: ${z.weightSurchargePerKg}`)
    console.log(`    freeShippingThreshold: ${z.freeShippingThreshold}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
