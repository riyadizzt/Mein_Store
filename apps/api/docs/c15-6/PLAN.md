# C15.6 — Workaround for eBay `bulk_update_price_quantity` Endpoint-Bug

**Status:** Phase-1-Plan (pre-implementation). 0 Service-Code-Touch in dieser Phase.

**Erstellt:** 2026-05-02

---

## 1. Executive Summary

### Problem
eBay's `POST /sell/inventory/v1/bulk_update_price_quantity` Endpoint antwortet seit ≥4 Tagen konsistent mit **HTTP 500 + errorId 25001 (System / API_INVENTORY)** für unsere 23 listings. C15.5 Diagnose hat das empirisch via Q3-Probe verifiziert. Owner-Befund: Account-Status ist gesund (Listing 406893266945 ACTIVE in Seller Hub) — Issue ist endpoint-spezifisch, nicht account-restriction.

### Lösung
**Workaround:** Endpoint ersetzen durch **2 individuelle PUT-Calls pro SKU** statt 1 bulk-call:
- `PUT /sell/inventory/v1/inventory_item/{sku}` — schreibt availability.shipToLocationAvailability.quantity
- `PUT /sell/inventory/v1/offer/{offerId}` — synced offer state (defensive)

**WARUM PUT-Calls funktionieren:** Q3-Evidence Probes 2026-05-02 zeigen `PUT /inventory_item/{sku}` returnt **204 No Content** (publishOne nutzt diesen Endpoint bereits erfolgreich für initial-publish). Nur `bulk_update_price_quantity` ist broken.

### Files-Touched
1. **PRIMÄR:** `apps/api/src/modules/marketplaces/ebay/ebay-stock-push.service.ts` (~50-80 LoC Code-Change in `pushListings` Methode)
2. **Tests:** `apps/api/src/modules/marketplaces/ebay/__tests__/ebay-stock-push.service.spec.ts` (~3-5 Spec-Syncs + 2-3 neue Tests)
3. **Docs:** `apps/api/docs/c15-6/PLAN.md` (this file) + `rollback-runbook.md`

KEIN Schema-Change, KEIN Test-Suite-Erweiterung außerhalb stock-push-spec.

### Erwartete Dauer
| Phase | Aktivität | Zeit |
|---|---|---|
| 1 | Plan (jetzt) | 15min |
| 2 | Implementation + Tests | 1-2h |
| 3 | Single-SKU live-test (SCH-40 standalone) | 15min |
| 4 | Deploy via push origin/main | 10min |
| 5 | Unpause der 23 listings + Smoke-Verify | 30min |
| **Total** | | **~3h** |

---

## 2. Background

### Link zu C15.5 Diagnose
- `apps/api/docs/c15-5/PLAN.md` — komplette Diagnose-Phase mit ADR-2
- `apps/api/docs/c15-6/` (this folder) — Workaround-Plan
- C15.5 Q-A2Y-3-Befund: `publishProductGroup` hat C15.4-Lücke (separate from this plan, not in C15.6 scope)

### eBay Email Reference
- Email an `DTSupport@ebay.com` gesendet 2026-05-02 (bezüglich errorId 25001)
- Erwartete Antwort: 1-7 Werktage
- C15.6 ist Workaround bis eBay-Support antwortet — bei Owner-Wahl optional Rollback wenn eBay-Support den Endpoint fixt

### Q3 Evidence Summary
- 6 historical failures dokumentiert in `/tmp/c15-5-ebay-evidence.json`
- Q3 direct-probes (3× POST bulk_update_price_quantity) wurden **vom Owner bewusst geskippt** — historical Q1+Q2 sind ausreichend für Pattern-Bestätigung
- errorId 25001 / domain `API_INVENTORY` / category `SYSTEM` konsistent über 24+h

---

## 3. Architectural Decision (ADR-3-v3) — 2-Strategy Self-Healing Stock Sync + ESCALATE

### v1 → v2 → v3 Revision-History

**v1 Plan (verworfen):** "Single per-SKU PUT inventory_item replaces bulk_update_price_quantity. PUT-semantic ist merge."
- **Flaw:** eBay's `createOrReplaceInventoryItem` Endpoint-Name suggeriert REPLACE → Daten-Verlust-Risiko.

**v2 Plan (verworfen):** Multi-Strategy mit 3 Strategies (Bulk + GetThenPut + OfferUpdate) + Auto-Fallback.
- **Owner-Feedback:** Strategy C (OfferUpdate) nicht empirisch verifiziert; PUT /offer könnte gleiche Replace-Semantik haben → wiederholt v1-Flaw. YAGNI: Strategy B alleine ist sicher und ausreichend.

**v3 Plan (current):** **2-Strategy + ESCALATE**. In-Memory-Health durch **Redis (Upstash)** ersetzt für Restart-Survival. Explizite **Cool-Down-Ladder** für Recovery-Probe. **Per-SKU Lock-Pattern** für Race-Condition-Mitigation.

### Strategie-Übersicht (v3)

| Strategie | HTTP-Call | Use-Case | Status |
|---|---|---|---|
| **Strategy A: BulkUpdate** | POST `/bulk_update_price_quantity` | Optimal-Pfad (1 call/N SKUs) — broken seit 2026-04-29 (errorId 25001) | aktuell broken, behalten für Auto-Recovery wenn eBay-fix kommt |
| **Strategy B: GetThenPut** | GET `/inventory_item/{sku}` → modify → PUT `/inventory_item/{sku}` → GET (verify) | Safe Replace-Semantik-Workaround — preserves alle anderen Felder | primary post-deploy |
| **~~Strategy C: OfferUpdate~~** | ~~PUT `/offer/{offerId}`~~ | **ENTFERNT in v3** — Replace-vs-Merge-Flaw-Risiko + nicht empirisch verifiziert | n/a |

### ESCALATE-Pfad (statt Strategy C)

Wenn **beide** Strategien (A + B) für eine SKU degraded oder einzeln-failed sind:

```
1. Affected listing(s) selbst-pause
   - DB: status='paused', pauseReason='c156_all_strategies_failed'
   - Audit: CHANNEL_LISTING_BULK_PAUSED_FALLBACK
   
2. Admin-Notification (existing notification-system)
   - createForAllAdmins({ type: 'ebay_stock_sync_escalation', ... })
   
3. Email-Alert an Owner mit DTSupport@ebay.com Reference
   - existing email-system (transactional)
   - Subject: "C15.6 ESCALATE: All eBay stock-sync strategies failed"
   - Body: rlogids + SKU-list + last-known-state + reference DTSupport@ebay.com
```

Owner-Pfad: `git revert` ist NICHT erste Lösung (Auto-Recovery via Cool-Down-Ladder kann zwischenzeitlich self-heal). Bei persistent ESCALATE: Rollback-Runbook konsultieren.

### Strategy-Selector + Auto-Fallback (v3)

**Selection-Logik:**

```
For each SKU:
  1. Acquire per-SKU lock (Redis, TTL 30s) — siehe Race-Condition-Mitigation unten
     a. Lock acquisition fail → skip this cycle, retry next cron-tick
     b. Lock acquired → proceed
  2. Wähle "current healthy strategy" via RedisHealthService.pickPrimary()
     a. Order: bulk → get_then_put → ESCALATE
     b. Skip degraded strategies (cooldown active)
  3. Versuche Strategy
  4. Bei success: health.recordSuccess(strategy) → reset failure-count
  5. Bei failure: health.recordFailure(strategy) → increment, check 3-consecutive threshold
     a. Wenn 3 consecutive failures: degrade strategy + apply Cool-Down-Ladder
     b. Selector versucht next strategy in chain
  6. Wenn ALLE strategies failed/degraded → ESCALATE (siehe ESCALATE-Pfad oben)
  7. Release per-SKU lock (TTL fallback bei crash)

Auto-Recovery:
  - Cool-Down-Ladder mit exponential backoff (siehe unten)
  - Probe-Mechanismus nach Cool-Down-Expiry (designated canary-SKU)
  - 2 consecutive probe-successes erforderlich vor Restore (Risk #15)
```

### Cool-Down-Ladder (Recovery via exponential backoff)

| Degrade-Anzahl (innerhalb 24h-Sliding-Window) | Cool-Down-Dauer |
|---|---|
| 1st degrade | **1 hour** |
| 2nd degrade | **4 hours** |
| 3rd degrade | **12 hours** |
| 4th+ degrade | **24 hours** |

Nach Cool-Down-Expiry: **single-SKU probe attempt** mit dedicated canary-SKU. Probe-success → restore primary + reset failure-count. Probe-fail → extend Cool-Down zur next ladder rung. **2 consecutive probe-successes** erforderlich für endgültigen Restore (Schutz gegen False-Positive recovery).

### Recovery Probe Mechanism

```
1. Cool-Down expired → Selector erkennt strategy.cooldownUntil < now
2. Selector pickt **canary-SKU**:
   - Primary: env-var EBAY_CANARY_SKU (Owner-configurable)
   - Fallback: SKU mit most-recent successful publish (DB query)
3. Single-SKU probe-call mit gewählter Strategy
4. Probe-success:
   - Increment probe-success-counter (Redis: probeSuccessCount)
   - Wenn counter >= 2 (consecutive): RESTORE
     - Reset failure-count, isHealthy=true, cooldownUntil=null
     - Audit-event EBAY_ENDPOINT_HEALTH_RECOVERED
   - Wenn counter < 2: still degraded, but counter persists für nächste Iteration
5. Probe-fail:
   - Reset probe-success-counter to 0
   - Extend cool-down zur next ladder rung
   - Audit-event EBAY_ENDPOINT_PROBE_FAILED

Probe-Frequenz: 1× pro Cron-Tick (alle 15min) wenn cool-down expired.
0 Production-Stock-Impact: probe nur attempts, keine echten Stock-Updates auf canary-SKU.
```

### Per-SKU Race-Condition-Mitigation (Strategy B)

Strategy B (GET → modify → PUT) hat inhärentes race-window zwischen GET und PUT. Mitigation via Redis-basiertem distributed-lock:

```typescript
const lockKey = `ebay:lock:sku:${sku}`
const lockValue = `${process.pid}:${Date.now()}`  // unique per attempt

// Try acquire (NX = only if not exists, EX = TTL 30s)
const acquired = await redis.set(lockKey, lockValue, 'NX', 'EX', 30)

if (!acquired) {
  // Another process/cron-tick holds lock → skip this SKU this cycle
  log.info(`Skipping ${sku}: lock held by another process`)
  return { skipped: true, reason: 'sku_locked' }
}

try {
  // ... GET → modify → PUT → verify ...
} finally {
  // Release lock (only if we still own it — defensive against TTL-expiry-race)
  const currentValue = await redis.get(lockKey)
  if (currentValue === lockValue) await redis.del(lockKey)
  // Else: TTL already expired + another process took over — that's fine
}
```

**Performance-Estimate (v3 mit Lock-Overhead):**

| Phase | Calls | Latency |
|---|---|---|
| Lock acquire (Redis NX) | 1 | ~5ms |
| Strategy B sequence | 3 (GET + PUT + verify-GET) | ~1.2s |
| Lock release | 1 | ~5ms |
| **Per SKU total** | **~5 calls** | **~1.21s** |
| **23 SKUs sequential** | ~115 calls | **~28s** |
| **Plus 100ms inter-SKU sleep** | (für Rate-Limit-Buffer) | **~30s** |

Bei 15min cron-schedule: ~3% utilization → komfortabel.

### Pre/Post Snapshot Verification (kritischer v2-Mechanismus)

Für **jede** PUT-Operation in Strategy B+C:

```
1. GET /inventory_item/{sku} → snapshot fields-of-interest BEFORE
   (title, description, imageUrls, aspects, condition, packageWeightAndSize, groupIds)

2. PUT /inventory_item/{sku} mit modifiziertem body (quantity gesetzt, alle anderen Felder
   aus Snapshot kopiert)

3. GET /inventory_item/{sku} → snapshot AFTER

4. Compare:
   - quantity sollte = effective sein
   - alle anderen Felder UNVERÄNDERT
   
5. Bei Daten-Verlust erkannt:
   - LOG: ERROR mit before/after diff
   - AUDIT: CHANNEL_LISTING_DATA_DRIFT_DETECTED
   - HEALTH: degrade Strategy B → C
   - PER-SKU: persist syncError, kein retry diese cron-iteration
```

**Owner-Constraint-Konformität:** kein Schema-Touch. Snapshot-Diff in audit-log JSON-Feld + In-Memory-HealthService.

### Endpoint Health Monitoring (Redis / Upstash, v3)

| Aspekt | Implementation |
|---|---|
| Wo gespeichert | **Upstash Redis** (existing in stack — kein neues dependency) |
| Persisted? | **Ja — survives Railway restarts.** TTL 24h für auto-cleanup wenn service stopped. |
| Redis Keys | `ebay:strategy-health:bulk-update`<br>`ebay:strategy-health:get-then-put` |
| Value-Schema (JSON) | `{ failures: number, lastFailureAt: ISO, isHealthy: boolean, cooldownUntil: ISO \| null, degradeCount24h: number, probeSuccessCount: number }` |
| Audit-Trail | Pro health-event audit-log row: `EBAY_ENDPOINT_HEALTH_DEGRADED` / `EBAY_ENDPOINT_HEALTH_RECOVERED` / `EBAY_ENDPOINT_PROBE_FAILED` / `EBAY_ENDPOINT_PROBE_SUCCESS` |
| Restart-Verhalten | **State persistiert** — kein 45min cold-start re-discovery. **3 unnecessary failed eBay-calls per deploy ELIMINIERT** (v2-Risk-13 strukturell entfernt). |
| Redis-Outage-Fallback | Graceful degradation auf in-memory-Map mit log-warning. Service läuft weiter, nur cold-start-cost bei Restart (siehe Risk #14). |
| Owner-Visibility | Audit-log + optional admin endpoint `/api/v1/admin/marketplaces/ebay/health` (read-only Snapshot, liest aus Redis) |

### Trade-off-Analyse v3 (2 Strategien + ESCALATE)

| Aspekt | A: bulk | B: GET+PUT |
|---|---|---|
| HTTP-Calls bei N SKUs | `ceil(N/25)` | `3N` (GET+PUT+verify-GET) |
| API-Quota | minimal | hoch |
| Daten-Verlust-Risiko | n/a (nur quantity) | 🟢 strukturell ausgeschlossen (preserves all fields) |
| Empirische Funktion (heute) | ❌ broken | ✅ erwartet ok |
| Rollback-Ease | n/a | git revert |
| Future-Proof | low | hoch (Snapshot-Verify catches drift) |
| Replace-vs-Merge-Flaw-Risiko | n/a | 🟢 ausgeschlossen (full body roundtrip) |

### Strategy C entfernt — Begründung (v3)

| Grund | Detail |
|---|---|
| Nicht empirisch verifiziert | Q3-Probe in C15.5 hat OfferUpdate-Pfad nie gegen quantity-update getestet |
| Replace-vs-Merge-Flaw-Wiederholung | PUT `/offer/{offerId}` könnte gleiche createOrReplace-Semantik haben → würde alle anderen offer-Felder (price, listingPolicies, fulfillmentPolicy etc.) überschreiben — gleicher v1-Flaw |
| YAGNI | Strategy B alleine ist sicher und ausreichend (Snapshot-Verifier garantiert no data-loss) |
| Code-Komplexität | Eine weniger Strategy = weniger Tests, weniger Pseudo-Code, weniger Coverage-Lücken |

**Wenn Strategy B auch failt:** ESCALATE-Pfad (siehe oben) — **NICHT** weiter degrade auf riskante Strategy C.

### Entscheidung: 2 Strategien + ESCALATE + Redis-Health

**Begründung:**
- **Resilience:** A → B fallback bei Bulk-broken; ESCALATE wenn beide failed → Owner-Notification statt blind weiter try
- **Auto-Recovery:** wenn eBay fix kommt, system erkennt via Probe + nutzt wieder bulk (least quota)
- **Empirische Verifikation:** Snapshot-Verifier ersetzt unsichere Annahmen
- **Persistierte Health:** Redis übersteht Railway-Restarts → kein 45min cold-start-spam
- **Sustainability:** Pattern erweiterbar für künftige eBay-API-Änderungen + andere Channels

### Performance-Schätzung v3

Bei 23 listings + Strategy B (3 calls pro SKU + Lock-Overhead):
- 23 × ~5 calls × ~400ms + Lock-Overhead ≈ **~30s total (sequenziell)**
- Cron-schedule 15min → ~3% utilization
- Wenn eBay's bulk wieder ok (Strategy A): zurück auf ~500ms total
- 429-Buffer: 100ms `sleep` zwischen SKU-Operationen optional (siehe Risk #2)

---

## 4. Affected Files

### Primary (Code-Touch)
| File | Lines (current) | Estimate Change |
|---|---|---|
| `apps/api/src/modules/marketplaces/ebay/ebay-stock-push.service.ts` | 615 LoC | -50 / +60 LoC |

### Secondary (Spec-Sync)
| File | Lines (current) | Estimate Change |
|---|---|---|
| `apps/api/src/modules/marketplaces/ebay/__tests__/ebay-stock-push.service.spec.ts` | ~720 LoC | -20 / +50 LoC |

### Tertiary (Docs)
| File | Status |
|---|---|
| `apps/api/docs/c15-6/PLAN.md` | NEU (this file) |
| `apps/api/docs/c15-6/rollback-runbook.md` | NEU |

### Untouched (verified)
- ❌ `prisma/schema.prisma` — kein Schema-Change
- ❌ `ebay-listing.service.ts` — publishOne-Pfad unverändert
- ❌ `ebay-stock-reconcile.service.ts` — Cron-Wrapper unverändert
- ❌ `ebay-stock-reconcile.cron.ts` — Cron-Schedule unverändert
- ❌ `ebay-api.client.ts` — HTTP-Client unverändert
- ❌ `STOCK_AUDIT_ACTIONS` Constants — unverändert
- ❌ Andere modules (Orders/Payments/Returns/Refunds): ZERO TOUCH

---

## 5. Code-Änderung im Detail (v3)

### File-Layout (v3 — 5 neue Files statt 6)

**5 neue Files (untracked vor Phase 2 commit):**

```
apps/api/src/modules/marketplaces/ebay/
  ├── ebay-stock-push.service.ts                 ← MODIFIED: delegate to selector
  ├── ebay-stock-strategies/                     ← NEW folder
  │   ├── stock-update-strategy.interface.ts     ← NEW: shared Interface
  │   ├── bulk-update-strategy.ts                ← NEW: Strategy A
  │   └── get-then-put-strategy.ts               ← NEW: Strategy B (PRIMARY post-deploy)
  ├── ebay-stock-strategy-selector.ts            ← NEW: orchestration + Lock + Probe
  ├── ebay-snapshot-verifier.ts                  ← NEW: Pre/Post-diff
  └── ebay-endpoint-health.service.ts            ← NEW: REDIS-based health (v3 change)
```

**v3-Änderung vs v2:**
- ❌ `offer-update-strategy.ts` — entfernt (Strategy C eliminated)
- 🔄 `ebay-endpoint-health.service.ts` — Implementation Redis statt In-Memory
- 🔄 `ebay-stock-strategy-selector.ts` — erweitert um Per-SKU-Lock + Probe-Mechanismus

**1 Modified File:**
- `ebay-stock-push.service.ts` (rip-and-replace `pushListings` ~120 LoC mit Selector-Aufruf ~30 LoC)

**1 Module-Wiring File:**
- `ebay.module.ts` — providers/exports erweitern um neue Services (additive, kein Refactor)
- Redis-Client (existing in stack) injected in HealthService — kein neuer Provider außerhalb existing

### StockUpdateStrategy Interface

```typescript
// ebay-stock-strategies/stock-update-strategy.interface.ts

export interface StockUpdateContext {
  listing: { id: string; variantId: string | null; externalListingId: string | null }
  sku: string
  offerId: string
  effectiveQuantity: number
  bearerToken: string
}

export interface StockUpdateResult {
  ok: boolean
  httpStatus: number
  errorMessage: string | null
  errorId: number | null
  rateLimited: boolean
  // For Snapshot-Verifier diagnostic info:
  preSnapshot?: any
  postSnapshot?: any
  dataLossDetected?: boolean
  dataLossFields?: string[]
}

export interface StockUpdateStrategy {
  readonly name: 'bulk' | 'get_then_put' | 'offer_update'
  /** Execute push for ONE SKU. Each strategy decides whether internal
   *  batching (bulk) is possible across calls. For consistency the
   *  Selector calls per-SKU; bulk-strategy MAY internally accumulate. */
  execute(ctx: StockUpdateContext): Promise<StockUpdateResult>
}
```

### Strategy A — BulkUpdateStrategy (Pseudo-Code)

```typescript
// ebay-stock-strategies/bulk-update-strategy.ts
@Injectable()
export class BulkUpdateStrategy implements StockUpdateStrategy {
  readonly name = 'bulk' as const

  async execute(ctx: StockUpdateContext): Promise<StockUpdateResult> {
    // Per-SKU thin wrapper around current bulk-endpoint
    // (NOTE: future iteration könnte mehrere SKUs in 1 call batchen, aber
    // für v2 simplicity: 1 SKU pro execute() — Selector orchestriert)
    try {
      await client.request('POST', '/sell/inventory/v1/bulk_update_price_quantity', {
        bearer: ctx.bearerToken,
        body: { requests: [{ offerId: ctx.offerId, availableQuantity: ctx.effectiveQuantity }] },
      })
      return { ok: true, httpStatus: 200, ... }
    } catch (e) {
      // Map errorId 25001 / 429 / 4xx zu StockUpdateResult
      return { ok: false, httpStatus: e.status, errorMessage: ..., errorId: ... }
    }
  }
}
```

### Strategy B — GetThenPutStrategy (Pseudo-Code, primary post-deploy)

```typescript
// ebay-stock-strategies/get-then-put-strategy.ts
@Injectable()
export class GetThenPutStrategy implements StockUpdateStrategy {
  readonly name = 'get_then_put' as const

  constructor(private readonly verifier: EbaySnapshotVerifier) {}

  async execute(ctx: StockUpdateContext): Promise<StockUpdateResult> {
    // Step 1: GET inventory_item full body
    let preSnapshot: any
    try {
      preSnapshot = await client.request('GET',
        `/sell/inventory/v1/inventory_item/${encodeURIComponent(ctx.sku)}`,
        { bearer: ctx.bearerToken },
      )
    } catch (e) { return failureResult(e) }

    // Step 2: Modify quantity, preserve everything else
    const modifiedBody = {
      ...preSnapshot,
      availability: {
        ...preSnapshot.availability,
        shipToLocationAvailability: {
          ...preSnapshot.availability?.shipToLocationAvailability,
          quantity: ctx.effectiveQuantity,
        },
      },
    }

    // Step 3: PUT modified body
    try {
      await client.request('PUT',
        `/sell/inventory/v1/inventory_item/${encodeURIComponent(ctx.sku)}`,
        { bearer: ctx.bearerToken, body: modifiedBody, bodyKind: 'json' },
      )
    } catch (e) { return failureResult(e) }

    // Step 4: GET again → verify no data-loss
    let postSnapshot: any
    try {
      postSnapshot = await client.request('GET',
        `/sell/inventory/v1/inventory_item/${encodeURIComponent(ctx.sku)}`,
        { bearer: ctx.bearerToken },
      )
    } catch (e) {
      // Post-GET fail — log but don't block (data was put successfully)
      return { ok: true, httpStatus: 204, preSnapshot, postSnapshot: null, ... }
    }

    // Step 5: Diff via Verifier
    const diff = this.verifier.diff(preSnapshot, postSnapshot, ctx.effectiveQuantity)
    if (diff.dataLossDetected) {
      return {
        ok: false,
        httpStatus: 204,
        errorMessage: `Data-loss detected: ${diff.changedFields.join(', ')}`,
        dataLossDetected: true,
        dataLossFields: diff.changedFields,
        preSnapshot, postSnapshot,
      }
    }
    return { ok: true, httpStatus: 204, preSnapshot, postSnapshot, ... }
  }
}
```

### ~~Strategy C — OfferUpdateStrategy~~ (entfernt in v3)

**v2-Plan hatte Strategy C als last-resort. v3 entfernt sie.** Begründung siehe Section 3 Trade-off-Analyse. Bei beiden Strategies failed: ESCALATE-Pfad statt riskante 3rd-Strategy.

### EbaySnapshotVerifier (Pseudo-Code)

```typescript
// ebay-snapshot-verifier.ts
@Injectable()
export class EbaySnapshotVerifier {
  // Felder die NICHT im PUT-Body stehen, aber preserved werden müssen
  private readonly PRESERVE_FIELDS = [
    'product.title',
    'product.description',
    'product.aspects',
    'product.imageUrls',
    'product.brand',
    'product.mpn',
    'condition',
    'packageWeightAndSize.weight',
    'packageWeightAndSize.dimensions',
    'groupIds',
    'inventoryItemGroupKeys',
  ]

  diff(pre: any, post: any, expectedQty: number): {
    dataLossDetected: boolean
    changedFields: string[]
    quantityCorrect: boolean
  } {
    const changed: string[] = []
    for (const path of this.PRESERVE_FIELDS) {
      const a = getPath(pre, path)
      const b = getPath(post, path)
      if (!deepEqual(a, b)) changed.push(path)
    }
    const postQty = post?.availability?.shipToLocationAvailability?.quantity
    return {
      dataLossDetected: changed.length > 0,
      changedFields: changed,
      quantityCorrect: postQty === expectedQty,
    }
  }
}
```

### EbayEndpointHealthService (Pseudo-Code, Redis-based v3)

```typescript
// ebay-endpoint-health.service.ts
@Injectable()
export class EbayEndpointHealthService {
  private readonly logger = new Logger(EbayEndpointHealthService.name)
  private readonly REDIS_TTL_SECONDS = 24 * 60 * 60 // 24h auto-cleanup
  private readonly KEY_PREFIX = 'ebay:strategy-health:'
  // Cool-Down ladder (in seconds)
  private readonly COOLDOWN_LADDER = [
    1 * 60 * 60,   // 1st degrade: 1h
    4 * 60 * 60,   // 2nd: 4h
    12 * 60 * 60,  // 3rd: 12h
    24 * 60 * 60,  // 4th+: 24h
  ]

  // Fallback in-memory map (used wenn Redis-Outage)
  private fallbackState = new Map<StrategyName, HealthState>()
  private redisAvailable = true

  constructor(
    private readonly redis: RedisService, // existing Upstash client
    private readonly audit: AuditService,
  ) {}

  private async readState(strategy: StrategyName): Promise<HealthState> {
    try {
      const raw = await this.redis.get(this.KEY_PREFIX + strategy)
      if (raw) return JSON.parse(raw)
    } catch (e) {
      this.handleRedisOutage(e)
      return this.fallbackState.get(strategy) ?? this.defaultHealthState()
    }
    return this.defaultHealthState()
  }

  private async writeState(strategy: StrategyName, state: HealthState): Promise<void> {
    try {
      await this.redis.set(
        this.KEY_PREFIX + strategy,
        JSON.stringify(state),
        'EX', this.REDIS_TTL_SECONDS,
      )
    } catch (e) {
      this.handleRedisOutage(e)
      this.fallbackState.set(strategy, state)
    }
  }

  async recordSuccess(strategy: StrategyName): Promise<void> {
    const s = await this.readState(strategy)
    const wasUnhealthy = !s.isHealthy
    s.failures = 0
    s.lastFailureAt = null
    if (wasUnhealthy) {
      // Probe success requires 2 consecutive (Risk #15 mitigation)
      s.probeSuccessCount = (s.probeSuccessCount ?? 0) + 1
      if (s.probeSuccessCount >= 2) {
        s.isHealthy = true
        s.cooldownUntil = null
        s.probeSuccessCount = 0
        await this.audit.log({ action: 'EBAY_ENDPOINT_HEALTH_RECOVERED', /* ... */ })
      } else {
        await this.audit.log({ action: 'EBAY_ENDPOINT_PROBE_SUCCESS', /* counter */ })
      }
    }
    await this.writeState(strategy, s)
  }

  async recordFailure(strategy: StrategyName): Promise<boolean /* now degraded? */> {
    const s = await this.readState(strategy)
    s.failures++
    s.lastFailureAt = new Date().toISOString()
    s.probeSuccessCount = 0 // reset probe counter on any failure
    if (s.failures >= 3 && s.isHealthy) {
      s.isHealthy = false
      s.degradeCount24h = (s.degradeCount24h ?? 0) + 1
      const ladderIndex = Math.min(s.degradeCount24h - 1, this.COOLDOWN_LADDER.length - 1)
      const cooldownSecs = this.COOLDOWN_LADDER[ladderIndex]
      s.cooldownUntil = new Date(Date.now() + cooldownSecs * 1000).toISOString()
      await this.writeState(strategy, s)
      await this.audit.log({
        action: 'EBAY_ENDPOINT_HEALTH_DEGRADED',
        changes: { after: { strategy, ladderRung: ladderIndex + 1, cooldownUntil: s.cooldownUntil } },
      })
      return true
    }
    await this.writeState(strategy, s)
    return false
  }

  /** Returns next healthy or cool-down-expired strategy in chain.
   *  Order: bulk → get_then_put. Wenn beide unavailable → null (= ESCALATE) */
  async pickPrimary(): Promise<StrategyName | null> {
    for (const name of ['bulk', 'get_then_put'] as const) {
      const s = await this.readState(name)
      if (s.isHealthy) return name
      // Degraded but cool-down expired? → eligible for probe
      if (s.cooldownUntil && new Date(s.cooldownUntil) < new Date()) return name
    }
    return null // ESCALATE
  }

  async isAllDegraded(): Promise<boolean> {
    const a = await this.readState('bulk')
    const b = await this.readState('get_then_put')
    return !a.isHealthy && !b.isHealthy
  }

  /** Owner manually-trigger probe-reset (admin endpoint optional) */
  async resetForProbe(strategy: StrategyName): Promise<void> {
    await this.writeState(strategy, this.defaultHealthState())
  }

  private defaultHealthState(): HealthState {
    return {
      failures: 0,
      lastFailureAt: null,
      isHealthy: true,
      cooldownUntil: null,
      degradeCount24h: 0,
      probeSuccessCount: 0,
    }
  }

  private handleRedisOutage(error: any): void {
    if (this.redisAvailable) {
      this.redisAvailable = false
      this.logger.warn(`Redis unavailable, falling back to in-memory health-state: ${error?.message}`)
      // Fire-and-forget admin notification (existing system)
    }
  }
}

interface HealthState {
  failures: number
  lastFailureAt: string | null  // ISO
  isHealthy: boolean
  cooldownUntil: string | null  // ISO
  degradeCount24h: number
  probeSuccessCount: number
}
```

### EbayStockStrategySelector (Pseudo-Code v3 — mit Lock + Probe)

```typescript
// ebay-stock-strategy-selector.ts
@Injectable()
export class EbayStockStrategySelector {
  private readonly LOCK_TTL_SECONDS = 30
  private readonly LOCK_PREFIX = 'ebay:lock:sku:'

  constructor(
    private readonly health: EbayEndpointHealthService,
    private readonly redis: RedisService,
    private readonly bulk: BulkUpdateStrategy,
    private readonly getThenPut: GetThenPutStrategy,
    private readonly notifications: NotificationService,
    private readonly emailService: EmailService,
  ) {}

  async executeForSku(ctx: StockUpdateContext): Promise<StockUpdateResult> {
    // Step 1: Acquire per-SKU lock (Redis NX)
    const lockKey = this.LOCK_PREFIX + ctx.sku
    const lockValue = `${process.pid}:${Date.now()}`
    const acquired = await this.tryAcquireLock(lockKey, lockValue)
    if (!acquired) {
      return { ok: false, skipped: true, errorMessage: 'sku_locked_by_other_process', ... }
    }

    try {
      // Step 2: Pick primary strategy (Redis-backed health-check)
      const order = await this.buildOrderedChain()  // ['bulk', 'get_then_put'] minus degraded
      let lastResult: StockUpdateResult | null = null

      for (const name of order) {
        const strategy = this.byName(name)
        const result = await strategy.execute(ctx)
        lastResult = result

        if (result.ok) {
          await this.health.recordSuccess(name)
          return result
        }

        await this.health.recordFailure(name)
        // Continue loop → try next strategy in chain
      }

      // Step 3: All strategies exhausted → ESCALATE
      if (await this.health.isAllDegraded()) {
        await this.escalate(ctx, lastResult)
      }
      return lastResult ?? { ok: false, errorMessage: 'all_strategies_failed', ... }

    } finally {
      // Step 4: Release lock (only if we still own it)
      await this.releaseLockIfOwned(lockKey, lockValue)
    }
  }

  private async buildOrderedChain(): Promise<StrategyName[]> {
    const chain: StrategyName[] = []
    for (const name of ['bulk', 'get_then_put'] as const) {
      const s = await this.health.readState(name)
      if (s.isHealthy) {
        chain.push(name)
      } else if (s.cooldownUntil && new Date(s.cooldownUntil) < new Date()) {
        // Cool-down expired → eligible for probe (single attempt this cycle)
        chain.push(name)
      }
      // Else: degraded + cool-down active → skip
    }
    return chain
  }

  private async tryAcquireLock(key: string, value: string): Promise<boolean> {
    try {
      const r = await this.redis.set(key, value, 'NX', 'EX', this.LOCK_TTL_SECONDS)
      return r === 'OK'
    } catch {
      // Redis-Outage: fallback "lock-less" mode (best-effort, accepts race-risk)
      return true
    }
  }

  private async releaseLockIfOwned(key: string, expectedValue: string): Promise<void> {
    try {
      const current = await this.redis.get(key)
      if (current === expectedValue) await this.redis.del(key)
      // Else: TTL already expired → no-op
    } catch {
      // Redis-Outage: ignore (TTL will auto-cleanup)
    }
  }

  private async escalate(ctx: StockUpdateContext, lastResult: StockUpdateResult | null): Promise<void> {
    // ESCALATE-Pfad: Pause + Admin-Notification + Email-Alert
    // (siehe Section 3 ESCALATE-Pfad-Definition)
    await this.notifications.createForAllAdmins({
      type: 'ebay_stock_sync_escalation',
      title: 'C15.6 ESCALATE: All eBay stock-sync strategies failed',
      message: `SKU=${ctx.sku} all-strategies-degraded. Manual intervention or DTSupport@ebay.com escalation needed.`,
    })
    // Email-Alert (Owner-DTSupport-Reference) — fire-and-forget
    await this.emailService.sendOwnerAlert({
      subject: 'C15.6 ESCALATE: eBay stock-sync all-strategies-failed',
      body: `Affected SKU: ${ctx.sku}\nLast error: ${lastResult?.errorMessage}\nReference: DTSupport@ebay.com (existing thread)`,
    }).catch(() => {})
  }

  private byName(n: StrategyName): StockUpdateStrategy {
    if (n === 'bulk') return this.bulk
    return this.getThenPut
  }
}
```

### EbayStockPushService — modified `pushListings`

```typescript
// ebay-stock-push.service.ts (modified, ~30 LoC ersetzen alte ~120 LoC chunk-loop)
constructor(
  // ... existing deps ...
  private readonly selector: EbayStockStrategySelector,
) {}

private async pushListings(listings: any[], fromCron: boolean): Promise<PushBatchResult> {
  // ... unchanged: candidate-filter, computeEffective, skip-checks ...

  for (const c of toPush) {
    const result = await this.selector.executeForSku({
      listing: c.listing,
      sku: c.sku,
      offerId: c.offerId,
      effectiveQuantity: c.effective,
      bearerToken: bearer,
    })

    if (result.rateLimited) {
      pushResult.rateLimited = true
      // ... existing 429 abort-tick logic ...
      return pushResult
    }

    if (result.ok) {
      // existing DB-persist logic for success
    } else {
      // existing persistFailure logic
    }
  }
}
```

### Module Wiring (ebay.module.ts)

```typescript
@Module({
  // ... existing ...
  providers: [
    // ... existing services ...
    BulkUpdateStrategy,
    GetThenPutStrategy,
    OfferUpdateStrategy,
    EbaySnapshotVerifier,
    EbayEndpointHealthService,
    EbayStockStrategySelector,
  ],
  exports: [/* ... unchanged + new selectors if needed ... */],
})
```

### Was bleibt gleich (v2 Owner-Constraint-Konformität)

- `loadCandidateListings` — UNVERÄNDERT
- WHERE-clause + Filter — UNVERÄNDERT
- `computeEffectiveByVariant` — UNVERÄNDERT
- DB-persist-pattern (lastSyncedQuantity, syncError) — UNVERÄNDERT
- C15.4 Bug-Fix (externalOfferId in publishOne) — UNVERÄNDERT
- C15.4 reset-sync endpoint — UNVERÄNDERT
- Audit-actions STOCK_AUDIT_ACTIONS — UNVERÄNDERT (+ optional NEU für health-events)
- ChannelStockPusher Interface — UNVERÄNDERT
- pushForVariants / runReconcileTick public APIs — UNVERÄNDERT
- 0 Schema-Touch — UNVERÄNDERT
- Andere Modules (Orders/Payments/Returns/Refunds/Reservations): ZERO TOUCH

### Aktuelle Implementation (Reference, ebay-stock-push.service.ts, Zeilen 412-532) — wird ersetzt

```typescript
// Zeile 412: Chunk into eBay's 25-SKU batches
for (let i = 0; i < toPush.length; i += EBAY_BULK_BATCH_SIZE) {
  const chunk = toPush.slice(i, i + EBAY_BULK_BATCH_SIZE)
  const requests = chunk.map((c) => ({
    offerId: c.offerId,
    availableQuantity: c.effective,
  }))

  // Zeile 430: POST bulk_update_price_quantity
  rawResponse = await client.request<any>(
    'POST',
    '/sell/inventory/v1/bulk_update_price_quantity',
    { bearer, body: { requests }, bodyKind: 'json', retry: false },
  )
  // ... batch error handling, per-SKU outcome parsing via extractPerSkuErrors
  // ... per-SKU success/fail persist
}
```

### Neue Implementation (Pseudo-Code, ~60 LoC ersetzt ~120 LoC)

```typescript
// Zeile 412 ersetzt: per-SKU PUT statt chunk-batch
for (const c of toPush) {
  const sku = c.sku
  const offerId = c.offerId
  const effective = c.effective

  let pushOk = false
  let pushError: string | null = null
  let httpStatus = 0

  try {
    // PUT inventory_item — synced quantity. Body identisch zu publishOne-Pattern
    // (siehe ebay-listing-mapper.buildInventoryItemPayload), aber nur quantity-update.
    // C15.6 Workaround: load minimal-payload aus existing offer (wir wollen
    // andere Felder NICHT überschreiben).
    const itemPayload = {
      availability: {
        shipToLocationAvailability: {
          quantity: effective,
        },
      },
      // Keine product, packageWeightAndSize, condition — diese Felder werden
      // NICHT in PUT geschickt → eBay merged mit existing inventory_item.
      // (Need verification — siehe Risk #5)
    }

    await client.request(
      'PUT',
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      { bearer, body: itemPayload, bodyKind: 'json', retry: false },
    )
    pushOk = true
  } catch (e: any) {
    if (e instanceof EbayApiError) {
      httpStatus = e.status
      if (e.status === 429) {
        // 429 abort tick — gleiche Logik wie alt
        result.rateLimited = true
        // ... (analog Zeile 439-465)
        return result
      }
      pushError = `eBay ${e.status}: ${e.message.slice(0, 300)}`
    } else {
      pushError = `network: ${(e?.message ?? String(e)).slice(0, 300)}`
    }
  }

  // First-Run-Logging (analog Zeile 473-482, aber per-SKU statt per-batch)
  if (this.rawLogCount < FIRST_RUN_LOG_LIMIT) {
    this.rawLogCount++
    const summary = pushOk ? 'OK' : `FAIL (${httpStatus}): ${pushError}`
    this.logger.log(
      `[ebay-stock-push] first-run #${this.rawLogCount}/${FIRST_RUN_LOG_LIMIT} sku=${sku}: ${summary}`,
    )
  }

  // Persist outcome (gleiche Logik wie alt, Zeile 489-531, aber per-SKU)
  if (pushOk) {
    try {
      await this.prisma.channelProductListing.update({
        where: { id: c.listing.id },
        data: {
          lastSyncedQuantity: effective,
          lastSyncedAt: new Date(),
          syncAttempts: 0,
          syncError: null,
        },
      })
    } catch (writeErr: any) {
      this.logger.warn(`[ebay-stock-push] DB persist failed listing=${c.listing.id}: ${writeErr?.message}`)
    }
    result.pushed++
    result.items.push({ listingId: c.listing.id, variantId: c.listing.variantId, sku, effective, status: 'pushed' })
  } else {
    await this.persistFailure(c.listing, pushError ?? 'unknown error')
    result.failed++
    result.items.push({ listingId: c.listing.id, variantId: c.listing.variantId, sku, effective, status: 'failed', error: pushError ?? 'unknown' })
  }
}
```

### Was ändert sich

| Element | Alt | Neu |
|---|---|---|
| HTTP-Method | POST | PUT |
| Endpoint | `/bulk_update_price_quantity` | `/inventory_item/{sku}` |
| Body-Shape | `{ requests: [...] }` | `{ availability: { shipToLocationAvailability: { quantity } } }` |
| Iteration | per-chunk (25 SKUs) | per-SKU |
| extractPerSkuErrors | needed (parses chunk-response) | **DEAD CODE** — kann entfernt oder behalten werden |
| EBAY_BULK_BATCH_SIZE Constant | used | **DEAD CODE** — Owner-Wahl behalten/entfernen |

### Was bleibt gleich

- `loadCandidateListings` — **unverändert** (WHERE-clause, idempotency, Anti-Spam-Filter)
- Effective-quantity computation (`computeEffectiveByVariant`) — unverändert
- Skip-checks (no-sku, no-offer-id, no-change-since-last) — unverändert
- 429 rate-limit-handling — gleiche Logik, nur per-SKU statt per-chunk
- DB-persist-pattern — identisch (lastSyncedQuantity, lastSyncedAt, syncAttempts, syncError)
- Audit-actions (`STOCK_AUDIT_ACTIONS.PUSH_FAILED`, `RATE_LIMITED`) — unverändert
- Notification-pattern — unverändert
- First-Run-Logging — analog (per-SKU statt per-batch)
- ChannelStockPusher Interface — unverändert
- pushForVariants / runReconcileTick public APIs — unverändert
- C15.4 externalOfferId-Persistierung im publishOne — unverändert

---

## 6. Test Strategy

### Phase 3 — Single-SKU Live-Test (vor Phase 4 Deploy) — v2 erweitert

**Test-SKU:** SCH-40 standalone-listing (offerId=159794556011, listingDbId=1ed8dd45).

**Test-Schritte (v2 mit Snapshot-Verification):**
1. Build local: `pnpm build` (api)
2. Cherry-pick neue stock-push code (Strategies + Selector + Verifier + Health) in lokalen branch
3. Run Bootstrap-Smoke: `node --enable-source-maps dist/apps/api/src/main` + Module-DI-Resolution-Check für 6 neue Services
4. Manuell unpause SCH-40 nur (1 SKU): `UPDATE channel_product_listings SET status='active', pause_reason=null WHERE id='1ed8dd45'`
5. **PRE-PUT GET-Snapshot via `c15-5-verify-ebay-state.ts`** — capture full inventory_item body inkl. PRESERVE_FIELDS
6. Run smoke-trigger: `c15-4-trigger-reconcile-once.ts`
7. **POST-PUT GET-Snapshot** — capture full inventory_item body
8. **Diff-Check (kritisch v2):**
   - quantity sollte 3 sein (changed)
   - product.title, product.description, product.aspects, product.imageUrls, condition, packageWeightAndSize, groupIds → ALLE UNVERÄNDERT
   - Wenn data-loss erkannt: STOP, Strategy B verwirft → fall-through Strategy C testen
9. Erwartung: Selector-Audit-Log zeigt welche Strategy genutzt wurde (bulk degraded → get_then_put primary)
10. eBay-Seller-Hub manuell: SCH-40 Listing zeigt korrekte Quantity, alle anderen Felder unverändert
11. DB-verify: `lastSyncedQuantity=3, syncError=null, syncAttempts=0`
12. Bei Erfolg + 0 data-loss: Phase 4 (Deploy). Bei data-loss: STOP, Rollback-Runbook.

### Strategy-Tests (per-Strategy Independent, v3)

Pro Strategy ein isolierter Test:
- **Strategy A (bulk):** wird heute weiterhin errorId 25001 zurückgeben → expect failure → HealthService degrade nach 3 consecutive
- **Strategy B (GetThenPut):** primary v3 path, expected success + 0 data-loss (Snapshot-Verifier confirms)

### Selector Auto-Fallback Tests (v3)

Live-Test-Sequenz:
1. Cold-start (Redis empty oder fresh state): beide strategies healthy, Selector wählt bulk first
2. Bulk fail (Real-World errorId 25001) → recordFailure → Redis-state updated
3. Iteriert SKU 1: bulk fail (count 1), retry mit get_then_put → success → bulk count=1, getThenPut healthy
4. Iteriert SKU 2-3: gleiche bulk-Versuche → bulk fail count 3 → degraded → cooldownUntil = now+1h
5. Verify Redis: `ebay:strategy-health:bulk-update` zeigt isHealthy=false, cooldownUntil ISO
6. Verify Audit-Log: 1× `EBAY_ENDPOINT_HEALTH_DEGRADED` für bulk-Strategy

### Cool-Down-Ladder Tests

- 1st degrade → cooldownUntil = now + 1h (verify exact)
- Manuell via mock-clock: advance 1h → cool-down expired → Selector eligible für probe
- 2nd degrade (innerhalb 24h) → cooldownUntil = now + 4h
- 3rd degrade → 12h, 4th+ → 24h
- Verify ladder-rung-index berechnet korrekt aus degradeCount24h

### Recovery Probe Tests

- Probe-success #1 → counter=1, still degraded
- Probe-success #2 → counter=2 → Restore (isHealthy=true, cooldownUntil=null)
- Probe-success #1 then probe-fail → counter reset to 0 + cool-down extend
- Verify `EBAY_ENDPOINT_PROBE_SUCCESS` + `EBAY_ENDPOINT_PROBE_FAILED` audit-events

### Per-SKU Lock Tests (v3 NEU)

- Acquire lock 1: success
- Acquire lock 2 für same SKU (different process simulated): fail → return skipped
- Lock-Release im finally-Block: verify lock removed
- TTL expiry test: mock 30s+ → lock auto-expired → next acquire success
- Lock-value-check: nur owner kann release (verify)

### Redis-Outage-Fallback Tests (v3 NEU)

- Mock Redis-Client throws `ConnectionError` auf `get`/`set`
- Verify HealthService falls back auf in-memory-Map
- Verify log.warn fire (single-shot)
- Verify Admin-notification emitted
- Restore Redis: verify automatic re-sync (next read finds Redis state)

### Snapshot-Verifier Tests (v3 erweitert)

- **PRESERVE_FIELDS unchanged:** quantity changes, alle anderen Felder identisch → diff returns dataLossDetected=false
- **PRESERVE_FIELDS changed:** title verschwunden post-PUT → diff returns dataLossDetected=true, changedFields=['product.title']
- **groupIds changed:** SKU aus Multi-Variation Group entfernt → dataLossDetected=true (Risk #10)
- **quantity-mismatch:** PUT requested 3 aber post-GET zeigt 5 → quantityCorrect=false

### ESCALATE-Pfad Tests (v3 NEU)

- Beide strategies degraded → Selector returnt result mit `escalated=true`
- Verify Admin-Notification (createForAllAdmins) called
- Verify Email-Alert sent
- Verify Audit-Log `CHANNEL_LISTING_BULK_PAUSED_FALLBACK`

### Smoke-Tests nach Deploy (v3 erweitert)

| Test | Tool | Erwartung |
|---|---|---|
| Bootstrap | `scripts/smoke-bootstrap.ts` | Module DI inkl. 5 neue Services + Redis-Client resolved |
| Manual reconcile | `scripts/c15-4-trigger-reconcile-once.ts` | scanned=23, pushed=23, failed=0 (post-unpause) |
| Stock-state | `scripts/c15-5-verify-state.ts` | Alle 23 mit lastSyncedQuantity populated |
| eBay-state | `scripts/c15-5-verify-ebay-state.ts` | Alle 23 PUBLISHED, availableQuantity matcht DB |
| **Snapshot-Diff** | manuell SQL-query auf audit-log | 0 `CHANNEL_LISTING_DATA_DRIFT_DETECTED` rows in last 1h |
| **Health-State (Redis v3)** | `redis-cli GET ebay:strategy-health:bulk-update` | JSON-state mit isHealthy + cooldownUntil |
| **Lock-state (Redis v3)** | `redis-cli KEYS ebay:lock:sku:*` | Während Cron-Tick: vorhandene locks; sonst empty |
| Existing Tests | `pnpm test` | 1359/1359 + 7-9 neue C15.6-Tests grün |

### Spec-Sync-Disclosures (vor Implementation, analog C15.4)

Owner reviewt pro betroffenem Test:
- Existing tests die `bulk_update_price_quantity`-URL pinnen → entweder Strategy-A-Tests behalten ODER pin durch Selector-aware mock
- Existing tests die per-batch-shape assertieren → Strategy-A-Specific-Tests; Selector-Tests neu für orchestration
- Existing tests für 25-SKU-chunk → bleiben in Strategy A; Selector-Tests neu für per-SKU-iteration

Geschätzt: 5-7 Spec-Syncs (existing tests pinning bulk-only behavior) + **7-9 neue Tests** (2 Strategy-Tests + Selector + Verifier + Redis-Health + Probe + Lock + Outage-Fallback).

### Smoke-Tests nach Deploy (v2 erweitert)

| Test | Tool | Erwartung |
|---|---|---|
| Bootstrap | `scripts/smoke-bootstrap.ts` | Module DI inkl. 6 neue Services resolved |
| Manual reconcile | `scripts/c15-4-trigger-reconcile-once.ts` | scanned=23, pushed=23, failed=0 (post-unpause) |
| Stock-state | `scripts/c15-5-verify-state.ts` | Alle 23 mit lastSyncedQuantity populated |
| eBay-state | `scripts/c15-5-verify-ebay-state.ts` | Alle 23 PUBLISHED, availableQuantity matcht DB |
| **NEU: Snapshot-Diff** | manuell SQL-query auf audit-log | 0 `CHANNEL_LISTING_DATA_DRIFT_DETECTED` rows in last 1h |
| **NEU: Health-State** | manuell SQL audit-log query | bei recovery: `EBAY_ENDPOINT_HEALTH_RECOVERED` rows visible |
| Existing Tests | `pnpm test` | 1359/1359 + 6-10 neue C15.6-Tests grün |

### Spec-Sync-Disclosures (vor Implementation, analog C15.4)

Owner reviewt pro betroffenem Test:
- Existing tests die `bulk_update_price_quantity`-URL pinnen → entweder Strategy-A-Tests behalten ODER pin durch Selector-aware mock
- Existing tests die per-batch-shape assertieren → Strategy-A-Specific-Tests; Selector-Tests neu für orchestration
- Existing tests für 25-SKU-chunk → bleiben in Strategy A; Selector-Tests neu für per-SKU-iteration

Geschätzt: 5-7 Spec-Syncs (existing tests pinning bulk-only behavior) + 6-10 neue Tests (3 Strategy-Tests + Selector + Verifier + Health).

### Phase 5 — Reconcile + DB Consistency Verify (nach Deploy)

**Vor unpause:**
- Verify Production-deployed-Hash matcht local-Test-Hash
- Verify smoke-bootstrap auf Production ohne DI-Errors

**Unpause-Schritte (gestaffelt):**
1. Unpause 1 SKU (SCH-40 standalone) — verify als production-test
2. Unpause 12 SKUs (Multi-Variation-Group) — verify
3. Unpause 10 SKUs (T-Shirt) — verify

**Pro Stufe:**
- Smoke-trigger
- DB-verify alle unpaused listings haben `lastSyncedQuantity` populated
- eBay-verify availableQuantity matcht
- Sentry-fenster (5min) für 0 neue Errors

### Smoke-Tests nach Deploy

| Test | Tool | Erwartung |
|---|---|---|
| Bootstrap | `scripts/smoke-bootstrap.ts` | Module DI resolved successfully |
| Manual reconcile | `scripts/c15-4-trigger-reconcile-once.ts` | scanned=23 (post-unpause), pushed=23, failed=0 |
| Stock-state | `scripts/c15-5-verify-state.ts` | Alle 23 mit lastSyncedQuantity populated |
| eBay-state | `scripts/c15-5-verify-ebay-state.ts` | Alle 23 listings PUBLISHED, availableQuantity matcht DB |
| Existing Tests | `pnpm test` | 1359/1359 + 2-3 neue C15.6-Tests grün |

### Spec-Sync-Disclosures (vor Implementation)

Owner reviewt pro betroffenem Test (Pattern analog C15.4):
- Existing tests die `bulk_update_price_quantity`-URL pinnen → Sync auf `inventory_item/{sku}`
- Existing tests die `requests: [...]`-body-shape assertieren → Sync auf `availability.shipToLocationAvailability.quantity`
- Existing tests für 25-SKU-chunk-Verhalten → entfernen oder rephrase auf per-SKU-iteration

Geschätzt: 3-5 Spec-Syncs + 2-3 neue Tests (per-SKU success-path, per-SKU 4xx-fail, 429-rate-limit-handling).

---

## 7. Risk Assessment

### Risk 1: PUT-Endpoints auch broken
- **Wahrscheinlichkeit:** 🟢 niedrig (~5%)
- **Evidence:** publishOne nutzt PUT /inventory_item heute schon erfolgreich für initial-publish; Q3-Evidence (Owner-skipped) hätte das verifiziert; eBay's PUT-pattern ist seit Jahren stabil
- **Mitigation:** Phase 3 Single-SKU-Test isoliert dieses Risiko VOR production-deploy. Wenn PUT auch 500 wirft → STOP, kein Deploy, Rollback bereit.

### Risk 2: Rate-Limit Issues
- **Wahrscheinlichkeit:** 🟡 mittel (~20%)
- **Auswirkung:** 429 von eBay nach N Calls in T Sekunden. Bei 23 SKUs sequenziell ist das eher unwahrscheinlich (eBay's typical limit ist 5000 calls/day für inventory).
- **Mitigation:** Bestehender 429-handler bleibt. Optional: 100ms `sleep` zwischen PUT-calls (weniger als 50% rate-limit-budget belegen). Neue Tests verifizieren 429-Pfad weiterhin funktioniert.

### Risk 3: Price/Quantity Sync Mismatch
- **Wahrscheinlichkeit:** 🟢 niedrig (~5%)
- **Auswirkung:** PUT inventory_item könnte unbeabsichtigt andere Felder überschreiben (image, description, brand, etc.) wenn body-shape falsch.
- **Mitigation:** Body enthält NUR `availability.shipToLocationAvailability.quantity`. eBay's PUT-semantic ist "merge into existing inventory_item" (verifiziert via publishOne-Pattern). Phase 3 Single-SKU-Test verifiziert dass andere Felder unverändert bleiben (via getInventoryItem-pre/post-snapshot).

### Risk 4: Bug in neuem Code
- **Wahrscheinlichkeit:** 🟡 mittel (~25%)
- **Auswirkung:** Stock-Push-Service crashed oder schreibt falsche DB-state.
- **Mitigation:** 
  - Code-Review pro Implementation-Step
  - Test-Suite muss grün vor Deploy (1359 + 2-3 neue)
  - Bootstrap-Smoke pre-deploy (analog C13.3-Lehre)
  - Phase 3 Single-SKU isolated test
  - Rollback-Runbook bereit

### Risk 5: Race Conditions zwischen PUTs (nur falls Variante 2 / 2 PUTs)
- **Wahrscheinlichkeit:** 🟢 niedrig (~5%)
- **Auswirkung:** PUT inventory_item success aber PUT offer fail → Quantity in eBay-Daten inkonsistent.
- **Mitigation:** **Variante-1 (nur 1 PUT) gewählt → kein 2-Call-Race.** Wenn Owner Variante-2 will: sequenziell ausführen, bei mid-call-fail → DB-state als "partial" markieren (neuer status oder pauseReason). Aber **default ist Variante-1**.

### Risk 6: Partial State (1 von 2 PUTs fehlgeschlagen) — nur Variante 2
- **Wahrscheinlichkeit:** n/a (Variante-1 default)
- **Auswirkung:** n/a
- **Mitigation:** Variante-1 default eliminiert dieses Risiko strukturell.

### Risk 7: eBay-Support antwortet zwischenzeitlich + fixt bulk-Endpoint
- **Wahrscheinlichkeit:** 🟡 mittel (~30% innerhalb 1 Woche)
- **Auswirkung:** Wir haben uns von bulk auf per-SKU umgestellt — wenn bulk repariert ist, ist per-SKU "unnötig komplex" (~5-10× mehr API-calls).
- **Mitigation:** Code so strukturieren dass spätere Rückkehr zu bulk-Endpoint möglich ist via 1-line-Switch (z.B. ENV-Flag `EBAY_USE_BULK_QUANTITY_UPDATE`). Owner-Wahl ob ENV-Flag wert ist — im Plan **NICHT eingebaut** (YAGNI), aber als Future-Work dokumentiert.

### Risk 8: Performance — 23 sequenzielle calls
- **Wahrscheinlichkeit:** 🟢 niedrig (~5%)
- **Auswirkung:** Reconcile-tick dauert 9-15s statt <1s. Aber Cron-Schedule ist 15min — komfortabler Spielraum.
- **Mitigation:** None nötig. Bei zukünftigem Growth (>500 listings) → siehe Future-Work in C15.4 PLAN.md "Smart Batching".

### Risk 9 (NEU v2): PUT semantics may be REPLACE not MERGE
- **Wahrscheinlichkeit:** 🟡 mittel (~40%) — eBay Endpoint heißt `createOrReplaceInventoryItem`
- **Auswirkung:** PUT mit minimal-body würde alle anderen Felder (title, description, aspects, imageUrls, condition, packageWeight) auf Defaults zurücksetzen → Listing-Korruption
- **Mitigation (v2 strukturell ausgeschlossen):**
  - Strategy B (GetThenPut) liest **vollständigen** body via GET, modifiziert NUR `availability.shipToLocationAvailability.quantity`, sendet vollständig zurück
  - SnapshotVerifier prüft Pre/Post-Diff für ALLE PRESERVE_FIELDS — Daten-Verlust empirisch erkannt
  - Bei dataLossDetected: Strategy degraded → Selector versucht Strategy C
  - Phase 3 Single-SKU-Test verifiziert dieses Risiko mit 1 SKU vor production-deploy
- **Verbleibendes Restrisiko:** wenn ALLE 3 Strategien Replace-Semantik haben (sehr unwahrscheinlich, weil offer-Endpoint ein anderes Daten-Modell hat). Risk #12 covers das.

### Risk 10 (NEU v2): Multi-Variation Group Membership Preservation
- **Wahrscheinlichkeit:** 🟡 mittel (~30%) — H4-Befund (C15.5 PLAN.md): inventory_item.groupIds enthält orphaned reference auf eBay-internal cleaned-up group
- **Auswirkung:** Wenn Strategy B PUT inventory_item den groupIds-Array nicht preserved, wird SKU aus Multi-Variation-Listing entfernt → wieder genau das C15.5-Phase-A1-DELETE-Problem (aber ungewollt!)
- **Mitigation (v2 strukturell ausgeschlossen):**
  - Strategy B GET-then-PUT preserved den vollständigen body inkl. `groupIds` + `inventoryItemGroupKeys` Arrays
  - SnapshotVerifier `PRESERVE_FIELDS` enthält `groupIds` und `inventoryItemGroupKeys` — Diff-Check fängt Drift ab
  - Bei drift: Strategy degraded + audit-row CHANNEL_LISTING_DATA_DRIFT_DETECTED
- **Verbleibendes Restrisiko:** sehr klein — H4-Befund zeigte ohnehin dass Group-State unstable ist (eBay-internal cleanup), aber Listing-Membership ist Listing-side persistent

### Risk 11 (NEU v2): Race Condition GET-modify-PUT (Strategy B)
- **Wahrscheinlichkeit:** 🟢 niedrig (~5%) — Stock-mutations laufen via Cron (1 worker) + Listener (synchron pro request)
- **Auswirkung:** Wenn 2 parallel Updates für gleichen SKU laufen, könnte 2. PUT die Modifikation des 1. PUT überschreiben (lost-write)
- **Mitigation:**
  - Cron läuft alle 15min, single-instance — kein cross-cron-tick race
  - Listener-Pfad und Cron-Pfad teilen `pushForVariants` aber sequenzielle eBay-Calls pro SKU innerhalb eines Tick
  - Selector serialisiert per-SKU (`for (const c of toPush)` — kein Promise.all)
  - Bei Bedarf: optimistic-lock-Pattern via etag/lastModifiedAt-header (eBay sendet Last-Modified — könnte If-Unmodified-Since verwenden, aber für 23 listings overkill)
- **Restrisiko:** akzeptabel im Pre-launch / single-Cron-Setup

### Risk 12 (NEU v2): Alle 3 Strategien fail simultaneously
- **Wahrscheinlichkeit:** 🟢 niedrig (~3%) — würde komplett-broken eBay-Inventory-API bedeuten (sehr unwahrscheinlich Account-weit)
- **Auswirkung:** Stock-Push komplett down. Kein Workaround möglich.
- **Mitigation (v2):**
  - Selector erkennt `health.isAllDegraded()` → selbst-Pause aller listings via DB-update (status='paused', pauseReason='c156_all_strategies_degraded')
  - Audit-row CHANNEL_LISTING_BULK_PAUSED_FALLBACK
  - Admin-notification (createForAllAdmins) mit "ALL eBay endpoints failing — manual intervention needed"
  - Email an DTSupport@ebay.com (existing Owner-Pfad)
  - Smoke-trigger nach Recovery: HealthService probe-method resettet alle 3 strategies → fresh start

### Risk 13 (überarbeitet v3): Health-State Persistence — Redis Outage Fallback
- **Wahrscheinlichkeit:** 🟢 niedrig (~5%) — Upstash SLA 99.9%+, Redis ist resilient
- **Auswirkung:** Bei Redis-Outage degraded HealthService auf in-memory-Map (analog v2-Verhalten). Cold-start nach Restart kostet wieder ~45min Re-Discovery + 3 unnecessary failed eBay-calls.
- **Mitigation (v3 strukturell verbessert vs v2):**
  - **Primary:** Redis-persisted health-state übersteht Railway-Deploys + OOM-restarts → kein cold-start-spam
  - **Fallback:** Bei Redis-Read/Write-Fail wird `RedisOutage`-Flag gesetzt + log.warn + admin-notification
  - In-Memory-Map als Fallback aktiv solange Redis nicht erreichbar
  - Bei Redis-Recovery: nächster Read findet existing state (TTL noch nicht expired) — automatic re-sync
  - Cold-start-cost bei extended Redis-Outage akzeptabel (existing v2-Verhalten als sicherer Default)
- **Restrisiko:** sehr klein (Upstash hat eigene HA), begrenzt auf 45min worst-case wenn Redis komplett down

### Risk 14 (NEU v3): Redis Outage Impact
- **Wahrscheinlichkeit:** 🟢 niedrig (~5% — Upstash SLA 99.9%+)
- **Auswirkung:**
  - HealthService fällt auf in-memory zurück (siehe Risk #13)
  - Per-SKU-Lock fällt auf "lock-less" Mode → race-condition-Risiko zwischen GET und PUT (bei 1-Worker-Cron-Setup minimal, weil sequentielle Iteration)
  - Pro-SKU-state geht bei Redis-Outage + Restart verloren
- **Mitigation:**
  - Graceful degradation strukturell eingebaut (siehe HealthService-Pseudo-Code `handleRedisOutage`)
  - Log-warn + Admin-Alert bei erstem Redis-Outage-Error (single-fire, nicht spam)
  - Service läuft weiter, Feature-Coverage reduced aber funktional
  - Health-state-Recovery automatic wenn Redis zurück (TTL 24h, state nicht weg)
- **Worst-Case-Szenario:** Redis-Outage + Container-Restart + Bulk-still-broken → 3 unnecessary failed eBay-calls (gleicher cost wie v2-In-Memory). Akzeptabel.

### Risk 15 (NEU v3): Recovery Probe False-Positive
- **Wahrscheinlichkeit:** 🟡 mittel (~15%) — eBay-API kann transient-success-after-fail-pattern haben (intermittent issues während recovery-window)
- **Auswirkung:** Probe meldet success obwohl bulk-Endpoint immer noch instabil → Selector restored Strategy A → nächste production-calls schlagen fehl → re-degrade nach 3 failures (45min wasted + 3 unnecessary failed real-stock-pushes).
- **Mitigation (v3 strukturell):**
  - **2 consecutive probe-successes erforderlich** vor Restore (siehe HealthService.recordSuccess)
  - `probeSuccessCount` counter persistiert in Redis
  - Bei 1 success: counter=1, still degraded
  - Bei 2nd success: counter=2 → Restore
  - Bei zwischendurch fail: counter reset to 0 + extend cool-down zur next ladder rung
- **Probe-SKU-Selection:** dedicated canary-SKU (env-var `EBAY_CANARY_SKU`) → 0 production-stock-impact bei probe-versuchen
- **Restrisiko:** wenn eBay 2 consecutive successes liefert dann fail → automatic re-degrade nach 3 production-failures. Akzeptabel cost (45min × selten).

---

## 8. Success Criteria

### Nach Phase 4 (Deploy)
- ✅ `git log origin/main` zeigt C15.6-Commit als HEAD
- ✅ Railway-Auto-Deploy ACTIVE
- ✅ `Nest application successfully started` in Logs
- ✅ Bootstrap-Smoke clean (scripts/smoke-bootstrap.ts)
- ✅ 0 neue Sentry-Errors (5min-Beobachtungs-Fenster)
- ✅ Cron läuft autonom (nächster 15min-Tick) mit `scanned=0` (alle paused noch) ODER `scanned=N, pushed=N, failed=0` (falls Owner schon unpaused hat)

### Nach Phase 5 (Unpause + Verify)
- ✅ Alle 23 listings: `status='active'`, `lastSyncedQuantity` populated, `syncError=null`, `syncAttempts=0`
- ✅ eBay-API GET pro listing: `availableQuantity` matcht DB
- ✅ Listing 406893266945 zeigt eBay-Seller-Hub korrekte Stückzahl (statt frozen 23)
- ✅ Sentry: 0 neue Errors aus EbayStockPushService
- ✅ Cron-Logs: `scanned=23, pushed=23, failed=0` für mind. 1 Tick
- ✅ Idempotenz: nächster Tick mit unverändertem Stock = `scanned=23, pushed=0, skipped=23` (lastSyncedQuantity-match)

### DB Consistency Checks

```sql
-- Q1: Alle 23 listings im target-state?
SELECT
  COUNT(*) FILTER (WHERE status='active' AND last_synced_quantity IS NOT NULL AND sync_error IS NULL AND sync_attempts=0) AS healthy,
  COUNT(*) AS total
FROM channel_product_listings
WHERE channel='ebay' AND status='active';
-- Erwartet: healthy=23, total=23

-- Q2: Audit-trail: 0 CHANNEL_STOCK_PUSH_FAILED in last 1h
SELECT COUNT(*) FROM admin_audit_log
WHERE action='CHANNEL_STOCK_PUSH_FAILED'
  AND created_at > NOW() - INTERVAL '1 hour';
-- Erwartet: 0
```

---

## 9. Phase Breakdown

### Phase 1 — Plan (jetzt) — 15min
- ✅ `apps/api/docs/c15-6/PLAN.md` (this file)
- ✅ `apps/api/docs/c15-6/rollback-runbook.md`
- ⏸️ Owner-Review

### Phase 2 — Implementation — **2.5h (was 3h v2, v3 reduced — Strategy C entfernt)**
- Add **5 new files** (statt 6): 2 Strategies + Selector + Verifier + Redis-HealthService
- Add interface (StockUpdateStrategy)
- Modify `ebay-stock-push.service.ts:pushListings` — delegate to Selector
- Module-wiring: `ebay.module.ts` providers/exports erweitern (additive)
- Redis-Client Injection: existing Upstash service nutzen (kein neuer Provider)
- Update spec-syncs (5-7 existing tests pinning bulk-behavior)
- Add new tests (**7-9** statt 6-10): per-Strategy + Selector + Verifier + Redis-Health + Probe + Lock + Outage-Fallback
- TypeCheck + Lint clean
- 1359+ Tests grün (existing) + new tests
- Bootstrap-Smoke clean (verifies 5 new @Injectable services + Redis-client resolve)
- Owner-stdin-confirm vor commit

### Phase 3 — Single-SKU Live-Test — **35min (v3, +5min Recovery-Probe-Test)**
- Manual unpause SCH-40 standalone (1 SKU)
- **Pre-PUT GET-Snapshot capture** (full inventory_item body)
- Run smoke-trigger
- **Post-PUT GET-Snapshot capture**
- **Diff-Check kritisch:** PRESERVE_FIELDS (title, description, aspects, imageUrls, condition, packageWeightAndSize, groupIds) **MÜSSEN unverändert sein**
- Verify: scanned=1, pushed=1, failed=0, eBay availableQuantity=3
- Verify Redis-state: `ebay:strategy-health:get-then-put` zeigt isHealthy=true
- Verify Audit-Log zeigt welche Strategy verwendet wurde
- **Recovery-Probe-Test:** force bulk-degrade (3 mock failures) → wait cool-down-mock-expiry → trigger probe → verify counter increments korrekt
- Re-pause SCH-40 (zurück zu paused-state vor Phase 4)
- Bei data-loss erkannt: STOP, Strategy degraded, Selector versucht next strategy — wenn beide fail: ESCALATE

### Phase 4 — Deploy — 10min
- Atomic commit + push origin/main
- Railway-Auto-Deploy beobachten
- 5min Sentry/Logs-Fenster
- Erste post-deploy Cron-Tick: `scanned=0` (alle paused noch)

### Phase 5 — Unpause + Verify — 30min
- Stufe 5a (1 SKU SCH-40 standalone unpause + verify)
- Stufe 5b (12 Multi-Variation SKUs unpause + verify)
- Stufe 5c (10 T-Shirt SKUs unpause + verify)
- 5-Sichten-Verifikation pro Stufe (DB / Cron-Log / eBay-API / Sentry / Seller Hub)

---

## 10. Rollback Triggers

### Hard Triggers (sofort rollback)
- HTTP 500 / 4xx-Spike auf PUT-Endpoint nach Deploy
- Bootstrap-Smoke fail post-deploy
- DB-inconsistency entdeckt (Q1-Query: healthy < 23)
- Sentry-Error-Spike >5/min
- eBay state drift > 5% (mehr als 1 von 23 listings hat eBay-quantity ≠ DB-quantity)

### Soft Triggers (Owner-Konsultation)
- Performance-degradation (Reconcile-tick > 30s)
- Rate-limit hits (429 in <50% der Calls)
- eBay-Support antwortet + fixt bulk-Endpoint zwischenzeitlich (Owner-Wahl: rollback to bulk vs. behalten per-SKU)

### How to Rollback
Siehe `apps/api/docs/c15-6/rollback-runbook.md` für copy-paste-fertige Befehle.

---

---

## 11. Constraint Compliance (v2)

### Core Store: 0 Changes (verified)

| Modul | Touch in C15.6? | Verifikation |
|---|---|---|
| Orders | ❌ | grep `apps/api/src/modules/orders/` in C15.6-diff = 0 hits |
| Payments | ❌ | grep ebenfalls = 0 |
| Invoices | ❌ | 0 |
| Returns | ❌ | 0 |
| Refunds | ❌ | 0 |
| Reservations | ❌ | 0 |
| Inventory (core) | ❌ | 0 |
| Shipments | ❌ | 0 |
| Cart / Checkout | ❌ | 0 |
| Auth | ❌ | 0 |
| Admin (außer ebay-controller) | ❌ | 0 |

**Verifikations-Pflicht in Phase 4 (Diff-Review):** `git diff origin/main..HEAD --name-only | grep -v marketplaces/ebay` → muss leer sein (außer ggf. tests/spec).

### DB Schema: 0 Migrations (verified)

| Schema-Aspekt | Touch? |
|---|---|
| Neue Tabelle | ❌ |
| Neue Spalte | ❌ |
| Neuer Index | ❌ |
| Neuer Enum-Wert | ❌ |
| Migration-Datei | ❌ |

**Verifikations-Pflicht:** `prisma migrate diff` (Production vs branch) → 0 changes erwartet.

### Other Channels: 0 Impact (verified)

| Channel | Touch? |
|---|---|
| Facebook (Feed/Pixel) | ❌ |
| TikTok (Feed) | ❌ |
| Google Shopping (Feed) | ❌ |
| WhatsApp Catalog | ❌ |
| Pos (Shopify) | ❌ |
| Channels-Module Admin-Page | ❌ |
| FeedsService | ❌ |

**Verifikations-Pflicht:** ChannelStockPusher Interface bleibt unverändert. Future-other-channels können den Pattern adoptieren ohne breaking-change.

### Public APIs: 0 Breaking Changes (verified)

| API | Status |
|---|---|
| `POST /admin/marketplaces/ebay/publish-pending` | unchanged |
| `POST /admin/marketplaces/ebay/toggle-listing` | unchanged |
| `POST /admin/marketplaces/ebay/listings/:id/reset-sync` | unchanged |
| `GET /admin/marketplaces/ebay/listings` | unchanged |
| `GET /admin/marketplaces/ebay/pending-count` | unchanged |
| `POST /admin/marketplaces/ebay/disconnect` | unchanged |
| Webhook receivers (Account-Deletion, Order-Notification) | unchanged |

**Optional Neu (read-only, additive):** `GET /admin/marketplaces/ebay/health` — exposes EbayEndpointHealthService snapshot. Owner-Wahl ob in v2-Scope (nicht required für Funktionalität, hilfreich für Debugging).

### Tests: Hard-Rule Compliance

- Existing 1359 tests: UNANGEFASST außer notwendige spec-syncs für directly-touched Code
- Spec-Syncs: 5-7 (alle in `ebay-stock-push.service.spec.ts`, mit Disclosure-Format pro Test analog C15.4)
- Neue Tests: 6-10 in dedicated spec-files für neue Services (`bulk-update-strategy.spec.ts`, `get-then-put-strategy.spec.ts`, etc.)
- Test-Suite-Wachstum: ~1365-1370 total nach Phase 2

### File-Boundary Verifikation

```
apps/api/src/modules/marketplaces/ebay/  (TOUCH-ALLOWED)
├── ebay-stock-push.service.ts                        ← MODIFIED
├── ebay-stock-strategies/                            ← NEW folder
│   ├── stock-update-strategy.interface.ts            ← NEW
│   ├── bulk-update-strategy.ts                       ← NEW
│   ├── get-then-put-strategy.ts                      ← NEW
│   └── offer-update-strategy.ts                      ← NEW
├── ebay-stock-strategy-selector.ts                   ← NEW
├── ebay-snapshot-verifier.ts                         ← NEW
├── ebay-endpoint-health.service.ts                   ← NEW
├── ebay.module.ts                                    ← MODIFIED (additive providers)
└── __tests__/
    ├── ebay-stock-push.service.spec.ts               ← MODIFIED (spec-sync)
    ├── bulk-update-strategy.spec.ts                  ← NEW
    ├── get-then-put-strategy.spec.ts                 ← NEW
    ├── offer-update-strategy.spec.ts                 ← NEW
    ├── ebay-stock-strategy-selector.spec.ts          ← NEW
    ├── ebay-snapshot-verifier.spec.ts                ← NEW
    └── ebay-endpoint-health.service.spec.ts         ← NEW

apps/api/docs/c15-6/                                  (DOC-ALLOWED)
├── PLAN.md                                           ← MODIFIED (v2)
└── rollback-runbook.md                               ← MODIFIED (v2 if relevant)

EVERYTHING ELSE: ZERO TOUCH
```

---

## 12. Sustainability

### Auto-Recovery wenn eBay's bulk-Endpoint repariert wird (v3 — Konkret)

**Szenario:** eBay-Support fixt errorId 25001 nach 3 Tagen. Wie erkennt unser System?

**Mechanismus (v3 explizit):**

1. **Cool-Down-Ladder läuft ab** (1h → 4h → 12h → 24h je nach degrade-count)
2. **Selector-pickPrimary** erkennt: bulk-strategy degraded ABER cooldownUntil < now → eligible für **Probe**
3. **Probe-Attempt** mit dedicated canary-SKU (env-var `EBAY_CANARY_SKU` oder Fallback "SKU mit most-recent successful publish")
4. **Probe-Success** → counter=1 → noch nicht restored, aber Status "in-recovery"
5. **Nächster Cron-Tick (15min)** → wieder Probe → wenn 2nd success: counter=2 → **RESTORE**
   - isHealthy=true, cooldownUntil=null, counter reset
   - Audit-row `EBAY_ENDPOINT_HEALTH_RECOVERED`
6. **Production-Tick danach** wählt bulk-strategy als primary → API-Quota-Verbrauch sinkt von 3N (Strategy B) auf ceil(N/25) (Strategy A)

**Probe-Fail während Recovery-Window:**
- Counter reset to 0
- Cool-Down extend zur next ladder rung (1h → 4h → 12h → 24h)
- Audit-row `EBAY_ENDPOINT_PROBE_FAILED`
- System bleibt auf Strategy B (sicher)

**Zero downtime / zero manual code-rollback / zero env-toggle nötig** — System self-heals via Redis-persisted Cool-Down-Timer.

### Redis-Persistence Vorteile (v3 vs v2)

| Aspekt | v2 (In-Memory) | v3 (Redis) |
|---|---|---|
| Survive Railway-Deploy | ❌ cold-start re-discovery (~45min) | ✅ state persistiert |
| Unnecessary failed eBay-calls per deploy | 3 (production cost) | **0** |
| Cool-Down survives restart | ❌ resets, system probed bulk again | ✅ Cool-Down-Timer respected |
| Probe-counter survives restart | ❌ resets, 2-consecutive needs restart-time | ✅ counter persisted |
| Multi-instance support (future) | ❌ each instance has own state | ✅ shared Redis state |
| Operational overhead | 0 | 0 (Upstash already in stack) |

**v3 Redis-Persistence eliminiert v2-Risk-13 (Cold-Start-Spam) strukturell.**

### ESCALATE-Pfad bei All-Fail

Wenn beide Strategies degraded UND Cool-Downs nicht expired:

```
Selector.pickPrimary() returnt null
→ Selector.executeForSku() detected all-degraded
→ ESCALATE-Pfad:
   1. Listing self-pause (status='paused', pauseReason='c156_all_strategies_failed')
   2. Audit-row CHANNEL_LISTING_BULK_PAUSED_FALLBACK
   3. Admin-Notification (createForAllAdmins, type='ebay_stock_sync_escalation')
   4. Email-Alert an Owner (subject "C15.6 ESCALATE: All eBay stock-sync strategies failed")
      Body enthält: SKU-Liste, last-error, rlogids, Reference DTSupport@ebay.com
   5. Cron-Tick continues mit nächstem SKU (kein STOP — andere SKUs könnten vorher healthy gewesen sein)

Owner-Reaktion:
- Bei Single-SKU-ESCALATE: ggf. Listing-spezifischer Issue → check Audit-Log
- Bei Bulk-ESCALATE (alle 23 affected): account-weiter Issue → konsultiere Rollback-Runbook + DTSupport@ebay.com-Thread
```

### Wie neue Strategien hinzufügen

Pattern erweiterbar für zukünftige eBay-API-Änderungen:

```typescript
// 1. Neue Strategy-Klasse erstellen
@Injectable()
export class NewStrategy implements StockUpdateStrategy {
  readonly name = 'new_strategy' as const
  async execute(ctx) { /* ... */ }
}

// 2. Module-Wiring erweitern (1 line in ebay.module.ts providers)

// 3. EbayEndpointHealthService.constructor erweitern um neue strategy in state-Map

// 4. Selector-Order erweitern (1 line in pickPrimary + executeForSku)

// 5. Tests neu schreiben für neue strategy
```

**Kein Touch auf existing strategies erforderlich** — alle 4 (bulk + get_then_put + offer_update + new) koexistieren.

### Wie auf andere Endpoints erweitern

Pattern lässt sich für andere eBay-Operationen adoptieren:
- `publishProductGroup` (C15.5 Q-A2Y-3 out-of-scope) — gleicher Multi-Strategy-Pattern für `publish_by_inventory_item_group` vs. per-SKU `publish` calls
- `syncPrice` (separate von quantity) — eigene Strategy-Hierarchie via `OfferPriceUpdateStrategy`
- `syncListing-meta` (title, description updates) — eigene Strategy-Hierarchie

**Generic Pattern:** `<DomainOperation>Strategy` interface + `<DomainOperation>StrategySelector` orchestrator + `<DomainOperation>HealthService` per-domain. Wiederverwendbar für TikTok/Facebook/Google channels (Phase 3+).

### Wie auf Multi-Channel skalieren

Aktuell: `EbayEndpointHealthService` (eBay-spezifisch). Future-Refactoring (out-of-C15.6-Scope):

```typescript
// Generic ChannelHealthService<TChannel>
@Injectable()
export class ChannelHealthService {
  private states = new Map<`${Channel}:${StrategyName}`, HealthState>()
  recordSuccess(channel: Channel, strategy: StrategyName): void { /* ... */ }
}
```

Ermöglicht zukünftiges Health-Monitoring für TikTok/Facebook/Google ohne Service-Multiplikation.

### Operational Runbook Future-Integration

Bei Production-Issues post-C15.6:
1. Check Audit-Log für `EBAY_ENDPOINT_HEALTH_DEGRADED` events → welche Strategy ist degraded?
2. Check Sentry für errorId-pattern → welcher Endpoint failed?
3. Check `GET /admin/marketplaces/ebay/health` (falls implementiert) → live health snapshot
4. Manuell trigger reset wenn Owner glaubt eBay-side fix kam: `health.resetForProbe(<strategy>)` via admin-endpoint
5. Beobachte nächsten cron-tick (15min) für recovery-bestätigung

---

## v2 → v3 Diff-Summary

### Strukturelle Änderungen

| Aspekt | v2 | v3 |
|---|---|---|
| Anzahl Strategies | 3 (Bulk + GetThenPut + OfferUpdate) | **2** (Bulk + GetThenPut) + ESCALATE |
| Strategy C (OfferUpdate) | last-resort fallback | **ENTFERNT** (YAGNI + Replace-Flaw-Risiko) |
| Health-State Storage | In-Memory Map | **Redis (Upstash)** mit 24h-TTL |
| Cool-Down-Mechanismus | "alle 6h probe" (vage) | **Exponential Ladder 1h→4h→12h→24h** |
| Recovery-Probe | implicit | **Explizit mit canary-SKU + 2-consecutive-success** |
| Race-Condition-Mitigation | implicit "single-Cron" | **Explicit Per-SKU Lock (Redis NX, TTL 30s)** |
| All-Fail-Pfad | "Risk #12 mitigation" (vage) | **ESCALATE-Pfad explizit** (pause + admin-notify + email) |
| Anzahl neue Files | 6 | **5** (Strategy C entfernt) |
| Phase-2 Implementation | 3h | **2.5h** |
| Phase-3 Single-SKU-Test | 30min | **35min** (+Recovery-Probe-Test) |

### Risk-Assessment Updates

| Risk | v2 | v3 |
|---|---|---|
| #13 Health-State Persistence | "In-memory lost on restart, 45min cold-start" | **Redis-persisted, fallback in-memory mit graceful-degrade** |
| #14 (NEU v3) Redis-Outage Impact | n/a | 🟢 niedrig — Upstash SLA 99.9%+, fallback in-memory |
| #15 (NEU v3) Recovery-Probe False-Positive | n/a | 🟡 mittel — Mitigation: 2-consecutive-success required |

### Sustainability-Sektion Erweiterungen

- v2: "alle 6h probe" + "container-restart re-tests" (vage)
- v3: **konkrete Cool-Down-Ladder + canary-SKU + 2-consecutive-success + Redis-Persistence-Vorteile-Tabelle + ESCALATE-Pfad explicit**

### Eliminierte Risiken (v3 strukturell)

- v2-Risk-13 (Cold-Start-Spam 45min, 3 unnecessary failed eBay-calls per deploy) → **0 unnecessary calls per deploy in v3** (Redis-State persistiert)
- v2-Strategy-C-Replace-Flaw-Risiko → **eliminiert durch Strategy C removal**

---

## Owner-Review Anfrage (v3)

**Plan v3 bereit zur Review. Soll ich Phase 2 (Implementation) starten?**

v3-Änderungen vs v2:
- Section 3 ADR-3-v3: 2-Strategy + ESCALATE statt 3 Strategies
- Section 5: 5 neue Files (statt 6, Strategy C entfernt) + Redis-HealthService + Per-SKU-Lock + Probe-Mechanismus
- Section 6: + Cool-Down-Tests + Probe-Tests + Lock-Tests + Redis-Outage-Tests
- Section 7: Risk #13 überarbeitet, #14 + #15 neu (Redis-Outage + Probe-False-Positive)
- Section 9 Phase 2: 3h → 2.5h
- Section 12: Auto-Recovery konkretisiert mit Cool-Down-Ladder + Redis-Vorteile-Tabelle + ESCALATE-Pfad
- rollback-runbook.md updated (v3-Trigger + Redis-Health-State-Inspection-Commands)

Owner-Approval-Modus analog C15.4/C15.5:
- **A:** Direkter Single-Approval-Gate für komplette Phase 2 (~2.5h)
- **B:** 4-Block-Sequential-Review:
  - **Block 1:** Strategies (BulkUpdate + GetThenPut) + Interface
  - **Block 2:** Snapshot-Verifier + Redis-HealthService + Cool-Down-Ladder
  - **Block 3:** Selector + Per-SKU-Lock + Probe-Mechanismus + ESCALATE-Pfad + Stock-Push-Service-Integration + Module-Wiring
  - **Block 4:** Tests (5-7 spec-syncs + 7-9 neue Tests) + Bootstrap-Smoke + Pre-Push-Diff-Review

---

**End of C15.6 PLAN.md (v3)**
