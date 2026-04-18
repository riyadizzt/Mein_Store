/**
 * READ-ONLY Stripe inspector.
 *
 * Pulls a PaymentIntent from Stripe's live API to settle ground truth:
 * was money actually captured, or is the intent merely abandoned?
 *
 * Safety: uses ONLY `paymentIntents.retrieve()` and `charges.list()` —
 * both are GET endpoints, zero state change. Secret key never logged.
 *
 * Usage: npx tsx scripts/stripe-inspect-pi.ts pi_3TNGXzJRub7L8rXv0ogNsUOC
 */

// Load .env manually (no dotenv dep in this workspace).
try {
  const fs = require('node:fs')
  const path = require('node:path')
  const envText = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8')
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(m[1] in process.env)) process.env[m[1]] = v
  }
} catch {}

import Stripe from 'stripe'

async function main() {
  const piId = process.argv[2]
  if (!piId || !piId.startsWith('pi_')) {
    console.error('Usage: stripe-inspect-pi.ts <pi_XXX>')
    process.exit(1)
  }

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    console.error('STRIPE_SECRET_KEY not set')
    process.exit(1)
  }

  const stripe = new Stripe(key, { apiVersion: '2024-12-18.acacia' as any })

  console.log(`\n═══ Stripe PaymentIntent ${piId} ═══\n`)
  const pi = await stripe.paymentIntents.retrieve(piId, {
    expand: ['charges', 'latest_charge'],
  } as any)

  console.log(`  id:                 ${pi.id}`)
  console.log(`  status:             ${pi.status}`)
  console.log(`  amount (cents):     ${pi.amount}`)
  console.log(`  amount_received:    ${pi.amount_received}  ← 0 = kein Geld geflossen`)
  console.log(`  amount_capturable:  ${pi.amount_capturable}`)
  console.log(`  currency:           ${pi.currency}`)
  console.log(`  created:            ${new Date(pi.created * 1000).toISOString()}`)
  console.log(`  canceled_at:        ${pi.canceled_at ? new Date(pi.canceled_at * 1000).toISOString() : 'null'}`)
  console.log(`  cancellation_reason:${pi.cancellation_reason ?? 'null'}`)
  console.log(`  payment_method:     ${pi.payment_method ?? 'null'}  ← null = nie eine Karte angehängt`)
  const latest = (pi as any).latest_charge
  console.log(`  latest_charge:      ${typeof latest === 'string' ? latest : latest?.id ?? 'null'}`)
  console.log(`  metadata:           ${JSON.stringify(pi.metadata)}`)

  console.log(`\n═══ Charges für diesen Intent ═══\n`)
  const charges = await stripe.charges.list({ payment_intent: piId, limit: 10 })
  if (charges.data.length === 0) {
    console.log('  KEINE Charges — Geld ist NIE geflossen.')
  } else {
    for (const c of charges.data) {
      console.log(`  ${c.id}  amount=${c.amount}c  captured=${c.captured}  status=${c.status}  refunded=${c.refunded}  paid=${c.paid}`)
      if (c.refunds?.data?.length) {
        for (const r of c.refunds.data) {
          console.log(`    refund ${r.id}  ${r.amount}c  ${r.status}`)
        }
      }
    }
  }

  console.log(`\n═══ Interpretation ═══`)
  if (pi.status === 'succeeded' && pi.amount_received > 0) {
    console.log(`  🚨 GELD WURDE KASSIERT — ${(pi.amount_received / 100).toFixed(2)} ${pi.currency.toUpperCase()}`)
    console.log(`  Falls Order cancelled ist → Refund NÖTIG, sofort handeln.`)
  } else if (pi.status === 'requires_payment_method') {
    console.log(`  ✅ Kein Geld geflossen. Intent offen — wartet auf Zahlungsmethode.`)
    console.log(`  Stripe lässt ihn nach ~24h auto-ablaufen ("canceled").`)
  } else if (pi.status === 'canceled') {
    console.log(`  ✅ Kein Geld geflossen. Intent wurde bereits gecancelt.`)
  } else if (pi.status === 'processing') {
    console.log(`  ⏳ Zahlung in Bearbeitung — später nochmal prüfen.`)
  } else {
    console.log(`  Status: ${pi.status} — siehe Stripe-Doku für die Semantik.`)
  }
  console.log('')
}

main().catch((e) => {
  console.error('Error:', e?.message ?? e)
  process.exit(1)
})
