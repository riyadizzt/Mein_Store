# C15.6 — Rollback Runbook

**Status:** UNTRACKED ops-only document. Copy-paste-fertige Befehle für Notfall-Recovery wenn C15.6 (Workaround für `bulk_update_price_quantity`) unerwartete States erzeugt.

**Erstellt:** 2026-05-02
**Owner-Rolle:** Owner führt Rollback aus, ich (Claude) berate + bereite SQL/Befehle vor.

---

## 1. When to Rollback

### Hard Triggers (sofort rollback ohne weitere Diskussion)

| Trigger | Symptom | Wo erkennbar |
|---|---|---|
| **HTTP 500 / 4xx auf alle 3 Strategies** | All-strategies-degraded state | HealthService `isAllDegraded() === true` ODER Audit-Log `CHANNEL_LISTING_BULK_PAUSED_FALLBACK` |
| **Bootstrap-Smoke fail post-deploy** | NestFactory.createApplicationContext crashed (z.B. neue 6 Services nicht resolvable) | `pnpm exec ts-node scripts/smoke-bootstrap.ts` exit ≠ 0 |
| **Snapshot-Verifier dataLossDetected (v2)** | PRESERVE_FIELDS verändert nach PUT (title/description/aspects/imageUrls/condition/groupIds) | Audit-log `CHANNEL_LISTING_DATA_DRIFT_DETECTED` rows |
| **DB-inconsistency** | listings status='active' aber lastSyncedQuantity=null nach Selector-Run | DB query (siehe Verifikation unten) |
| **Sentry-Error-Spike** | >5 Errors/min aus EbayStockPushService oder neue Strategy-Services | Sentry dashboard |
| **eBay state drift > 5%** | Mehr als 1 von 23 listings hat eBay-quantity ≠ DB-quantity ODER Listing-Felder verschwunden auf eBay-side | `scripts/c15-5-verify-ebay-state.ts` + Owner-Sicht Seller-Hub |
| **Multi-Variation Group Drift (v2)** | inventory_item.groupIds wurde durch PUT geclearet → SKU aus Listing entfernt | `GET /sell/inventory/v1/inventory_item/{sku}` zeigt groupIds=[] obwohl pre-PUT noch enthalten |

### Soft Triggers (Owner-Konsultation, nicht automatisch)

| Trigger | Symptom | Empfehlung |
|---|---|---|
| **Performance-degradation** | Reconcile-tick durationMs > 35000 (v3 Strategy B + Lock-Overhead = ~5 calls/SKU) | Owner entscheidet: bleiben (Cron alle 15min) oder rollback |
| **Rate-limit (429)** | 429 in >50% der Calls | Optional: 100ms-sleep-zwischen-PUTs als Code-Patch (kein Rollback) |
| **eBay-Support fixt bulk-Endpoint** | Support-Email bestätigt errorId 25001 behoben | **v3: Auto-Recovery via Cool-Down-Ladder!** Probe nach Cool-Down-Expiry + 2-consecutive-success → bulk restored. **KEIN Code-Rollback nötig, KEIN Container-Restart nötig.** |
| **1 Strategy degraded, andere healthy** | HealthService Redis zeigt 1 strategy.isHealthy=false, andere=true | KEIN Rollback — System self-healing arbeitet wie designed |
| **Redis-Outage** | log.warn "Redis unavailable, falling back to in-memory" | **KEIN Rollback** — Service läuft weiter via in-memory-fallback. Redis-Recovery automatic via TTL. Monitor Upstash status. |
| **Recovery-Probe falscher Restore** | Strategy restored nach 2-consecutive-success, aber production-calls failen wieder | **HARD-TRIGGER** (kein Rollback nötig wenn rapid re-degrade nach 3 production-fails — dauert ~45min Auto-Re-Degrade). Bei Persistent-Drift: Owner-Konsultation. |

### Documentation-Triggers (kein Rollback, nur Note)

- Nicht-blockende Warnings im Audit-Log
- Einzelne SKU-Failures (rateLimited oder transient) — bestehender retry-pattern handled das

---

## 2. Rollback Steps (chronologisch)

### Step 1 — Identify the C15.6 Commit

```bash
cd /Users/riyadizzt/Desktop/Malak_Be_pro/omnichannel-store
git log origin/main --oneline -10 | grep -E "C15\.6|workaround|inventory_item"
# Erwartete output: <hash> fix(ebay): C15.6 per-SKU PUT workaround for bulk_update_price_quantity
```

**Notiere den Commit-Hash** für Step 2.

### Step 2 — Git Revert + Push

```bash
# Identifizierten Commit revert (creates inverse-commit, kein force-push)
git revert <C15.6-commit-hash> --no-edit

# Verify revert-commit looks correct (sollte +bulk_update_price_quantity, -PUT-loop zeigen)
git show HEAD --stat

# Push revert to origin/main
git push origin main
```

**Erwartung:** Railway-Auto-Deploy startet automatisch (~50-90s).

### Step 3 — Re-Pause die unpaused Listings

Falls Phase 5 (Unpause) bereits ausgeführt war: alle 23 listings müssen zurück zu `status='paused'` damit der old-bulk-code (post-revert) sie nicht versucht zu pushen + errorId 25001 erneut triggert.

**Atomic Re-Pause SQL:**

```bash
railway run --service=Mein_Store node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const ids = [
  // 12 ursprüngliche Schuhe-listings (paused since 2026-05-01)
  '1ed8dd45-5c8d-45eb-b92b-e3aeb2332a90', '6db5d76b-e50a-4df1-a460-146ed4ab4aee',
  '2b955ca0-abcb-4b65-b25f-d4113a96bb23', '4eca8b86-7268-4a0a-ae64-74e3bc330678',
  'd59ec4d6-0fa7-4d5b-9657-3285876ba08b', '7d9c22e2-4cd3-409d-9257-c518606aee80',
  'b07f0b2c-2c13-4afb-8206-087459ac4fc2', '82efaa2f-676b-4efe-a5f9-d7dfa951623b',
  '7a897800-0e11-42cd-af73-b2dfacb6453a', '851bdaa2-7bb6-491b-a91e-5246d89daf25',
  '53a03a87-2da7-4f84-ae80-5fbcece68e1d', '3d7d408e-6206-4967-b787-08233a9582ca',
  // SCH-40 standalone + 10 T-Shirt variants — IDs aus Phase A1 + Pause-Script holen
  // (run scripts/c15-5-verify-state.ts to get the full list)
];
(async () => {
  await p.\$transaction(async (tx) => {
    for (const id of ids) {
      await tx.channelProductListing.update({
        where: { id },
        data: {
          status: 'paused',
          pauseReason: 'c156_rollback_to_bulk_endpoint',
          pausedAt: new Date(),
        },
      });
      await tx.adminAuditLog.create({
        data: {
          adminId: 'system',
          action: 'CHANNEL_LISTING_PAUSED_MANUAL',
          entityType: 'channel_product_listing',
          entityId: id,
          ipAddress: null,
          changes: {
            source: 'c15-6-rollback-runbook',
            reason: 'C15.6 workaround rolled back, returning to bulk_update_price_quantity (which is broken — re-pause prevents spam)',
          },
        },
      });
    }
  });
  console.log('Re-paused', ids.length, 'listings');
  await p.\$disconnect();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
"
```

### Step 4 — Verify Rollback State

```bash
# Verify Railway redeploy completed
railway logs --service=Mein_Store | grep -E "Nest application successfully started" | tail -2

# Verify code revert is live (check production-deployed bulk_update_price_quantity exists)
railway logs --service=Mein_Store | grep "ebay-stock-push" | tail -5
# Expected: log lines mentioning bulk_update_price_quantity if cron ran

# Verify all 23 listings paused
railway run --service=Mein_Store node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const counts = await p.channelProductListing.groupBy({
    by: ['status', 'pauseReason'],
    where: { channel: 'ebay' },
    _count: true,
  });
  console.log(JSON.stringify(counts, null, 2));
  await p.\$disconnect();
})();
"
# Expected: status=paused for all 23 listings

# Verify smoke-trigger findet 0 candidates
railway run --service=Mein_Store pnpm exec ts-node --transpile-only \
  scripts/c15-4-trigger-reconcile-once.ts
# Expected: scanned=0, pushed=0, failed=0
```

### Step 5 — Incident Postmortem

**Document in `apps/api/docs/c15-6/incidents/<YYYY-MM-DD>-rollback.md`:**

```markdown
# C15.6 Rollback Incident — <date>

## Trigger
- Welcher Hard/Soft-Trigger ausgelöst hat
- Symptom-Snapshot (Sentry-Errors-Count, fail-rate, etc.)

## Timeline
- HH:MM Deploy
- HH:MM Issue detected
- HH:MM Rollback initiated
- HH:MM Re-pause complete
- HH:MM State verified

## Root Cause Hypothesis
- Was vermutet ist (PUT-Endpoint-Bug, Code-Bug, Config-Issue)
- Evidence pro Hypothese

## Lessons Learned
- Was C15.6 Plan-Risk-Assessment richtig vorhergesagt hat
- Was nicht im Risk-Assessment war
- Plan-Adjustment für nächsten Versuch

## Next Steps
- eBay-Support-Update? (DTSupport@ebay.com)
- Plan für C15.6 v2 (z.B. Variante-2 mit 2 PUTs falls Variante-1 Issue)
- Welche listings bleiben wie lange paused
```

---

## 3. Emergency Contacts

### eBay Developer Support
- **Email:** `DTSupport@ebay.com`
- **Reference:** Email gesendet 2026-05-02 zu errorId 25001 auf bulk_update_price_quantity
- **Updates:** Owner monitort Eingangsantwort, leitet Owner-relevante Updates an Claude weiter

### Eskalations-Reihenfolge bei Production-Incident

1. **Owner stoppt** sofort wenn Hard-Trigger erkannt
2. **Re-Pause aller listings** (Step 3) — stoppt Spam, kein Daten-Verlust
3. **Owner führt git revert** (Step 2) ODER konsultiert Claude für Approval
4. **Verify state clean** (Step 4)
5. **Postmortem write-up** (Step 5) bei nächster ruhiger Zeit

---

## 4. Verification Commands

### Verify Rollback Successful (Code-State)

```bash
cd /Users/riyadizzt/Desktop/Malak_Be_pro/omnichannel-store

# Verify revert-commit ist HEAD
git log origin/main --oneline -3
# Expected line 1: <hash> Revert "fix(ebay): C15.6 per-SKU PUT workaround..."

# Verify code zeigt bulk_update_price_quantity (NICHT inventory_item PUT-loop)
git show origin/main:apps/api/src/modules/marketplaces/ebay/ebay-stock-push.service.ts | grep -c "bulk_update_price_quantity"
# Expected: ≥1 (alter Code wieder live)

git show origin/main:apps/api/src/modules/marketplaces/ebay/ebay-stock-push.service.ts | grep -c "PUT.*inventory_item"
# Expected: 0 (kein PUT-loop)
```

### Verify Rollback Successful (Production-State)

```bash
# 1. Service läuft
railway logs --service=Mein_Store | grep "Nest application successfully started" | tail -2

# 2. Cron filter findet 0 candidates (alle paused)
railway run --service=Mein_Store node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const active = await p.channelProductListing.count({
    where: { channel: 'ebay', status: 'active', externalOfferId: { not: null }, syncAttempts: { lt: 5 } }
  });
  console.log('active candidates for cron:', active);
  console.log('expected: 0 (alle paused)');
  await p.\$disconnect();
})();
"

# 3. Verify state via existing tool
railway run --service=Mein_Store pnpm exec ts-node --transpile-only \
  scripts/c15-5-verify-state.ts
# Expected output: alle 23 listings ⏸ paused
```

### Verify No Spam in Logs

```bash
# Sentry: 0 new Errors out of EbayStockPushService in last 30min
# (Owner manuell via Sentry-Dashboard)

# Railway: keine [ebay-stock-push] FAIL lines nach Rollback-Deploy
railway logs --service=Mein_Store | grep -E "\[ebay-stock-push\] FAIL|EXHAUSTED" | tail -5
# Expected: keine Lines neuer als Rollback-deploy-Timestamp
```

### Redis-Health-State Inspection (v3)

```bash
# Direct Redis inspection (Upstash CLI oder via railway run with redis-cli installed):
redis-cli GET ebay:strategy-health:bulk-update
redis-cli GET ebay:strategy-health:get-then-put
# Expected JSON:
# { "failures": 0, "lastFailureAt": null, "isHealthy": true, "cooldownUntil": null,
#   "degradeCount24h": 0, "probeSuccessCount": 0 }

# Per-SKU lock inspection (during active cron-tick or post-mortem):
redis-cli KEYS 'ebay:lock:sku:*'
# Expected during tick: 0-1 keys (sequential per-SKU lock-acquire-release)
# Expected post-tick: 0 keys (alle released, oder TTL expired innerhalb 30s)

# TTL check für health keys:
redis-cli TTL ebay:strategy-health:bulk-update
# Expected: 0..86400 (24h auto-cleanup), -1 if no TTL (= bug), -2 if key absent
```

### Health-State-Reset (manuelle Owner-Aktion)

Wenn Owner glaubt eBay-Side ist gefixt + manuelles Restore wollen statt warten auf Cool-Down:

```bash
# Reset bulk-strategy via admin endpoint (falls implementiert):
curl -X POST https://api.malak/admin/marketplaces/ebay/health/reset \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"strategy":"bulk"}'

# ODER direct Redis (last-resort):
redis-cli DEL ebay:strategy-health:bulk-update
# Next cron-tick wird default healthy-state re-erstellen + bulk als primary versuchen
```

### Smoke-Test Final-Health

```bash
# Smoke-Trigger nach Rollback
railway run --service=Mein_Store pnpm exec ts-node --transpile-only \
  scripts/c15-4-trigger-reconcile-once.ts

# Expected JSON output:
# {
#   "scanned": 0,
#   "pushed": 0,
#   "skipped": 0,
#   "failed": 0,
#   "rateLimited": false,
#   "items": []
# }
```

---

## What Cannot Be Rolled Back

- Audit-trail: alle CHANNEL_LISTING_*-Audit-Rows aus C15.6-Phase-5-Unpause + dieses Rollback-Re-Pause bleiben für GoBD-trail erhalten
- eBay-side mutations: falls C15.6 erfolgreich gepusht hat (z.B. quantity 23 → 3), und dann rollback kommt, ist die quantity auf eBay weiterhin 3 (rollback macht eBay-state nicht rückgängig)
- Sentry events / Railway logs

**Goldene Regel:** Re-Pause SQL-Block hat `BEGIN;` ... verify-query ... `COMMIT;` Pattern (analog C15.5 Rollback-Runbook). Im Zweifel `ROLLBACK;` und Owner-Konsultation.

---

## Quick-Reference Cheat-Sheet

```bash
# Total rollback (~5 min):
git revert <C15.6-hash> --no-edit && git push origin main
# Wait for Railway-Auto-Deploy (~50-90s)
# Re-Pause via Step 3 SQL-Block
# Verify via Step 4 commands
# Smoke-trigger to confirm scanned=0
# Postmortem write-up in incidents/ folder
```

**Eskalations-Kontakt:** Owner führt aus, Claude berät bei SQL-Verifikation BEFORE `COMMIT;`.

---

**End of C15.6 rollback-runbook.md**
