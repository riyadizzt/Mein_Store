import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('── Bug Hunt 2B — Status-update email recipient data for stub guests ──\n')

  const stubs: any[] = await prisma.order.findMany({
    where: {
      deletedAt: null,
      user: { is: { passwordHash: null } },
    },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, preferredLang: true } },
      shippingAddress: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  console.log(`Stub-guest orders: ${stubs.length}\n`)

  let emptyUserName = 0
  let userNameMismatchAddress = 0
  let bothEmpty = 0
  let perfect = 0
  const examples = { emptyUserFilledAddr: [] as any[], garbageUser: [] as any[] }

  for (const o of stubs) {
    const userFirst = (o.user?.firstName ?? '').trim()
    const userLast = (o.user?.lastName ?? '').trim()
    const addrFirst = (o.shippingAddress?.firstName ?? '').trim()
    const addrLast = (o.shippingAddress?.lastName ?? '').trim()

    const userHasName = !!(userFirst && userLast)
    const addrHasName = !!(addrFirst && addrLast)

    if (!userHasName && addrHasName) {
      emptyUserName++
      if (examples.emptyUserFilledAddr.length < 5) {
        examples.emptyUserFilledAddr.push({
          orderNumber: o.orderNumber,
          user: `"${userFirst}" "${userLast}"`,
          address: `"${addrFirst}" "${addrLast}"`,
          email: o.user?.email,
        })
      }
    } else if (!userHasName && !addrHasName) {
      bothEmpty++
    } else if (userHasName && addrHasName) {
      if (userFirst.toLowerCase() !== addrFirst.toLowerCase() || userLast.toLowerCase() !== addrLast.toLowerCase()) {
        userNameMismatchAddress++
        if (examples.garbageUser.length < 5) {
          examples.garbageUser.push({
            orderNumber: o.orderNumber,
            user: `"${userFirst}" "${userLast}"`,
            address: `"${addrFirst}" "${addrLast}"`,
          })
        }
      } else {
        perfect++
      }
    }
  }

  console.log('── Partition ──')
  console.log(`  ✅ Perfect sync (user === address):       ${perfect}`)
  console.log(`  ⚠️  User empty, address filled:           ${emptyUserName}`)
  console.log(`  ⚠️  User + address differ:                ${userNameMismatchAddress}`)
  console.log(`  ❌ Both empty:                            ${bothEmpty}`)

  if (examples.emptyUserFilledAddr.length > 0) {
    console.log('\n── Examples: empty user.firstName but shipping address has name ──')
    for (const e of examples.emptyUserFilledAddr) {
      console.log(`  ${e.orderNumber}  user=${e.user}  addr=${e.address}  email=${e.email}`)
    }
    console.log('\n  Effect: Status-emails would greet "Hallo " or "Hallo ." — ugly')
  }

  if (examples.garbageUser.length > 0) {
    console.log('\n── Examples: user has name but DIFFERENT from address ──')
    for (const e of examples.garbageUser) {
      console.log(`  ${e.orderNumber}  user=${e.user}  addr=${e.address}`)
    }
  }

  console.log('\n── VERDICT ──')
  if (emptyUserName > 0 || bothEmpty > 0) {
    console.log('  🚨 Bug: stub-user.firstName is not synced from shipping address')
    console.log('  Fix: orders.service.ts should backfill user.firstName from dto.shippingAddress')
    console.log('       when creating the stub OR when the address already exists')
  } else {
    console.log('  ✅ All stubs have usable firstName data')
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
