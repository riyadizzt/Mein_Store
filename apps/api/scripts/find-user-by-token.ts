import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const tok = process.argv[2] ?? '2b91efc8-f0fb-474b-95aa-0e480efa2e53'
  console.log(`── Looking up verify token: ${tok} ──\n`)

  const match = await prisma.user.findFirst({
    where: { emailVerifyToken: tok },
  })

  if (match) {
    console.log(`✅ User found: ${match.email}`)
    console.log(`   isVerified: ${match.isVerified}`)
    console.log(`   expires:    ${match.emailVerifyExpires?.toISOString()}`)
    return
  }

  console.log('❌ No user currently holds this token')
  console.log('   Either:')
  console.log('     - Never existed (manually typed / typo)')
  console.log('     - Already consumed (user verified, token cleared)')

  // Any fresh unverified token we can use for a fresh test?
  const fresh = await prisma.user.findMany({
    where: {
      isVerified: false,
      emailVerifyToken: { not: null },
      emailVerifyExpires: { gt: new Date() },
    },
    select: { email: true, emailVerifyToken: true, emailVerifyExpires: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })

  if (fresh.length > 0) {
    console.log('\nFresh unverified tokens you can click-test with:')
    for (const u of fresh) {
      const hLeft = Math.round(((u.emailVerifyExpires?.getTime() ?? 0) - Date.now()) / 3600000)
      console.log(`  ${u.email}`)
      console.log(`    http://localhost:3000/de/auth/verify-email?token=${u.emailVerifyToken}`)
      console.log(`    expires in ${hLeft}h`)
    }
  } else {
    console.log('\n(No fresh unverified tokens exist. Register a new account to get one.)')
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
