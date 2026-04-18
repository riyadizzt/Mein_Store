import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Alle Refunds seit 1.1.2026 nach Provider + Status
  const all = await prisma.refund.findMany({
    where: { createdAt: { gte: new Date('2026-01-01') } },
    select: {
      id: true, status: true, amount: true, createdAt: true, processedAt: true,
      payment: { select: { provider: true, order: { select: { orderNumber: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const byProviderStatus: Record<string, { count: number; sum: number }> = {}
  for (const r of all) {
    const k = `${r.payment?.provider ?? 'UNKNOWN'}::${r.status}`
    byProviderStatus[k] ??= { count: 0, sum: 0 }
    byProviderStatus[k].count++
    byProviderStatus[k].sum += Number(r.amount)
  }

  console.log('\n═══ Refunds 2026 — by provider × status ═══\n')
  for (const [k, v] of Object.entries(byProviderStatus).sort()) {
    console.log(`  ${k.padEnd(30)} count=${v.count}  sum=€${v.sum.toFixed(2)}`)
  }

  // Specifically Vorkasse PENDING (= the potential bug)
  const vorkassePending = all.filter((r) => r.payment?.provider === 'VORKASSE' && r.status === 'PENDING')
  console.log(`\n═══ Vorkasse PENDING (UNSICHTBAR IN FINANZBERICHTEN) ═══\n`)
  if (vorkassePending.length === 0) {
    console.log('  Keine. Problem ist THEORETISCH, aber bisher nicht getroffen.')
  } else {
    for (const r of vorkassePending) {
      console.log(`  ${r.payment?.order?.orderNumber}  €${r.amount}  ${r.createdAt.toISOString().slice(0,10)}  processed=${r.processedAt ?? 'null'}`)
    }
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
