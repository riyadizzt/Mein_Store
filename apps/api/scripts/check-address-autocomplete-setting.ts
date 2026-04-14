import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const setting = await prisma.shopSetting.findUnique({
    where: { key: 'addressAutocompleteEnabled' },
  })
  if (setting) {
    console.log(`Setting exists: ${setting.key} = "${setting.value}"`)
    console.log(`  updatedAt: ${setting.updatedAt.toISOString()}`)
  } else {
    console.log('Setting NOT found in DB — returns default "false"')
  }

  // Also check what the GET /admin/settings endpoint would return by simulating
  // the same projection logic. Test by hitting the actual public settings API.
  console.log('\nTesting GET /api/v1/settings/public (health endpoint)...')
  try {
    const res = await fetch('http://localhost:3001/api/v1/settings/public')
    const data: any = await res.json()
    console.log(`  public settings → addressAutocompleteEnabled = "${data.addressAutocompleteEnabled}"`)
  } catch (e) {
    console.log(`  public endpoint failed: ${(e as Error).message}`)
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
