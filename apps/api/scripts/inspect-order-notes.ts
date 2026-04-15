import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const ids = ['4d849f1d', 'a4c20e42']
  for (const short of ids) {
    const o = await prisma.order.findFirst({
      where: { id: { startsWith: short } },
      select: { id: true, orderNumber: true, status: true, notes: true, payment: { select: { provider: true, status: true } } },
    })
    if (!o) { console.log(`${short}: not found`); continue }
    let notes: any = {}
    try { notes = JSON.parse(o.notes ?? '{}') } catch {}
    console.log(`\n${o.orderNumber}  (${o.payment?.provider}, ${o.payment?.status}, order=${o.status})`)
    console.log(`  notes keys: ${Object.keys(notes).join(', ')}`)
    console.log(`  reservationIds: ${JSON.stringify(notes.reservationIds ?? 'NONE')}`)
    console.log(`  hasConfirmationToken: ${!!notes.confirmationToken}`)
    console.log(`  hasInviteToken: ${!!notes.inviteToken}`)
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
