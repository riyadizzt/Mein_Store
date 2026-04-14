import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const token = 'd00858a3-f1e4-4863-be0e-51496a834b4b'
  console.log(`── Looking up verify token: ${token} ──\n`)

  // Direct lookup — exactly what verifyEmail() does
  const match = await prisma.user.findFirst({
    where: { emailVerifyToken: token },
    select: {
      id: true, email: true, isVerified: true,
      emailVerifyToken: true, emailVerifyExpires: true,
      createdAt: true, updatedAt: true,
    },
  })

  if (!match) {
    console.log('❌ No user carries this token in emailVerifyToken column')
    console.log()
    // Was there EVER a user with that token? (empty = never created or already consumed)
    // Also check if there's a user who was JUST verified
    const recentlyVerified = await prisma.user.findMany({
      where: {
        isVerified: true,
        updatedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // last hour
      },
      select: { email: true, updatedAt: true, createdAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    })
    if (recentlyVerified.length > 0) {
      console.log('Recently verified users (last hour):')
      for (const u of recentlyVerified) {
        console.log(`  ${u.email}  verified at ${u.updatedAt.toISOString()}`)
      }
      console.log('\n→ One of these consumed the token already. Likely cause:')
      console.log('   - User clicked the link once, got verified')
      console.log('   - Then clicked again (or refreshed the tab) → token was cleared → "invalid"')
    }

    // Check for recent unverified accounts that might match
    const unverified = await prisma.user.findMany({
      where: {
        isVerified: false,
        emailVerifyToken: { not: null },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: { email: true, emailVerifyToken: true, emailVerifyExpires: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })
    if (unverified.length > 0) {
      console.log('\nUnverified users with fresh tokens (last 24h):')
      for (const u of unverified) {
        const expiresIn = u.emailVerifyExpires
          ? Math.round((u.emailVerifyExpires.getTime() - Date.now()) / 3600000)
          : '?'
        console.log(`  ${u.email}  token=${u.emailVerifyToken?.slice(0, 8)}...  expires in ${expiresIn}h`)
      }
    }
    return
  }

  console.log('✅ User found:')
  console.log(`  email:           ${match.email}`)
  console.log(`  isVerified:      ${match.isVerified}`)
  console.log(`  emailVerifyToken:${match.emailVerifyToken}`)
  console.log(`  expires:         ${match.emailVerifyExpires?.toISOString() ?? '(none)'}`)
  console.log(`  createdAt:       ${match.createdAt.toISOString()}`)

  const now = new Date()
  if (match.isVerified) {
    console.log('\n→ User is already verified (probably clicked before)')
  }
  if (match.emailVerifyExpires && match.emailVerifyExpires < now) {
    console.log('\n→ Token EXPIRED: deadline was ' + match.emailVerifyExpires.toISOString())
  } else if (match.emailVerifyExpires) {
    const hoursLeft = Math.round((match.emailVerifyExpires.getTime() - now.getTime()) / 3600000)
    console.log(`\n→ Token still valid for ${hoursLeft} more hours`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
