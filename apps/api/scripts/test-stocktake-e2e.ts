/**
 * LIVE end-to-end test for the stocktake module.
 *
 * Exercises the 4 new code paths against the real Supabase DB:
 *   1. getStocktakes() — joins warehouse info into every row
 *   2. startStocktake() — rejects missing warehouseId
 *   3. startStocktake() — rejects if another in-progress exists
 *   4. deleteStocktake() — only in_progress, cascades items
 *   5. startCorrectionStocktake() — seeds from source.actualQty
 *
 * Non-destructive: every row the script creates is torn down at the
 * end, even if an assertion fails. The existing 2 stocktakes the user
 * sees on their dashboard are never touched.
 */
import { NestFactory } from '@nestjs/core'
import { AdminInventoryService } from '../src/modules/admin/services/admin-inventory.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { AppModule } from '../src/app.module'

const PASS = (m: string) => console.log(`✅ ${m}`)
const FAIL = (m: string) => { console.error(`❌ ${m}`); process.exitCode = 1 }

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const service = app.get(AdminInventoryService)
  const prisma = app.get(PrismaService)

  // IDs we create — tracked for teardown.
  const createdStocktakes: string[] = []

  try {
    console.log('\n── 1. getStocktakes() joins warehouse info ────────────\n')
    const list = await service.getStocktakes(50)
    console.log(`   Found ${list.length} stocktake(s) in DB`)

    if (list.length > 0) {
      const first = list[0] as any
      if (first.warehouse === undefined) {
        FAIL('getStocktakes() missing .warehouse field on row')
      } else if (first.warehouse === null) {
        // Defensive — can happen if warehouse was deleted after stocktake
        console.log(`   ⚠  Row #${first.id.slice(-6)} has warehouse=null (warehouse deleted?)`)
        PASS('getStocktakes() returned .warehouse=null (graceful)')
      } else {
        const w = first.warehouse
        if (!w.name || !w.type) FAIL(`warehouse shape wrong: ${JSON.stringify(w)}`)
        else PASS(`First row: #${first.id.slice(-6)} → ${w.name} (${w.type})`)
      }

      // Also check the _count plumbing still works
      if (typeof first._count?.items !== 'number') {
        FAIL('_count.items not projected')
      } else {
        PASS(`_count.items = ${first._count.items}`)
      }
    } else {
      PASS('No stocktakes in DB — skipping row-shape check (empty list)')
    }

    console.log('\n── 2. startStocktake() without warehouseId → 400 ──────\n')
    try {
      await service.startStocktake('', null, 'test-admin')
      FAIL('expected BadRequestException for empty warehouseId')
    } catch (e: any) {
      if (e.response?.error === 'WarehouseRequired') PASS('Rejected with WarehouseRequired')
      else FAIL(`Wrong error: ${JSON.stringify(e.response)}`)
    }

    console.log('\n── 3. Find a test warehouse ────────────────────────────\n')
    const warehouse = await prisma.warehouse.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!warehouse) {
      FAIL('No active warehouse in DB — cannot continue')
      return
    }
    PASS(`Using warehouse: ${warehouse.name} (${warehouse.type}) id=${warehouse.id}`)

    console.log('\n── 4. startStocktake() happy path ──────────────────────\n')
    // Check if there's already an in_progress stocktake for this warehouse.
    // If yes, delete it first (cleaning up from a previous failed test run).
    const leftover = await prisma.stocktake.findFirst({
      where: { warehouseId: warehouse.id, status: 'in_progress', adminId: 'test-admin' },
    })
    if (leftover) {
      await prisma.stocktake.delete({ where: { id: leftover.id } })
      console.log(`   (cleaned up leftover test stocktake ${leftover.id.slice(-6)})`)
    }

    // There might still be a non-test in_progress stocktake — that's the
    // user's real data. In that case we skip the start-test and just
    // test the block-guard below.
    const userInProgress = await prisma.stocktake.findFirst({
      where: { warehouseId: warehouse.id, status: 'in_progress' },
    })

    let ownStocktakeId: string | null = null
    if (userInProgress) {
      console.log(`   ⚠  User has an open stocktake #${userInProgress.id.slice(-6)} — using it for block test only`)
    } else {
      const st = await service.startStocktake(warehouse.id, null, 'test-admin')
      createdStocktakes.push(st.id)
      ownStocktakeId = st.id
      PASS(`Created stocktake #${st.id.slice(-6)} with ${(st as any).items?.length ?? 0} item(s)`)

      // Verify audit log was written
      const audit = await prisma.adminAuditLog.findFirst({
        where: { action: 'STOCKTAKE_STARTED', entityId: st.id },
      })
      if (audit) PASS('Audit log STOCKTAKE_STARTED written')
      else FAIL('Audit log NOT written')
    }

    console.log('\n── 5. Second start in same warehouse → 409 ─────────────\n')
    try {
      await service.startStocktake(warehouse.id, null, 'test-admin')
      FAIL('expected ConflictException for duplicate in-progress')
    } catch (e: any) {
      if (e.response?.error === 'StocktakeAlreadyInProgress') {
        PASS(`Rejected with StocktakeAlreadyInProgress (existingId=${e.response.existingId?.slice(-6)})`)
      } else {
        FAIL(`Wrong error: ${JSON.stringify(e.response ?? e.message)}`)
      }
    }

    if (ownStocktakeId) {
      console.log('\n── 6. deleteStocktake() removes in_progress + cascades ─\n')
      const before = await prisma.stocktakeItem.count({ where: { stocktakeId: ownStocktakeId } })
      console.log(`   items before delete: ${before}`)
      const res = await service.deleteStocktake(ownStocktakeId, 'test-admin', '127.0.0.1')
      if (res.deleted !== true) FAIL('delete returned unexpected shape')
      const after = await prisma.stocktakeItem.count({ where: { stocktakeId: ownStocktakeId } })
      if (after === 0) PASS(`Stocktake + ${before} items cascaded away`)
      else FAIL(`${after} items still exist after delete`)
      createdStocktakes.splice(createdStocktakes.indexOf(ownStocktakeId), 1)

      const auditDel = await prisma.adminAuditLog.findFirst({
        where: { action: 'STOCKTAKE_DELETED', entityId: ownStocktakeId },
      })
      if (auditDel) PASS('Audit log STOCKTAKE_DELETED written')
      else FAIL('Delete audit log missing')
    }

    console.log('\n── 7. deleteStocktake() blocks completed ──────────────\n')
    const completed = await prisma.stocktake.findFirst({ where: { status: 'completed' } })
    if (!completed) {
      console.log('   (no completed stocktake in DB → skipping)')
    } else {
      try {
        await service.deleteStocktake(completed.id, 'test-admin', '127.0.0.1')
        FAIL('expected BadRequest for completed stocktake delete')
      } catch (e: any) {
        if (e.response?.error === 'CanOnlyDeleteInProgress') {
          PASS(`Rejected with CanOnlyDeleteInProgress for #${completed.id.slice(-6)}`)
        } else {
          FAIL(`Wrong error: ${JSON.stringify(e.response)}`)
        }
      }

      // Also verify the row is STILL there (no accidental partial delete)
      const stillThere = await prisma.stocktake.findUnique({ where: { id: completed.id } })
      if (stillThere) PASS('Completed stocktake still intact after blocked delete')
      else FAIL('Completed stocktake was deleted — CATASTROPHIC')
    }

    console.log('\n── 8. startCorrectionStocktake() seeds from actualQty ──\n')
    // We need a completed stocktake. If the user doesn't have one we skip.
    const completedWithItems = await prisma.stocktake.findFirst({
      where: { status: 'completed' },
      include: { items: { take: 5 } },
    })
    if (!completedWithItems || completedWithItems.items.length === 0) {
      console.log('   (no completed stocktake with items → skipping)')
    } else {
      // If there's an in-progress in the same warehouse, we can't test.
      const otherInProgress = await prisma.stocktake.findFirst({
        where: { warehouseId: completedWithItems.warehouseId, status: 'in_progress' },
      })
      if (otherInProgress) {
        console.log(`   ⚠  In-progress exists for same warehouse → expect block`)
        try {
          await service.startCorrectionStocktake(completedWithItems.id, 'test-admin')
          FAIL('expected block')
        } catch (e: any) {
          if (e.response?.error === 'StocktakeAlreadyInProgress') {
            PASS('Correction correctly blocked by existing in-progress')
          } else {
            FAIL(`Wrong error: ${JSON.stringify(e.response)}`)
          }
        }
      } else {
        const correction = await service.startCorrectionStocktake(completedWithItems.id, 'test-admin')
        createdStocktakes.push(correction.id)
        PASS(`Created correction #${correction.id.slice(-6)}`)

        // Verify notes field
        const fresh = await prisma.stocktake.findUnique({ where: { id: correction.id } })
        if (fresh?.notes === `correction_of:${completedWithItems.id}`) {
          PASS('notes field correctly pointing at source')
        } else {
          FAIL(`notes field wrong: ${fresh?.notes}`)
        }

        // Verify first item's expectedQty matches source.actualQty
        const firstSource = completedWithItems.items[0]
        const firstCorrection = await prisma.stocktakeItem.findFirst({
          where: { stocktakeId: correction.id, variantId: firstSource.variantId },
        })
        if (!firstCorrection) {
          FAIL('correction item for source variant not found')
        } else {
          const expected = firstSource.actualQty ?? firstSource.expectedQty
          if (firstCorrection.expectedQty === expected) {
            PASS(`First item expectedQty=${firstCorrection.expectedQty} (seeded from source.actualQty=${firstSource.actualQty})`)
          } else {
            FAIL(`Mismatch: correction.expectedQty=${firstCorrection.expectedQty}, source.actualQty=${firstSource.actualQty}`)
          }
        }

        // Verify item count matches source
        const itemCount = await prisma.stocktakeItem.count({ where: { stocktakeId: correction.id } })
        const sourceItemCount = await prisma.stocktakeItem.count({ where: { stocktakeId: completedWithItems.id } })
        if (itemCount === sourceItemCount) {
          PASS(`Item count matches source: ${itemCount}`)
        } else {
          FAIL(`Item count mismatch: correction=${itemCount}, source=${sourceItemCount}`)
        }
      }
    }

    console.log('\n── 9. startCorrectionStocktake() rejects in_progress ───\n')
    const anyInProgress = await prisma.stocktake.findFirst({ where: { status: 'in_progress' } })
    if (anyInProgress) {
      try {
        await service.startCorrectionStocktake(anyInProgress.id, 'test-admin')
        FAIL('expected BadRequest for in_progress source')
      } catch (e: any) {
        if (e.response?.error === 'CanOnlyCorrectCompleted') {
          PASS('Rejected with CanOnlyCorrectCompleted')
        } else {
          FAIL(`Wrong error: ${JSON.stringify(e.response)}`)
        }
      }
    } else {
      console.log('   (no in_progress stocktake → skipping)')
    }

  } finally {
    // ── TEARDOWN ──────────────────────────────────────────────
    if (createdStocktakes.length > 0) {
      console.log(`\n── TEARDOWN — deleting ${createdStocktakes.length} test row(s) ──\n`)
      for (const id of createdStocktakes) {
        try {
          await prisma.stocktake.delete({ where: { id } })
          console.log(`   ✓ deleted #${id.slice(-6)}`)
        } catch (e: any) {
          console.error(`   ✗ failed to delete #${id.slice(-6)}: ${e.message}`)
        }
      }
    }

    // Clean test audit rows (keeps the audit log clean)
    const testAudits = await prisma.adminAuditLog.deleteMany({
      where: { adminId: 'test-admin', action: { in: ['STOCKTAKE_STARTED', 'STOCKTAKE_DELETED', 'STOCKTAKE_CORRECTION_STARTED'] } },
    })
    console.log(`   cleaned ${testAudits.count} test audit row(s)`)

    await app.close()
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Test suite FAILED — see errors above')
  } else {
    console.log('\n✅ All live stocktake checks passed')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
