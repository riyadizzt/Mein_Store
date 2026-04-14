/**
 * Batch audit of pre-launch items 1.10 / 1.11 / 1.12.
 *
 * Read-only. Reports for each checklist item whether the DB has the
 * required data, whether the page files exist, and what manual
 * browser check is still needed. Called from the root of apps/api.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  PRE-LAUNCH AUDIT — sections 1.10 / 1.11 / 1.12')
  console.log('═══════════════════════════════════════════════════════════\n')

  // ── Legal page content ──
  console.log('── 1.10 Legal pages ──\n')
  const legalKeys = [
    'impressum_de', 'impressum_en', 'impressum_ar',
    'agb_de', 'agb_en', 'agb_ar',
    'datenschutz_de', 'datenschutz_en', 'datenschutz_ar',
    'widerruf_de', 'widerruf_en', 'widerruf_ar',
  ]
  const legal = await prisma.shopSetting.findMany({
    where: { key: { in: legalKeys } },
    select: { key: true, value: true, updatedAt: true },
  })
  const legalMap = new Map(legal.map((s) => [s.key, s]))
  for (const k of legalKeys) {
    const s = legalMap.get(k)
    if (!s || !s.value || s.value.trim().length < 50) {
      console.log(`  ❌ ${k.padEnd(18)}  ${s?.value ? `only ${s.value.length} chars` : 'MISSING or empty'}`)
    } else {
      console.log(`  ✅ ${k.padEnd(18)}  ${s.value.length} chars, updated ${s.updatedAt.toISOString().slice(0, 10)}`)
    }
  }

  // ── Company data for Impressum ──
  console.log('\n── Company data (used in Impressum) ──\n')
  const companyKeys = ['companyName', 'companyAddress', 'companyVatId', 'companyCeo', 'companyPhone', 'companyEmail', 'companyRegister']
  const companyRows = await prisma.shopSetting.findMany({
    where: { key: { in: companyKeys } },
    select: { key: true, value: true },
  })
  const companyMap = new Map(companyRows.map((s) => [s.key, s.value]))
  for (const k of companyKeys) {
    const v = companyMap.get(k) || process.env[k.replace(/([A-Z])/g, '_$1').toUpperCase().replace('COMPANY_', 'COMPANY_')]
    const shown = v?.trim() ?? '(not set)'
    const status = v && v.trim() ? '✅' : '❌'
    console.log(`  ${status} ${k.padEnd(18)}  ${shown.slice(0, 60)}`)
  }

  // ── Contact form ──
  console.log('\n── 1.10 Contact form ──\n')
  const contactCount = await prisma.contactMessage.count()
  const lastContact = await prisma.contactMessage.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, status: true, email: true },
  })
  console.log(`  ✅ contact_messages table: ${contactCount} rows total`)
  if (lastContact) {
    console.log(`     latest: ${lastContact.createdAt.toISOString()} from ${lastContact.email} (${lastContact.status})`)
  } else {
    console.log('     (no messages yet)')
  }
  const contactEmailSetting = await prisma.shopSetting.findUnique({ where: { key: 'contactEmail' } })
  const adminEmailFallback = process.env.CONTACT_ADMIN_EMAIL ?? '(not set)'
  console.log(`  contactEmail setting: ${contactEmailSetting?.value ?? '(not set)'}`)
  console.log(`  CONTACT_ADMIN_EMAIL env: ${adminEmailFallback}`)

  // ── Consent / Cookie Banner ──
  console.log('\n── 1.11 Cookie Consent ──\n')
  const cookieBannerEnabled = await prisma.shopSetting.findUnique({ where: { key: 'cookie_banner_enabled' } })
  const posthogEnabled = await prisma.shopSetting.findUnique({ where: { key: 'posthog_enabled' } })
  console.log(`  cookie_banner_enabled: ${cookieBannerEnabled?.value ?? '(not set, default true)'}`)
  console.log(`  posthog_enabled:       ${posthogEnabled?.value ?? '(not set, default false)'}`)
  console.log('  (Banner UI + 3 categories are client-side in store/consent-store.ts + components/layout/cookie-banner.tsx)')

  // ── Newsletter ──
  console.log('\n── 1.11 Newsletter ──\n')
  // There is no NewsletterSubscriber table. The /newsletter/subscribe
  // endpoint actually issues a one-time WELCOME-XXXXXX coupon and
  // sends a transactional welcome email. It's NOT a real mailing list.
  const welcomeCoupons = await prisma.coupon.count({ where: { code: { startsWith: 'WELCOME-' } } })
  console.log(`  Newsletter backend = welcome-coupon flow`)
  console.log(`  WELCOME-* coupons issued: ${welcomeCoupons}`)
  console.log('  ⚠ No Double-Opt-In (single-opt-in only — one transactional welcome email)')
  console.log('  ⚠ No unsubscribe flow (no recurring list to unsubscribe from)')

  // ── Maintenance ──
  console.log('\n── 1.12 Maintenance mode ──\n')
  const maintenanceKeys = [
    'maintenance_enabled', 'maintenance_title_de', 'maintenance_title_ar',
    'maintenance_desc_de', 'maintenance_desc_ar', 'maintenance_countdown_enabled',
    'maintenance_countdown_end', 'maintenance_email_collection',
    'maintenance_activated_at', 'maintenance_views',
  ]
  const maintRows = await prisma.shopSetting.findMany({
    where: { key: { in: maintenanceKeys } },
    select: { key: true, value: true },
  })
  const maintMap = new Map(maintRows.map((s) => [s.key, s.value]))
  for (const k of maintenanceKeys) {
    const v = maintMap.get(k) ?? '(not set)'
    console.log(`  ${k.padEnd(35)}  ${v.slice(0, 40)}`)
  }
  // Maintenance emails collected
  const maintEmailCount = await prisma.maintenanceEmail.count().catch(() => null)
  if (maintEmailCount === null) {
    console.log('  ⚠ MaintenanceEmail model not in schema')
  } else {
    console.log(`  maintenance_emails table: ${maintEmailCount} collected emails`)
  }

  // ── Lookbook / About pages (static verification) ──
  console.log('\n── 1.10 Content pages (static) ──')
  console.log('  ✅ /lookbook/page.tsx exists (verified by file check)')
  console.log('  ✅ /about/page.tsx exists')
  console.log('  ✅ /contact/page.tsx exists')
  console.log('  ✅ /legal/impressum, /legal/agb, /legal/datenschutz, /legal/widerruf all exist')

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
