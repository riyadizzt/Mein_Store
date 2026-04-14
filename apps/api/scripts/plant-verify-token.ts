/**
 * Plant a fresh verify token on a test user so the user can click-test
 * the fixed verify-email page. Creates the user if it does not exist,
 * or resets an existing one. Always produces a brand new token.
 */
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

async function main() {
  const email = 'verify-click-test@malak-test.local'
  const password = 'TestPass$2026'
  const token = randomUUID()

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        isVerified: false,
        emailVerifyToken: token,
        emailVerifyExpires: new Date(Date.now() + 24 * 3600 * 1000),
      },
    })
    console.log(`✅ Reset existing test user ${email}`)
  } else {
    await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 12),
        firstName: 'Verify',
        lastName: 'Test',
        role: 'customer',
        isVerified: false,
        isActive: true,
        emailVerifyToken: token,
        emailVerifyExpires: new Date(Date.now() + 24 * 3600 * 1000),
      },
    })
    console.log(`✅ Created test user ${email}`)
  }

  console.log('')
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  👉 CLICK-TEST LINKS')
  console.log('═══════════════════════════════════════════════════════════')
  console.log('')
  console.log('  NEW path-based (tracker-proof):')
  console.log(`  http://localhost:3000/de/auth/verify-email/${token}`)
  console.log('')
  console.log('  OLD query-based (fallback for old emails):')
  console.log(`  http://localhost:3000/de/auth/verify-email?token=${token}`)
  console.log('')
  console.log('  Expected:')
  console.log('    1. Gold spinner "E-Mail wird verifiziert..." (briefly)')
  console.log('    2. Flips to green success screen in <1s')
  console.log('    3. URL loses the ?token= query param (refresh-safe)')
  console.log('    4. Button "Zu meinem Konto" navigates to /account')
  console.log('')
  console.log('  Negative test — refresh the success page:')
  console.log('    → Should STAY on success (no error)')
  console.log('')
  console.log('  Login later:')
  console.log(`    email:    ${email}`)
  console.log(`    password: ${password}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
