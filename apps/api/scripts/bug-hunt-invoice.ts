/**
 * Bug hunt 2A — Invoice PDF for guest stub users.
 *
 * Key invariant: resolveAddress() in invoice.service.ts has a priority
 * fallback chain. The invoice PDF uses whatever it returns first. If a
 * stub-user order has NO shippingAddress relation, it will fall through
 * to user.firstName which for stub users is often placeholder garbage
 * like "df df".
 *
 * This script checks every guest order for address integrity.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('── Bug Hunt 2A — Invoice PDF data integrity for guests ──\n')

  const orders: any[] = await prisma.order.findMany({
    where: {
      deletedAt: null,
      user: { is: { passwordHash: null } },
    },
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      shippingAddress: true,
      payment: { select: { status: true } },
    },
  })

  console.log(`Stub-guest orders found: ${orders.length}\n`)

  let withAddress = 0
  let withSnapshot = 0
  let withOnlyUserName = 0
  let stubPlaceholderRisk: any[] = []
  let missingData: any[] = []
  let addressNameMismatch: any[] = []

  for (const o of orders) {
    if (o.shippingAddress) {
      withAddress++
      // Would the PDF look sane? Check for empty/garbage firstName+lastName
      const hasName = !!(o.shippingAddress.firstName?.trim() && o.shippingAddress.lastName?.trim())
      const hasStreet = !!(o.shippingAddress.street?.trim())
      const hasCity = !!(o.shippingAddress.city?.trim())
      const hasZip = !!(o.shippingAddress.postalCode?.trim())
      if (!hasName || !hasStreet || !hasCity || !hasZip) {
        missingData.push({
          orderNumber: o.orderNumber,
          name: `${o.shippingAddress.firstName ?? ''} ${o.shippingAddress.lastName ?? ''}`.trim(),
          street: o.shippingAddress.street ?? '—',
          city: o.shippingAddress.city ?? '—',
          zip: o.shippingAddress.postalCode ?? '—',
        })
      }

      // Check for mismatch: address name ≠ user.firstName ≠ placeholder
      const addrName = `${o.shippingAddress.firstName ?? ''} ${o.shippingAddress.lastName ?? ''}`.trim()
      const userName = `${o.user?.firstName ?? ''} ${o.user?.lastName ?? ''}`.trim()
      if (addrName && userName && addrName.toLowerCase() !== userName.toLowerCase()) {
        // Not necessarily a bug, but worth logging
        if (userName.length < 4 || /^([a-z]{1,3})\s+([a-z]{1,3})$/i.test(userName)) {
          addressNameMismatch.push({ orderNumber: o.orderNumber, addrName, userName })
        }
      }
    } else if (o.shippingAddressSnapshot) {
      withSnapshot++
    } else {
      withOnlyUserName++
      // This is the risk case — invoice would use user.firstName (stub placeholder)
      stubPlaceholderRisk.push({
        orderNumber: o.orderNumber,
        status: o.status,
        userName: `${o.user?.firstName ?? ''} ${o.user?.lastName ?? ''}`,
        email: o.user?.email,
      })
    }
  }

  console.log(`── Address Resolution Partition ──`)
  console.log(`  With shippingAddress relation: ${withAddress}`)
  console.log(`  With shippingAddressSnapshot:  ${withSnapshot}`)
  console.log(`  ⚠️  Only user.firstName fallback: ${withOnlyUserName}`)

  if (stubPlaceholderRisk.length > 0) {
    console.log('\n🚨 STUB PLACEHOLDER RISK — Invoice would show garbage names:')
    for (const r of stubPlaceholderRisk.slice(0, 10)) {
      console.log(`   ${r.orderNumber}  ${r.status}  userName="${r.userName}"  ${r.email}`)
    }
  }

  if (missingData.length > 0) {
    console.log(`\n⚠️  ${missingData.length} orders have INCOMPLETE shipping address (name/street/city/zip):`)
    for (const m of missingData.slice(0, 10)) {
      console.log(`   ${m.orderNumber}  name="${m.name}"  street="${m.street}"  city="${m.city}"  zip="${m.zip}"`)
    }
  } else {
    console.log('\n  ✅ All addresses are complete (name + street + city + zip)')
  }

  console.log('\n── VERDICT ──')
  if (stubPlaceholderRisk.length === 0 && missingData.length === 0) {
    console.log('  ✅ PASS — Invoice PDF for guests uses real shipping address names')
  } else {
    console.log(`  ⚠️  ${stubPlaceholderRisk.length + missingData.length} orders at risk`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
