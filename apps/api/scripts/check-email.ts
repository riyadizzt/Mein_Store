import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const email = process.argv[2] ?? 'ronyizzt1024@gmail.com'
  console.log(`── Checking: ${email} ──\n`)

  const user: any = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  })
  if (!user) {
    console.log('❌ User does NOT exist in DB — the "already registered" message is a lie')
    return
  }

  console.log('✅ User EXISTS in DB:')
  console.log('  id              ', user.id)
  console.log('  email           ', user.email)
  console.log('  firstName       ', user.firstName)
  console.log('  lastName        ', user.lastName)
  console.log('  role            ', user.role)
  console.log('  passwordHash    ', user.passwordHash ? `✅ set (${user.passwordHash.length} chars) → can log in` : '❌ null (STUB — cannot log in)')
  console.log('  isVerified      ', user.isVerified)
  console.log('  isActive        ', user.isActive)
  console.log('  isBlocked       ', user.isBlocked)
  console.log('  deletedAt       ', (user as any).deletedAt ?? '—')
  console.log('  provider        ', user.provider ?? '—')
  console.log('  createdAt       ', user.createdAt.toISOString())
  console.log('  lastLoginAt     ', user.lastLoginAt?.toISOString() ?? 'never')

  // Any orders?
  const orderCount = await prisma.order.count({ where: { userId: user.id, deletedAt: null } })
  console.log(`\n  Orders linked: ${orderCount}`)

  if (orderCount > 0) {
    const orders = await prisma.order.findMany({
      where: { userId: user.id, deletedAt: null },
      select: { orderNumber: true, status: true, totalAmount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    for (const o of orders) {
      console.log(`    ${o.orderNumber}  €${o.totalAmount}  ${o.status}  ${o.createdAt.toISOString()}`)
    }
  }

  console.log('\n── Diagnosis ──')
  if (!user.passwordHash) {
    console.log('  ⚠️  This is a STUB account (guest checkout).')
    console.log('  → The user CANNOT log in normally because no password is set.')
    console.log('  → They SHOULD go through the invite link (if they got the email),')
    console.log('    or use "Passwort vergessen" to set one now.')
    console.log('  → The register form correctly rejects them because the email exists,')
    console.log('    but it should offer a path to CLAIM the existing stub instead of')
    console.log('    a dead-end error message.')
  } else {
    console.log('  ✅ Real account — user just needs to LOG IN, not re-register.')
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
