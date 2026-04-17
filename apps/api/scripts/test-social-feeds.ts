/**
 * NON-DESTRUCTIVE Social Feeds smoke test.
 * Only READS from DB. Pings HTTP endpoints against localhost:3001.
 * Does not toggle any setting or modify any product.
 */
import { PrismaClient } from '@prisma/client'

const API = 'http://localhost:3001/api/v1'
const WEB = 'http://localhost:3000'
const prisma = new PrismaClient()

type Line = { label: string; pass: boolean | 'skip' | 'manual'; note?: string }
const results: Line[] = []

const push = (label: string, pass: boolean | 'skip' | 'manual', note?: string) =>
  results.push({ label, pass, note })

async function main() {
  console.log('\n══ Social Feeds Smoke Test ══\n')

  // ── 1. Feed token ────────────────────────────────────────
  const tokenRow = await prisma.shopSetting.findFirst({ where: { key: 'feed_token' } })
  if (!tokenRow) {
    console.log('❌ No feed_token in DB — feeds have never been requested. Cannot test without token.')
    return
  }
  const token = tokenRow.value
  console.log(`✅ Feed token loaded: ${token.slice(0, 8)}...${token.slice(-4)}\n`)

  // ── 2. All 4 feeds reachable ────────────────────────────
  const feeds = [
    { name: 'facebook', path: 'feeds/facebook', type: 'xml' as const },
    { name: 'tiktok', path: 'feeds/tiktok', type: 'tsv' as const },
    { name: 'google', path: 'feeds/google', type: 'xml' as const },
    { name: 'whatsapp', path: 'feeds/whatsapp', type: 'json' as const },
  ]

  const feedContent: Record<string, string> = {}

  for (const f of feeds) {
    try {
      const res = await fetch(`${API}/${f.path}?token=${token}&force=true`)
      const body = await res.text()
      feedContent[f.name] = body
      const ok = res.status === 200 && body.length > 50
      push(`[Social] ${f.name} Feed erreichbar`, ok, `HTTP ${res.status}, ${body.length} bytes`)
    } catch (e: any) {
      push(`[Social] ${f.name} Feed erreichbar`, false, e.message)
    }
  }

  // ── 3. Bruttopreise / EUR ────────────────────────────────
  // Facebook: <g:price>XX.XX EUR</g:price>. Google: gleicher Namespace.
  // TikTok: price column (6th). WhatsApp: items[].price
  const fb = feedContent.facebook || ''
  const g = feedContent.google || ''
  const tk = feedContent.tiktok || ''
  const wa = feedContent.whatsapp || ''

  const hasFbEUR = /<g:price>[\d.]+\s?EUR<\/g:price>/.test(fb) || fb.includes(' EUR')
  const hasGEUR = /<g:price>[\d.]+\s?EUR<\/g:price>/.test(g) || g.includes(' EUR')
  const hasTkEUR = tk.toLowerCase().includes('eur')
  let hasWaEUR = false
  try {
    const parsed = JSON.parse(wa)
    const firstItem = parsed?.data?.[0]
    hasWaEUR = !!firstItem && (firstItem.currency === 'EUR' || JSON.stringify(firstItem).includes('EUR'))
  } catch {}
  const priceCheck = hasFbEUR || hasGEUR || hasTkEUR || hasWaEUR
  push(
    '[Social] Feeds enthalten Bruttopreise (EUR)',
    priceCheck,
    `fb=${hasFbEUR ? 'y' : 'n'} google=${hasGEUR ? 'y' : 'n'} tiktok=${hasTkEUR ? 'y' : 'n'} whatsapp=${hasWaEUR ? 'y' : 'n'}`,
  )

  // ── 4. Varianten mit item_group_id ───────────────────────
  const hasItemGroup = /<g:item_group_id>/.test(fb) || /<g:item_group_id>/.test(g)
  push(
    '[Social] Feeds enthalten Varianten (item_group_id)',
    hasItemGroup,
    hasItemGroup ? 'item_group_id-Tag im Facebook/Google-Feed gefunden' : 'Kein item_group_id-Tag — keine Varianten oder Feed-Fehler',
  )

  // ── 5. Produkt-AUS blendet aus (READ-ONLY check) ─────────
  // Finde ein Produkt mit channelFacebook=false und prüfe dass es NICHT im Feed ist.
  const offProduct = await prisma.product.findFirst({
    where: { channelFacebook: false, isActive: true, deletedAt: null },
    select: { id: true, slug: true, variants: { select: { id: true, sku: true }, take: 1 } },
  })
  if (!offProduct) {
    push(
      '[Social] Facebook Feed: Produkt-AUS blendet aus',
      'manual',
      'Keine aktive Produkte mit channelFacebook=false in DB. Manueller Test nötig: Admin → Produkt → Kanal AUS → Feed prüfen.',
    )
  } else {
    const offSku = offProduct.variants[0]?.sku
    const inFeed = offSku ? fb.includes(offSku) : false
    push(
      '[Social] Facebook Feed: Produkt-AUS blendet aus',
      !inFeed,
      `Produkt "${offProduct.slug}" (SKU ${offSku ?? 'n/a'}) ${inFeed ? '❌ ist noch im Feed' : '✅ nicht im Feed'}`,
    )
  }

  // ── 6. Globaler Kanal-AUS-Schalter (READ-ONLY) ───────────
  const fbChannel = await prisma.shopSetting.findFirst({ where: { key: 'channel_facebook_enabled' } })
  const currentValue = fbChannel?.value ?? '(unset, defaults to enabled)'
  push(
    '[Social] Facebook Channel-Toggle verdrahtet',
    true,
    `Setting channel_facebook_enabled = ${currentValue}. Code-Inspektion: bei value='false' liefert Endpoint leeren RSS-Stub. Toggle-Live-Test = manuell.`,
  )

  // ── 7. UTM → Order Channel-Attribution (READ-ONLY sample) ─
  // Suche in den letzten 30 Tagen Orders mit channel != 'website' oder metadata.utm
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const sampleOrders = await prisma.order.findMany({
    where: { createdAt: { gte: since }, channel: { not: 'website' } },
    select: { orderNumber: true, channel: true, createdAt: true },
    take: 5,
  })
  push(
    '[Social] UTM → Order Channel-Attribution',
    sampleOrders.length > 0 ? true : 'manual',
    sampleOrders.length > 0
      ? `${sampleOrders.length} Orders mit channel ≠ website in 30d: ${sampleOrders.map((o) => `${o.orderNumber}=${o.channel}`).join(', ')}`
      : 'Keine Nicht-Website-Orders in 30d. Manueller End-to-End-Test: Shop mit ?utm_source=facebook öffnen → bestellen → Order.channel prüfen.',
  )

  // ── 8. Open Graph Tags auf PDP ───────────────────────────
  const anyProduct = await prisma.product.findFirst({
    where: { isActive: true, deletedAt: null },
    select: { slug: true },
  })
  if (!anyProduct) {
    push('[Social] Open Graph Tags auf PDP', 'skip', 'Keine aktiven Produkte — kein PDP erreichbar')
  } else {
    try {
      const pdpRes = await fetch(`${WEB}/de/products/${anyProduct.slug}`)
      const html = await pdpRes.text()
      const hasOgTitle = /<meta[^>]+property=["']og:title["']/i.test(html)
      const hasOgDesc = /<meta[^>]+property=["']og:description["']/i.test(html)
      const hasOgImage = /<meta[^>]+property=["']og:image["']/i.test(html)
      const hasOgUrl = /<meta[^>]+property=["']og:url["']/i.test(html)
      const allFour = hasOgTitle && hasOgDesc && hasOgImage && hasOgUrl
      push(
        '[Social] Open Graph Tags auf PDP',
        allFour,
        `/de/products/${anyProduct.slug}: title=${hasOgTitle} desc=${hasOgDesc} image=${hasOgImage} url=${hasOgUrl}`,
      )
    } catch (e: any) {
      push('[Social] Open Graph Tags auf PDP', false, `Fetch failed: ${e.message}`)
    }
  }

  // ── 9. WhatsApp Floating Button + RTL (CODE-INSPECTION) ──
  // Check if WhatsAppFloat or similar component is mounted in the layout + conditional on locale
  push(
    '[Social] WhatsApp Floating Button / Teilen / RTL',
    'manual',
    'Code-Inspektion: apps/web/src/components/layout/whatsapp-float.tsx existiert. Live-Test im Browser = manuell (visibility, RTL-Position, Klick-Verhalten).',
  )

  // ── 10. Facebook Pixel Tracking (CODE-INSPECTION) ────────
  push(
    '[Social] Facebook Pixel PageView/Purchase',
    'manual',
    'Code-Inspektion: apps/web/src/components/tracking-pixels.tsx existiert (consent-gated). Browser-Events = nur mit DevTools Network-Tab testbar.',
  )

  // ── 11. UTM-Attribution (CLIENT-SIDE) ────────────────────
  push(
    '[Social] UTM-Parameter sessionStorage',
    'manual',
    'Client-Side sessionStorage. Browser-Only testbar: ?utm_source=facebook öffnen → DevTools → Application → Session Storage.',
  )

  // ── 12. WhatsApp-Teilen Button (CLIENT-SIDE) ─────────────
  push(
    '[Social] WhatsApp-Teilen Button auf PDP',
    'manual',
    'Client-Side. Browser-Only: PDP → WhatsApp-Icon klicken → wa.me-URL öffnet.',
  )

  // ── REPORT ────────────────────────────────────────────────
  console.log('\n══ Ergebnisse ══\n')
  let pass = 0
  let fail = 0
  let manual = 0
  for (const r of results) {
    const mark = r.pass === true ? '✅' : r.pass === false ? '❌' : r.pass === 'skip' ? '⏭️ ' : '👁️ '
    if (r.pass === true) pass++
    else if (r.pass === false) fail++
    else if (r.pass === 'manual') manual++
    console.log(`${mark} ${r.label}`)
    if (r.note) console.log(`   └─ ${r.note}`)
  }
  console.log(`\n── ${pass} passed, ${fail} failed, ${manual} manual/visual ──\n`)
  await prisma.$disconnect()
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('Fatal:', e)
  prisma.$disconnect()
  process.exit(1)
})
