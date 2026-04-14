import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const users = await prisma.user.findMany({
    where: {
      isVerified: false,
      emailVerifyToken: { not: null },
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
    select: { email: true, firstName: true, emailVerifyToken: true, emailVerifyExpires: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })

  console.log(`── Fresh unverified users (last hour): ${users.length} ──\n`)
  for (const u of users) {
    const ageMin = Math.round((Date.now() - u.createdAt.getTime()) / 60000)
    console.log(`  ${u.firstName} <${u.email}>  created ${ageMin}min ago`)
    console.log(`    token: ${u.emailVerifyToken}`)
    console.log(`    URL that SHOULD be in the email:`)
    console.log(`    http://localhost:3000/de/auth/verify-email?token=${u.emailVerifyToken}`)
    console.log()
  }
}

main().finally(() => prisma.$disconnect())
