import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('\n═══ Aktueller DB-Zustand (nur Zähler) ═══\n')

  const counts: Record<string, number> = {}
  const tables = [
    ['Orders', 'order'],
    ['OrderItems', 'orderItem'],
    ['OrderStatusHistory', 'orderStatusHistory'],
    ['Payments', 'payment'],
    ['Refunds', 'refund'],
    ['Invoices (INVOICE + CREDIT_NOTE)', 'invoice'],
    ['Shipments', 'shipment'],
    ['Returns', 'return'],
    ['ReturnItems', 'returnItem'],
    ['StockReservations', 'stockReservation'],
    ['InventoryMovements', 'inventoryMovement'],
    ['Notifications', 'notification'],
    ['AuditLogs', 'adminAuditLog'],
    ['ContactMessages', 'contactMessage'],
    ['Users (total)', 'user'],
    ['CouponUsages', 'couponUsage'],
    ['RefreshTokens', 'refreshToken'],
    ['EmailLogs', 'emailLog'],
    ['SearchLogs', 'searchLog'],
    ['AdminNotes', 'adminNote'],
    ['WebhookDeliveryLogs', 'webhookDeliveryLog'],
    ['WebhookSubscriptions', 'webhookSubscription'],
    ['Addresses', 'address'],
    ['WhatsappMessages', 'whatsappMessage'],
    ['ReviewProducts', 'productReview'],
    ['WishlistItems', 'wishlistItem'],
    ['Inventory rows', 'inventory'],
    ['ProductVariants', 'productVariant'],
    ['Products', 'product'],
    ['ProductImages', 'productImage'],
    ['Categories', 'category'],
    ['Warehouses', 'warehouse'],
    ['ShopSettings', 'shopSetting'],
    ['ChannelProductListings', 'channelProductListing'],
    ['ChannelSyncLogs', 'channelSyncLog'],
    ['Campaigns', 'campaign'],
    ['Coupons', 'coupon'],
    ['Promotions', 'promotion'],
    ['Stocktakes', 'stocktake'],
    ['StocktakeItems', 'stocktakeItem'],
    ['BoxManifests', 'boxManifest'],
    ['BoxItems', 'boxItem'],
    ['InvoiceSequences', 'invoiceSequence'],
    ['CreditNoteSequences', 'creditNoteSequence'],
    ['ReturnSequences', 'returnSequence'],
    ['SkuSequences', 'skuSequence'],
    ['BoxSequences', 'boxSequence'],
  ]
  for (const [label, key] of tables) {
    try {
      counts[label] = await (prisma as any)[key].count()
    } catch (e: any) {
      counts[label] = -1
    }
  }

  for (const [label, n] of Object.entries(counts)) {
    const marker = n < 0 ? '⚠' : ''
    console.log(`  ${label.padEnd(40)} ${String(n).padStart(8)} ${marker}`)
  }

  // User-role breakdown
  console.log('\n  ═══ User-Role Breakdown ═══')
  const roles = await prisma.user.groupBy({ by: ['role'], _count: true })
  for (const r of roles) console.log(`    ${(r.role ?? '(null)').padEnd(20)} ${String(r._count).padStart(6)}`)

  // Products without images
  const prodsNoImages = await prisma.product.count({
    where: { images: { none: {} }, deletedAt: null, isActive: true },
  })
  console.log(`\n  Active products with ZERO images: ${prodsNoImages}`)

  // Inventory rows summary
  const invSummary = await prisma.inventory.aggregate({
    _sum: { quantityOnHand: true, quantityReserved: true },
    _count: true,
  })
  console.log(`  Inventory rows: ${invSummary._count}, total onHand sum: ${Number(invSummary._sum.quantityOnHand ?? 0)}, total reserved sum: ${Number(invSummary._sum.quantityReserved ?? 0)}`)

  // Check GoBD triggers
  console.log('\n  ═══ GoBD Trigger Check ═══')
  const triggers: any[] = await prisma.$queryRaw`
    SELECT trigger_name, event_object_table, action_timing, event_manipulation
    FROM information_schema.triggers
    WHERE event_object_table IN ('invoices')
    ORDER BY trigger_name
  ` as any
  for (const t of triggers) {
    console.log(`    ${t.trigger_name.padEnd(40)} ${t.event_object_table.padEnd(10)} ${t.action_timing} ${t.event_manipulation}`)
  }
  if (triggers.length === 0) console.log('    (keine GoBD-Trigger sichtbar — oder andere Tabelle)')

  // Invoice types breakdown
  console.log('\n  ═══ Invoice Types ═══')
  const invoiceByType = await prisma.invoice.groupBy({ by: ['type'], _count: true })
  for (const i of invoiceByType) console.log(`    ${i.type.padEnd(20)} ${String(i._count).padStart(6)}`)

  // Sequences current values
  console.log('\n  ═══ Sequences (next number) ═══')
  const seqs: any[] = [
    await prisma.invoiceSequence.findMany({ select: { yearKey: true, seq: true } }),
    await prisma.creditNoteSequence.findMany({ select: { yearKey: true, seq: true } }),
    await prisma.returnSequence.findMany({ select: { yearKey: true, seq: true } }),
  ] as any
  console.log('    InvoiceSequence:', JSON.stringify(seqs[0]))
  console.log('    CreditNoteSequence:', JSON.stringify(seqs[1]))
  console.log('    ReturnSequence:', JSON.stringify(seqs[2]))

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
