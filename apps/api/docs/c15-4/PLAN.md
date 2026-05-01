# C15.4 — eBay Stock-Push Architecture Fix (Implementation Plan)

**Status:** Pre-Implementation. Phase B + Klärungspunkte 1+2 + W3-Verifikation komplett. Owner approved E-1 (Phase C+D start), E-2 (Backfill-Simplification), E-3 (Sandbox-Script archived).

**Bezug:**
- Bug-Diagnose 2026-05-01: 12 ChannelProductListings broken seit 28.04 (lastSyncedQuantity=null, 83+ failed attempts)
- Root-Cause: `externalListingId` (Public-Item-ID) wird als `offerId` an `bulk_update_price_quantity` API gesendet → eBay 500
- W3-Verifikation 2026-05-01: 12 echte offerIds aus Production gesammelt (`/tmp/c154-production-verification-result.json`)

**Hard-Rule (Owner-explicit):** ZERO TOUCH on legacy AUSSER der eine Schema-Add (additive nullable Spalte) der Bug-Fix erfordert. ADR-1 mit Kriterium 5 dokumentiert die Ausnahme.

---

## Sequenzplan (Phase E)

| Schritt | Owner-Approval-Gate | Kann ich autonom? |
|---|---|---|
| 1. C15.4.0 Schema-Commit (lokal) | ✅ vor Push | Ja, Code |
| 2. Migration apply auf Railway | ✅ vor Apply | Owner-Bestätigung |
| 3. C15.4 Code + Tests + Bootstrap-Smoke | ✅ vor Push | Ja, Code |
| 4. Diff-Review (3-Punkte-Check) | ✅ vor Push | Ja, Bericht |
| 5. Push origin/main | ✅ explizit | Owner-Bestätigung |
| 6. Backfill-Script (untracked, läuft NACH Push) | ✅ vor Run | Owner-Bestätigung |
| 7. Production-Verifikation (Cron-Tick + admin-Stoppt) | ✅ Owner-Sicht | Ja, Bericht |

---

## Schritt 1 — C15.4.0 Schema-Commit

### Schema-Änderung
```prisma
model ChannelProductListing {
  // ... existing fields unchanged ...
  externalListingId  String?   @map("external_listing_id")
  /// C15.4 — eBay Sell-API offer-id (UUID-style numeric, e.g.
  /// "158298846011"), used by bulk_update_price_quantity. Distinct
  /// from externalListingId which is the public ebay.de/itm/{X}
  /// listing-id. publishOne persists both; stock-push uses ONLY
  /// externalOfferId. Verified empirically via W3 production-probe
  /// 2026-05-01 (offerId ≠ listingId for all 12 multi-variation SKUs).
  externalOfferId    String?   @map("external_offer_id")
  // ... rest unchanged ...
}
```

### Migration SQL
```sql
-- C15.4.0 — Add externalOfferId column for stock-push correctness.
-- Pure additive: nullable, no default. Existing rows stay NULL until
-- C15.4 backfill-script populates them from the W3-verifier JSON.
-- Cron-side WHERE-clause filters NOT NULL so unmapped legacy rows
-- are silently skipped until backfilled.

ALTER TABLE "channel_product_listings"
  ADD COLUMN IF NOT EXISTS "external_offer_id" TEXT NULL;
```

**File:** `prisma/migrations/20260502_ebay_external_offer_id/migration.sql`

**Apply-Strategie:** `railway run npx prisma migrate deploy`. Tabelle ist klein (<100 rows), kein CONCURRENTLY nötig.

**Commit-Message:**
```
schema(channels): add externalOfferId for eBay stock-push (C15.4.0)

Phase 2 marketplace-integration: bug fix for stock-push feature
that has been 100% broken since C15 went live (2026-04-29). All 12
production multi-variation listings show lastSyncedQuantity=null
despite syncAttempts=83+ — root cause: externalListingId (Public
Item-ID) was used as offerId in bulk_update_price_quantity calls.

This commit adds the missing column. C15.4 main commit lands the
service-layer fix that uses it.

ADR-1 Owner-Rule-Ausnahme: ZERO-TOUCH-on-legacy ist hier
gerechtfertigt weil...
[fünf Kriterien aus Phase B copy]

Pre-fix verification: W3 production-readonly probe 2026-05-01
gathered 12 real offerIds via getOffers per SKU. JSON persisted
in /tmp/c154-production-verification-result.json (operator-only).

Hard-Rule snapshot:
  - Orders/Payments/Invoices/Returns: ZERO TOUCH
  - C5/C15/C15.1/C15.2/C15.3: ZERO TOUCH
  - Existing 1353 tests: UNANGEFASST (additive column, kein
    Verhaltens-Touch)
```

---

## Schritt 3 — C15.4 Code-Implementation

### File 1: `apps/api/src/modules/marketplaces/ebay/ebay-listing.service.ts:770`

**Änderung:** persistiere offerId zusätzlich zu listingId.

Pseudocode-Diff (~3 Zeilen) am Step-6-Success-Persistence-Block:
```diff
   await this.prisma.channelProductListing.update({
     where: { id: listingId },
     data: {
       status: 'active',
       externalListingId,
+      externalOfferId: offerId,
       syncError: null,
       lastSyncedAt: new Date(),
     },
   })
```

**Audit-Verifikation 2026-05-01:** publishOne hat genau **eine** persistierende update-Stelle (Zeile 770). Der Concurrency-Claim bei Zeile 440 ist pre-publish und touched offerId nicht. Beide Success-Branches (frischer publish via Zeile 712 + alreadyPublished-Lookup via Zeile 741-753) fließen durch dieselbe update-Stelle bei 770 — der 3-Zeilen-Diff deckt also beide Fälle automatisch ab. Andere `channelProductListing.update`-Stellen in der Datei (281, 907, 1138, 1174, 1276) liegen außerhalb publishOne (recordFail, toggleForProduct, publishProductGroup) und sind nicht im C15.4-Scope.

### File 2: `apps/api/src/modules/marketplaces/ebay/ebay-stock-push.service.ts:loadCandidateListings`

**Änderung 1:** filter on `externalOfferId NOT NULL` + `syncAttempts < MAX_PUSH_ATTEMPTS`.

Pseudocode-Diff (~6 Zeilen):
```diff
   private async loadCandidateListings(opts: {...}) {
     const where: any = {
       channel: 'ebay',
       status: 'active',
-      externalListingId: { not: null },
+      externalOfferId: { not: null },           // ← NEW: only listings with offerId
+      syncAttempts: { lt: MAX_PUSH_ATTEMPTS },  // ← NEW: skip exhausted (anti-spam)
     }
     // ... rest unchanged ...
     return this.prisma.channelProductListing.findMany({
       where,
       select: {
         id: true,
         variantId: true,
+        externalOfferId: true,    // ← NEW
         externalListingId: true,
         safetyStock: true,
         lastSyncedQuantity: true,
         syncAttempts: true,
         status: true,
         pauseReason: true,
         variant: { select: { id: true, sku: true } },
       },
       // ...
     })
   }
```

### File 3: `apps/api/src/modules/marketplaces/ebay/ebay-stock-push.service.ts:pushListings`

**Änderung 2:** push-call nutzt `externalOfferId` statt `externalListingId`.

Pseudocode-Diff (~3 Zeilen):
```diff
   for (const l of listings) {
     // ... existing skip-checks for sku/externalListingId ...
+    if (!l.externalOfferId) {
+      // Defensive: should be filtered by where-clause, but double-check.
+      skipped.push({ ..., status: 'skipped_no_offer_id' })
+      continue
+    }
     // ...
     toPush.push({
       listing: l,
       sku,
       effective,
-      offerId: l.externalListingId,    // ← BUG: was using listing-id as offer-id
+      offerId: l.externalOfferId,      // ← FIX: correct offer-id
     })
   }
```

### File 4: `apps/api/src/modules/marketplaces/ebay/ebay-listing.service.ts` — neue Methode

```ts
/**
 * C15.4 — Admin-only reset for a single eBay listing whose stock-
 * push got stuck (e.g. exhausted via MAX_PUSH_ATTEMPTS, or paused
 * manually). Resets the sync-state and flips status='active' so the
 * next cron-tick picks it up again.
 *
 * Caller must have SETTINGS_EDIT permission. Audit-row written
 * (CHANNEL_LISTING_SYNC_RESET, operational tier).
 *
 * Returns:
 *   { id, previousStatus, previousAttempts, previousSyncError,
 *     newStatus: 'active', newAttempts: 0 }
 */
async resetListingSync(listingId: string, adminId: string, ipAddress: string): Promise<...> {
  // findUnique → assert exists + channel='ebay'
  // assert status NOT in ['deleted','rejected']
  // atomic update:
  //   syncAttempts = 0
  //   syncError = null
  //   pauseReason = null
  //   status = 'active'
  //   updatedAt = now()
  // audit-row CHANNEL_LISTING_SYNC_RESET
  // return summary shape
}
```

### File 5: `apps/api/src/modules/marketplaces/ebay/ebay.controller.ts`

```ts
@Post('listings/:id/reset-sync')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermissions('SETTINGS_EDIT')
async resetSync(
  @Param('id') listingId: string,
  @Req() req: AuthRequest,
) {
  return this.listingService.resetListingSync(listingId, req.user.id, req.ip)
}
```

### File 6: `apps/api/src/modules/admin/services/audit.service.ts`

**Änderung:** Add `'CHANNEL_LISTING_SYNC_RESET'` to... wait — audit-tier-classification: this is operational (not financial), default-class is operational, so **NO change needed** to FINANCIAL_ACTIONS or EPHEMERAL_ACTIONS Sets. Audit-row will auto-classify to 'operational'.

→ ZERO TOUCH on audit.service.ts.

---

## Tests (~12 new)

| Test-File | Tests | Beschreibung |
|---|---|---|
| `ebay-listing.service.spec.ts` (extend) | +2 | (1) publishOne speichert offerId in DB. (2) resetListingSync flipped status + audit-row. |
| `ebay-stock-push.service.spec.ts` (extend) | +3 | (1) loadCandidateListings filtert exhausted listings (syncAttempts >= cap). (2) loadCandidateListings filtert null externalOfferId. (3) push-call nutzt externalOfferId statt externalListingId (assertion auf request-body). |
| `ebay-stock-push-cron.spec.ts` (extend ODER new) | +1 | Cron-Tick mit gemischtem state (8 active+ok, 4 exhausted) → exhausted nicht ge-pusht. |
| `ebay-controller.spec.ts` (extend ODER new) | +2 | (1) reset-sync requires SETTINGS_EDIT. (2) reset-sync flipped state korrekt. |
| `ebay-listing-reset-race.spec.ts` (NEW) | +2 | Race: 2 parallele reset-calls → idempotent (zweiter sieht status='active' bereits, no-op). Optional. |

**Test-Update-Disclosure:** existing `ebay-stock-push.service.spec.ts` Tests verwenden aktuell `externalListingId` als offerId-Quelle. Diese müssen Spec-Sync auf `externalOfferId` (analog C15.3 audit-service-tier.spec.ts). 3-5 existing Tests betroffen, jeweils ein-line-change. Owner-spec-konform per OQ-E (genehmigt).

---

## Risk-Bewertung pro Komponente

Bewertung nach 3 Achsen: **Blast-Radius** (was kann kaputtgehen wenn der Fix selbst falsch implementiert ist), **Reversibilität** (wie schnell rollback möglich), **Detektion** (wie schnell merkt man den Fehler).

| Komponente | Blast-Radius | Reversibilität | Detektion | Mitigation |
|---|---|---|---|---|
| **Schema-Migration (additive nullable)** | 🟢 Niedrig — column ADD ist non-destructive, keine bestehende row betroffen | 🟢 Sofort (DROP COLUMN, aber unnötig — null-safe) | 🟢 Migration-Apply-Fehler immediate | Kein Default, kein NOT NULL. Re-run safe via IF NOT EXISTS. |
| **publishOne offerId-persist** | 🟡 Mittel — falsch persistierter offerId würde sich erst bei nächstem Stock-Push zeigen | 🟢 nächster publishOne überschreibt | 🟡 Sichtbar im Cron-Log nach 15min (eBay 500 falls Wert ungültig) | Test #1 (publishOne speichert offerId) plus Test #3 (push-call nutzt persistierten Wert). Backfill nutzt verifizierte Production-Werte aus W3-JSON. |
| **loadCandidateListings WHERE-clause-Erweiterung** | 🟡 Mittel — falsch gefiltert würden listings übersprungen werden (silent stock-push gap) | 🟢 sofort — code-revert via Cherry-pick | 🟡 Sichtbar wenn cron 0 listings findet trotz aktiver Bestand-Änderungen | Test #2 (filter exhausted) + Test #3 (filter null offer-id) + Cron-Smoke-Test mit gemischtem State. |
| **pushListings offerId-Source-Switch** | 🔴 Hoch — DAS ist der eigentliche Bug-Fix-Pfad. Wenn falsch, bleibt der Fehler. | 🟢 Sofort (Cherry-pick revert auf 2 Zeilen) | 🟢 Direkt sichtbar — eBay 500 oder Quantity-Drift in Seller-Hub | Test #3 ist die zentrale Assertion. Manuelle Production-Verifikation in Schritt 7 confirms via Seller-Hub. Backfill setzt syncAttempts=0 → cron pusht alle 12 frisch. |
| **resetListingSync method (NEW)** | 🟢 Niedrig — admin-only endpoint, kein automatischer code-pfad | 🟢 Sofort (revert) | 🟢 Klare HTTP-Response, audit-row | Test #4-5 (permission + state-flip) + optional Race-Test. |
| **reset-sync endpoint (NEW)** | 🟢 Niedrig — gated by SETTINGS_EDIT | 🟢 Sofort | 🟢 HTTP 401/403 bei missing permission | Test #4 (permission-check). |
| **Backfill-Script** | 🔴 Hoch — schreibt in Production-DB, 12 listings × 2 ops | 🟡 Manuell rollback (status zurück auf 'paused') | 🟢 Sofort sichtbar via DB-query | Pre-Backfill-Validation (JSON-shape, 12 entries, all offerIds non-null). Outer $transaction für atomic-or-nothing. Idempotenz-Check (skip wenn already done). |
| **Existing 1353 tests** | 🟢 Niedrig — nur 3-5 spec-syncs (offerId-source-field) | 🟢 Sofort | 🟢 CI fail | Pre-Push-Run von gesamter Suite. |

**Gesamt-Risiko:** 🟡 Mittel.

Höchstes Restrisiko liegt bei **pushListings offerId-Source-Switch** (Bug-Fix-Pfad selbst) und **Backfill-Script** (Production-DB-Write). Beide werden durch direkte Production-Verifikation in Schritt 7 (Seller-Hub-Sicht-Check + DB-query) abgesichert.

**Was kann NICHT kaputtgehen:**
- Orders/Payments/Invoices/Returns/Refunds: Schema unangefasst, kein Code-Touch
- Bestehende publishedListings: bestehender externalListingId-Wert bleibt gültig (nur additiv ergänzt um externalOfferId)
- C15-bis-C15.3-Helpers (encryption, audit-tier, reservation-confirm): kein Touch
- Webhook-Receivers (Order-Notification, Account-Deletion): kein Touch

---

## Pre/Post-Condition-Verifikation

Pro Schritt explizite Vor- und Nachbedingungen, die ich VOR/NACH der Aktion prüfe und dokumentiere.

### Schritt 1 — Schema-Commit (lokal)

**Pre-Conditions:**
- [ ] `prisma/schema.prisma` parst clean (kein Syntax-Fehler)
- [ ] `prisma migrate diff` zeigt nur die eine ADD COLUMN (kein anderer Drift)
- [ ] `git status` zeigt nur erwartete Files (schema.prisma + migration.sql)
- [ ] Kein bestehender Code referenziert `externalOfferId` (sonst wäre's nicht additiv)

**Post-Conditions:**
- [ ] `pnpm prisma generate` läuft clean
- [ ] `pnpm typecheck` (api) passt — TypeScript-Client hat das neue Field
- [ ] Alle 1353 bestehenden Tests laufen unverändert grün (kein Verhaltens-Touch)
- [ ] Diff-Review (Schritt 4) bestätigt: 2 Files, ~26 LoC, keine anderen Touches

### Schritt 2 — Migration apply auf Railway

**Pre-Conditions:**
- [ ] Schritt 1 lokal grün
- [ ] Owner explizit approved für Apply
- [ ] `railway environment` zeigt production
- [x] **Backup-Sicherung erfüllt:** Supabase Pro Plan aktiv, Daily Auto-Backups + 7-Tage-PITR (Owner-confirmed 2026-05-01). Defense-in-Depth durch PITR abgedeckt; Restore via Supabase Dashboard binnen Minuten möglich falls unerwartete Probleme.

**Post-Conditions:**
- [ ] Migration läuft idempotent (IF NOT EXISTS)
- [ ] Direct-DB-query: `SELECT external_offer_id FROM channel_product_listings LIMIT 1` returns `NULL` für alle 12 broken listings
- [ ] Production-API restartet ohne Fehler (Sentry/Logs check)
- [ ] Cron-Tick (15min) läuft danach und filtert die 12 listings korrekt aus (where externalOfferId NOT NULL — also 0 candidates → kein Spam mehr)

### Schritt 3 — Code + Tests + Bootstrap-Smoke

**Pre-Conditions:**
- [ ] Schritt 2 in production deployed
- [ ] Migration nachweislich applied (DB-state-check)
- [ ] Lokaler `git pull` fresh

**Post-Conditions:**
- [ ] Alle ~12 neue Tests grün
- [ ] Spec-Synced existing tests (3-5) grün
- [ ] Gesamt-Suite (~1365 Tests) grün
- [ ] `pnpm typecheck` clean (api + web)
- [ ] `pnpm lint` clean
- [ ] Bootstrap-Smoke-Test: `node --enable-source-maps dist/apps/api/src/main` startet ohne DI-Resolution-Errors (analog C13.3 Hotfix-Lehre)

### Schritt 4 — Diff-Review

**Pre-Conditions:**
- [ ] Schritt 3 alle grün

**Post-Conditions:**
- [ ] 3-Punkte-Check unten erfüllt (siehe Schritt 4 Detail)
- [ ] LoC innerhalb ±20% der Schätzung (~410 LoC)
- [ ] Audit der Touched-Files zeigt: 5 erlaubte Stellen + 0 unerlaubte

### Schritt 5 — Push origin/main

**Pre-Conditions:**
- [ ] Schritt 4 Owner-approved
- [ ] `git log origin/main..HEAD` zeigt erwartete Commits
- [ ] `git diff origin/main..HEAD --stat` matcht Plan

**Post-Conditions:**
- [ ] Railway-Auto-Deploy ACTIVE grün
- [ ] Production-Logs kein Sentry-Error in den ersten 5min nach Deploy
- [ ] Stock-Push-Cron (15min nach Deploy) läuft erstes Mal mit neuem Code → erwartet **0 candidates** (weil Backfill noch nicht passiert)

### Schritt 6 — Backfill-Script

**Pre-Conditions:**
- [ ] Schritt 5 production stabil seit ≥10min
- [ ] `/tmp/c154-production-verification-result.json` existiert + ist ge-validated
- [ ] JSON enthält 12 Einträge, alle mit `ebayOfferId` non-null
- [ ] Alle 12 channelProductListingIds existieren in Production-DB
- [ ] Owner explizit approved für Run

**Post-Conditions:**
- [ ] Script-Output: 12 listings updated, 12 audit-rows written
- [ ] DB-query: alle 12 listings haben `externalOfferId IS NOT NULL` + `status='active'` + `syncAttempts=0` + `pauseReason IS NULL`
- [ ] Audit-Log enthält 12 `CHANNEL_LISTING_SYNC_RESET`-Einträge
- [ ] Re-Run des Scripts: idempotent, no-op (keine Doppel-Updates)

### Schritt 7 — Production-Verifikation

**Pre-Conditions:**
- [ ] Schritt 6 erfolgreich
- [ ] Owner wartet Cron-Tick ab (max 15min) ODER triggert manuell

**Post-Conditions (innerhalb 30min nach Backfill):**
- [ ] Alle 12 listings: `lastSyncedQuantity` populated (erwarteter Wert pro SKU = `inventory.quantityOnHand - safetyStock`)
- [ ] Alle 12 listings: `syncError IS NULL`
- [ ] Alle 12 listings: `lastSyncedAt` jünger als der Cron-Tick-Zeitpunkt
- [ ] Alle 12 listings: `status='active'`, `syncAttempts=0`
- [ ] eBay Seller Hub (Owner-Sicht): Quantities von 1-2 hochgesprungen auf erwartete Werte (3 oder höher)
- [ ] Admin-Panel: keine neuen `CHANNEL_LISTING_SYNC_FAILED`-Notifications mehr
- [ ] Sentry: 0 neue Errors aus `EbayStockPushService`

**Bei Fehler in Post-Verifikation — Rollback-Plan (~5-7 Min worst case):**

Vorbereitet VOR Schritt 6 (Pre-Mortem-Pattern aus C15.2-Hotfix-Lehre):
- Rollback-Script `apps/api/scripts/c15-4-rollback.ts` (untracked) liegt bereit, setzt status='paused', externalOfferId=null, syncAttempts=0 für die 12 listings via outer-$transaction + audit-row `CHANNEL_LISTING_SYNC_ROLLBACK`
- Commit-IDs der C15.4.0 + C15.4-Commits notiert für ggf. `git revert`

Ausführungs-Verantwortung (Owner-Spec 2026-05-01):
- Go/No-Go: Owner
- Technische Ausführung: **Owner führt Rollback selbst aus** unter eigener Aufsicht
- Meine Aufgabe: `apps/api/docs/c15-4/rollback-runbook.md` mit exakten copy-paste-fertigen Befehlen vorbereiten (Pre-Mortem VOR Schritt 6)
- Bei Unsicherheit: STOP und Owner fragen

Runbook-Inhalt (rollback-runbook.md, vor Schritt 6 bereit):
1. Backfill-revert SQL (oder Rollback-Script-Path) (~10 Sek) — direkt ausführbarer Block
2. `git revert <C15.4-commit-hash>` + push (~1 Min) — exakter Commit-Hash eingetragen
3. Railway-Auto-Deploy nach revert-push (~3-5 Min) — automatisch
4. Optional: Schema-Migration revert via DROP COLUMN (~10 Sek, nur falls Owner explizit will; additive Spalte ist harmlos, kann bleiben)

Schema-Column bleibt by default (additive, kein Drop nötig, keine bestehenden Code-Pfade lesen sie nach Code-Revert).

---

## Schritt 4 — Diff-Review (3-Punkte-Check)

Vor Push prüfe ich:

**(a) Bestätigung: ZERO TOUCH außer 5 erlaubten Stellen:**
- ✅ schema.prisma (1 Spalte additiv)
- ✅ migration SQL (additive ALTER TABLE)
- ✅ ebay-listing.service.ts (publishOne offerId-persist + neue resetListingSync method)
- ✅ ebay-stock-push.service.ts (loadCandidateListings + push-call)
- ✅ ebay.controller.ts (1 neuer endpoint)
- KEIN Touch auf: Orders/Payments/Invoices/Returns/Refunds/C5/C15/C15.1/C15.2/C15.3/Webhook-receivers

**(b) Bestätigung: Variante-B Atomic-Claim NOT applicable here** (kein race-prone code-pfad, this is plain UPDATE with status-guard at controller-level).

**(c) Bestätigung: Existing test-bruchs limited to specs that pin the directly-modified offerId-source field** (~3-5 tests, all in ebay-stock-push spec).

---

## Schritt 5 — Push origin/main

C15.4.0 Schema-Commit zuerst, C15.4 Code-Commit zweite (analog C15.0/C15 Pattern, C15.1.0/C15.1 Pattern, C15.3 single-commit Pattern).

---

## Schritt 6 — Backfill-Script (E-2 Vereinfachung)

**File:** `apps/api/scripts/c15-4-backfill-from-verification.ts` (untracked)

**Logik:**
```ts
// Read /tmp/c154-production-verification-result.json
// For each entry:
//   prisma.$transaction([
//     channelProductListing.update({
//       where: { id: entry.channelProductListingId },
//       data: {
//         externalOfferId: entry.ebayOfferId,
//         syncAttempts: 0,
//         status: 'active',
//         pauseReason: null,
//         syncError: null,
//         lastSyncedQuantity: null,  // forciert Re-Push
//       },
//     }),
//     adminAuditLog.create({
//       data: {
//         adminId: 'system',
//         action: 'CHANNEL_LISTING_SYNC_RESET',
//         entityType: 'channel_product_listing',
//         entityId: entry.channelProductListingId,
//         changes: {
//           before: { status: 'paused', pauseReason: 'manual_pending_c154_fix', externalOfferId: null, syncAttempts: <prev> },
//           after: { status: 'active', externalOfferId: <newId>, syncAttempts: 0 },
//         },
//         ipAddress: null,
//       },
//     }),
//   ])
//
// Total: alle 12 in EINER outer-transaction (Owner-Spec 2026-05-01,
//   NICHT optional). Atomicity: alle 12 oder keine. Re-Run-Idempotenz
//   einfacher zu reasonen (alle backfilled ODER keiner). Konsistenz
//   mit C15-onPersistError-Pattern. Worst-case Recovery: bei Fehler in
//   Entry-N rollen N-1 vorherige mit zurück, kein partieller Zustand.
//
//   await prisma.$transaction(async (tx) => {
//     for (const entry of entries) {
//       await tx.channelProductListing.update({...})
//       await tx.adminAuditLog.create({...})
//     }
//   })
```

**Audit-Action:** `CHANNEL_LISTING_SYNC_RESET` — operational tier (default).

**Pre-Backfill-Validation:**
- Check `/tmp/c154-production-verification-result.json` exists + valid JSON
- Check 12 entries
- Check each entry has `ebayOfferId !== null`

**Idempotenz:**
- Re-Run nach erfolgreichem Run findet rows mit `externalOfferId` schon gesetzt + status='active'
- Optional: Pre-check `if (row.externalOfferId === entry.ebayOfferId && row.status === 'active') skip`

---

## Schritt 7 — Production-Verifikation

Nach Backfill:
1. **Cron-Tick auslösen** — eine der zwei Optionen (Owner wählt):
   - **C1 Stop-Watch:** Owner wartet 16min auf nächsten autonomen `@SafeCron('*/15 * * * *')`-Tick. Kein Code-Touch nötig.
   - **C2 Smoke-Script (untracked):** `apps/api/scripts/c15-4-trigger-reconcile-once.ts` — bootet Nest standalone-context, ruft `EbayStockReconcileService.runReconcileTick()` direkt. ~30 LoC, untracked, kein Tests-Touch. Verifikation in <30 Sek statt 15min. Pattern analog `smoke-pull-cron-once.ts` (C12.7-Lehre). Audit-Note: Q-A 2026-05-01 confirmed kein Admin-Endpoint existent — Smoke-Script ist die einzige nicht-Wartezeit-Option ohne C15.4-Scope-Aufweichung.
2. Verification-Script: re-query alle 12 listings, expected:
   - `lastSyncedQuantity` populated (3 für alle 12)
   - `syncError: null`
   - `lastSyncedAt` recent (< 15min)
   - `status: 'active'`
3. eBay Seller Hub: Owner prüft visuell dass Quantities von 1-2 auf 3 hochgesprungen sind

Bei Erfolg → C15.4 done.

---

## Hard-Rule-Compliance Snapshot

| Rule | Status |
|---|---|
| Orders/Payments/Invoices/Returns/Refunds: ZERO TOUCH | ✅ |
| C5/C15/C15.1/C15.2/C15.3 helpers + crons: ZERO TOUCH | ✅ |
| Webhook-receivers: ZERO TOUCH | ✅ |
| Existing 1353 tests: UNANGEFASST außer Spec-Sync für ~3-5 directly-modified Tests | ✅ (genehmigt OQ-E) |
| `orders.service.ts:1011` Fallback path: ZERO TOUCH | ✅ |
| Schema-Touch: 1 additive nullable column (ADR-1 Kriterium 5 dokumentiert) | ✅ |

---

## Future Work (nicht in C15.4-Scope)

Reminder für Commit-Message:

```
Architektur-Beobachtungen (zu adressieren post-launch, Naming TBD vom Owner):

1. Event-Driven Channel Sync statt Polling-Cron
2. Smart Batching mit Dirty-Flag
3. Rate-Limit-Aware Pushing
4. Per-Channel Adapter Pattern

Trigger zur Implementierung: ab ~300 aktive Listings pro Channel
ODER ab erstem Rate-Limit-Audit-Event post-launch.
```

---

## LoC-Schätzung

| Component | LoC |
|---|---|
| Schema-migration | ~25 |
| publishOne offerId-persist | +3 |
| loadCandidateListings + push-call | +9 / -2 |
| resetListingSync method | +50 |
| reset-sync endpoint | +20 |
| 4 test-suites (~10 new tests + 3-5 spec-syncs) | ~300 |
| Backfill-Script (untracked) | ~120 |
| **Total in commit** | ~410 LoC |

(Vorher geschätzt ~570 LoC. Reduktion durch E-2: kein eBay-API-Call im Backfill mehr nötig.)

---

## Wartet auf Owner-Approval

Vor Schritt 1 (Schema-Commit lokal):
- Plan-Markdown-Review
- Bei Approval → Schema-Migration schreiben + apply auf Railway

**Approval-Modus (per Owner-Spec):** Schritt-für-Schritt, NICHT als Block. Pro Schritt eigenes Approval-Gate; ich pausiere nach jedem Schritt und berichte Pre/Post-Conditions, bevor der nächste startet.
