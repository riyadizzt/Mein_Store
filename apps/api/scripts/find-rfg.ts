import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const users = await prisma.user.findMany({
    where: { OR: [
      { firstName: 'rfg' },
      { firstName: { contains: 'rfg', mode: 'insensitive' } },
    ]},
    select: { email: true, firstName: true, lastName: true, isVerified: true, emailVerifyToken: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })
  console.log(`Found ${users.length} users with firstName containing "rfg":\n`)
  for (const u of users) {
    console.log(`  ${u.firstName} ${u.lastName} <${u.email}>`)
    console.log(`    isVerified: ${u.isVerified}`)
    console.log(`    token: ${u.emailVerifyToken ?? '(null)'}`)
    console.log(`    created: ${u.createdAt.toISOString()}`)
    console.log()
  }
}
main().finally(() => prisma.$disconnect())
