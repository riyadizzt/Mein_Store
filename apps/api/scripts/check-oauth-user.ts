import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const email = process.argv[2] ?? 'cro.defi.mail@gmail.com'
  const user = await prisma.user.findUnique({
    where: { email },
    include: { oauthAccounts: true },
  })
  if (!user) {
    console.log(`User ${email} not found`)
    return
  }
  const oauthProvider = user.oauthAccounts?.[0]?.provider ?? null
  const oldIsGuest = !user.passwordHash
  const isLegacyOauth = !user.passwordHash && user.isVerified && !oauthProvider
  const newIsGuest = !user.passwordHash && !oauthProvider && !isLegacyOauth

  console.log(`── ${user.email} ──`)
  console.log(`  firstName:     ${user.firstName} ${user.lastName}`)
  console.log(`  passwordHash:  ${user.passwordHash ? '✅ set' : '❌ null'}`)
  console.log(`  oauth provider:${oauthProvider ?? '(none)'}`)
  console.log(`  isVerified:    ${user.isVerified}`)
  console.log(`  createdAt:     ${user.createdAt.toISOString()}`)
  console.log()
  console.log(`  OLD isGuest logic: ${oldIsGuest ? '🚨 "Gast" badge' : '✅ no badge'}`)
  console.log(`  NEW isGuest logic: ${newIsGuest ? '🚨 "Gast" badge' : '✅ no badge'}`)
  if (oauthProvider && oldIsGuest && !newIsGuest) {
    console.log(`\n  ✅ FIX WORKS: ${email} is a ${oauthProvider} user, not a guest`)
  }
}

main().finally(() => prisma.$disconnect())
