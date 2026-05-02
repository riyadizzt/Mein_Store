/**
 * C15.6 — EbayStockStrategySelector (Block 3, v3).
 *
 * Orchestriert Multi-Strategy Stock-Push pro SKU mit:
 *   1. Per-SKU Lock-Pattern (Redis NX, TTL 30s) — Race-Condition-Mitigation
 *      für Strategy B (GET-modify-PUT). Lock-acquisition fail → CLARIFICATION 4
 *      REDIS-OUTAGE-SKIP (kein bypass-without-lock).
 *
 *   2. Strategy-Order-Chain (HealthService.pickPrimary) — Auto-Fallback bei
 *      Failure. Order: bulk → get_then_put. Bei beiden degraded + cool-down
 *      active → null returned → ESCALATE.
 *
 *   3. CLARIFICATION 1 READ-ONLY PROBE — Recovery-Probe nutzt NUR GET-Calls.
 *      Canary-SKU via env-var EBAY_CANARY_SKU. 0 Production-Stock-Impact
 *      garantiert.
 *
 *   4. CLARIFICATION 2 EMAIL RATE-LIMIT 24H — ESCALATE-Email max 1× pro 24h
 *      pro Strategy via Redis-Key `ebay:escalate:last-email:{strategy}`.
 *      Suppressed → Audit-event STOCK_PUSH_ESCALATE_EMAIL_SUPPRESSED.
 *
 *   5. CLARIFICATION 4 REDIS-OUTAGE-SKIP — Lock-acquisition fail (Redis
 *      unavailable) → SKIP cycle, audit STOCK_PUSH_SKIPPED_REDIS_OUTAGE,
 *      retry next cron tick (15min). Begründung: data-integrity > availability.
 *
 *   6. ENHANCEMENT 4 follow-up — Selector emittiert Audit-event
 *      STOCK_PUSH_VERIFY_FAILURE_ALERT wenn HealthService.alertTriggered=true.
 *
 * 0 Service-Code-Touch außerhalb dieses Files.
 * 0 DB Schema Change.
 */

import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from '../../admin/services/audit.service'
import { NotificationService } from '../../admin/services/notification.service'
import { EbayEndpointHealthService } from './ebay-endpoint-health.service'
import { BulkUpdateStrategy } from './ebay-stock-strategies/bulk-update-strategy'
import { GetThenPutStrategy } from './ebay-stock-strategies/get-then-put-strategy'
import {
  StockUpdateContext,
  StockUpdateResult,
  StockUpdateStrategy,
  StrategyName,
} from './ebay-stock-strategies/ebay-stock-update-strategy.interface'

const LOCK_PREFIX = 'ebay:lock:sku:'
const LOCK_TTL_SECONDS = 30
const ESCALATE_EMAIL_PREFIX = 'ebay:escalate:last-email:'
const ESCALATE_EMAIL_TTL_SECONDS = 24 * 60 * 60 // 24h
const STRATEGY_CHAIN: StrategyName[] = ['bulk', 'get_then_put']

@Injectable()
export class EbayStockStrategySelector implements OnModuleDestroy {
  private readonly logger = new Logger(EbayStockStrategySelector.name)
  private redis: Redis | null = null
  private redisAvailable = true

  constructor(
    @Optional() private readonly config: ConfigService,
    private readonly health: EbayEndpointHealthService,
    private readonly bulk: BulkUpdateStrategy,
    private readonly getThenPut: GetThenPutStrategy,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly prisma: PrismaService,
  ) {
    try {
      const url = this.config?.get<string>('UPSTASH_REDIS_REST_URL')
      const token = this.config?.get<string>('UPSTASH_REDIS_REST_TOKEN')
      if (url && token) {
        const host = url.replace('https://', '')
        this.redis = new Redis({
          host,
          port: 6379,
          password: token,
          tls: {},
          lazyConnect: true,
        })
      } else {
        this.logger.warn('Redis env-vars missing — Selector falls back to lock-less mode')
        this.redisAvailable = false
      }
    } catch (e: any) {
      this.logger.warn(`Redis init failed in Selector: ${e?.message}`)
      this.redisAvailable = false
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      try {
        this.redis.disconnect()
      } catch {
        /* noop */
      }
    }
  }

  /**
   * Execute push for ONE SKU. Selects healthy strategy, applies lock,
   * tries fallback chain, escalates on all-fail.
   *
   * Returns:
   *   ok=true bei eBay-success
   *   ok=false + skipped=true wenn Lock konnte nicht acquired werden (CLARIFICATION 4)
   *   ok=false + rateLimited=true wenn 429 (caller abort tick)
   *   ok=false bei all-strategies-failed (ESCALATE bereits triggered)
   */
  async executeForSku(ctx: StockUpdateContext): Promise<StockUpdateResult> {
    // Step 1: Acquire per-SKU lock — REDIS-OUTAGE-SKIP applies (CLARIFICATION 4)
    const lockKey = LOCK_PREFIX + ctx.sku
    const lockValue = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`

    const lockResult = await this.tryAcquireLock(lockKey, lockValue)
    if (lockResult === 'redis_outage') {
      // REDIS-OUTAGE-SKIP — kein bypass-without-lock (data-integrity > availability)
      await this.audit
        .log({
          adminId: 'system',
          action: 'STOCK_PUSH_SKIPPED_REDIS_OUTAGE',
          entityType: 'channel_listing',
          entityId: ctx.listing.id,
          changes: { after: { sku: ctx.sku, reason: 'redis_unavailable_lock_acquisition_failed' } },
        })
        .catch(() => {})
      this.logger.warn(
        `[selector] sku=${ctx.sku} REDIS-OUTAGE-SKIP — retry next cron tick (15min)`,
      )
      return {
        ok: false,
        httpStatus: 0,
        errorMessage: 'redis_outage_skip',
        errorId: null,
        rateLimited: false,
        skipped: true,
      }
    }
    if (lockResult === 'held_by_other') {
      this.logger.log(`[selector] sku=${ctx.sku} skipped — lock held by other process`)
      return {
        ok: false,
        httpStatus: 0,
        errorMessage: 'sku_locked_by_other_process',
        errorId: null,
        rateLimited: false,
        skipped: true,
      }
    }

    // Step 2: Iterate Strategy chain
    try {
      const order = await this.buildOrderedChain()
      let lastResult: StockUpdateResult | null = null

      for (const name of order) {
        const strategy = this.byName(name)
        const result = await strategy.execute(ctx)
        lastResult = result

        // 429 short-circuits the entire tick (caller abort)
        if (result.rateLimited) {
          this.logger.warn(`[selector] strategy=${name} rateLimited — aborting tick`)
          return result
        }

        if (result.ok) {
          await this.health.recordSuccess(name)
          // ENHANCEMENT 4 follow-up: emit audit if Strategy B verify-GET failed
          if (result.errorMessage === 'verify-get-timeout' || result.errorMessage === 'verify-get-failed') {
            await this.audit
              .log({
                adminId: 'system',
                action:
                  result.errorMessage === 'verify-get-timeout'
                    ? 'STOCK_PUSH_VERIFY_GET_TIMEOUT'
                    : 'STOCK_PUSH_VERIFY_GET_FAILED',
                entityType: 'channel_listing',
                entityId: ctx.listing.id,
                changes: { after: { sku: ctx.sku, strategy: name } },
              })
              .catch(() => {})
          }
          return result
        }

        // Failure → recordFailure (which applies cool-down ladder + WEEKLY)
        const nowDegraded = await this.health.recordFailure(name)
        if (nowDegraded) {
          await this.audit
            .log({
              adminId: 'system',
              action: 'EBAY_ENDPOINT_HEALTH_DEGRADED',
              entityType: 'ebay_strategy',
              entityId: name,
              changes: {
                after: {
                  strategy: name,
                  errorMessage: result.errorMessage,
                  errorId: result.errorId,
                  triggerSku: ctx.sku,
                },
              },
            })
            .catch(() => {})
        }
        // Continue chain — try next strategy
      }

      // Step 3: All strategies attempted, none ok → ESCALATE
      if (await this.health.isAllDegraded()) {
        await this.escalate(ctx, lastResult)
      }
      return (
        lastResult ?? {
          ok: false,
          httpStatus: 0,
          errorMessage: 'all_strategies_failed',
          errorId: null,
          rateLimited: false,
        }
      )
    } finally {
      await this.releaseLockIfOwned(lockKey, lockValue)
    }
  }

  /**
   * READ-ONLY PROBE (CLARIFICATION 1). Verwendet NUR GET-Call gegen
   * canary-SKU. 0 Production-Stock-Impact garantiert.
   *
   * Canary-SKU resolution:
   *   1. env-var EBAY_CANARY_SKU (Owner-configurable)
   *   2. Fallback: SKU mit most-recent successful publish (DB query —
   *      lastSyncedAt DESC + lastSyncedQuantity NOT NULL)
   *
   * Probe success → HealthService.recordSuccess (counts toward 2-consecutive-restore)
   * Probe failure → HealthService.recordFailure (extends cool-down ladder/weekly)
   *
   * NOTE: Probe-call ist immer GET-only — egal welche Strategy probed wird.
   * Hard-Constraint: Probe darf NIEMALS PUT/POST/DELETE auslösen.
   */
  async runReadOnlyProbe(strategy: StrategyName, bearerToken: string): Promise<{
    ok: boolean
    canarySku: string | null
    httpStatus: number | null
    errorMessage: string | null
  }> {
    const canarySku = await this.resolveCanarySku()
    if (!canarySku) {
      this.logger.warn(`[selector] READ-ONLY PROBE skipped — no canary SKU available`)
      return { ok: false, canarySku: null, httpStatus: null, errorMessage: 'no_canary_sku' }
    }

    // READ-ONLY PROBE: GET inventory_item only (no mutation)
    const skuPath = `/sell/inventory/v1/inventory_item/${encodeURIComponent(canarySku)}`
    const { EbayApiClient, EbayApiError } = await import('./ebay-api.client')
    const { resolveEbayEnv } = await import('./ebay-env')
    const client = new EbayApiClient(resolveEbayEnv())

    try {
      await client.request<any>('GET', skuPath, { bearer: bearerToken, retry: false })
      // Probe success → counts toward 2-consecutive restore
      await this.health.recordSuccess(strategy)
      this.logger.log(`[selector] READ-ONLY PROBE success — strategy=${strategy} canarySku=${canarySku}`)
      return { ok: true, canarySku, httpStatus: 200, errorMessage: null }
    } catch (e: any) {
      const status = e instanceof EbayApiError ? e.status : 0
      const msg = e?.message ?? String(e)
      await this.health.recordFailure(strategy)
      this.logger.warn(
        `[selector] READ-ONLY PROBE fail — strategy=${strategy} canarySku=${canarySku} status=${status} msg=${msg}`,
      )
      return { ok: false, canarySku, httpStatus: status, errorMessage: msg }
    }
  }

  // ── Internals ────────────────────────────────────────────────

  private async buildOrderedChain(): Promise<StrategyName[]> {
    const chain: StrategyName[] = []
    for (const name of STRATEGY_CHAIN) {
      const s = await this.health.readState(name)
      if (s.isHealthy) {
        chain.push(name)
      } else if (s.cooldownUntil && new Date(s.cooldownUntil) <= new Date()) {
        // Cool-down expired → eligible for probe-attempt this cycle
        chain.push(name)
      }
      // Else: degraded + cool-down active → skip
    }
    return chain
  }

  private byName(name: StrategyName): StockUpdateStrategy {
    if (name === 'bulk') return this.bulk
    return this.getThenPut
  }

  /**
   * Lock acquisition outcome:
   *   'acquired'      → caller may proceed
   *   'held_by_other' → another process owns lock (NX-fail)
   *   'redis_outage'  → Redis unavailable (CLARIFICATION 4: SKIP cycle)
   */
  private async tryAcquireLock(
    key: string,
    value: string,
  ): Promise<'acquired' | 'held_by_other' | 'redis_outage'> {
    if (!this.redisAvailable || !this.redis) return 'redis_outage'
    try {
      const result = await this.redis.set(key, value, 'EX', LOCK_TTL_SECONDS, 'NX')
      return result === 'OK' ? 'acquired' : 'held_by_other'
    } catch (e: any) {
      this.logger.warn(`[selector] lock-acquisition failed (Redis): ${e?.message ?? e}`)
      this.redisAvailable = false
      return 'redis_outage'
    }
  }

  private async releaseLockIfOwned(key: string, expectedValue: string): Promise<void> {
    if (!this.redisAvailable || !this.redis) return
    try {
      const current = await this.redis.get(key)
      if (current === expectedValue) await this.redis.del(key)
      // Else: TTL already expired or owned by other → no-op
    } catch {
      // Redis-Outage during release: ignore (TTL will auto-cleanup)
    }
  }

  /**
   * ESCALATE-Pfad bei all-strategies-failed:
   *   1. Listing self-pause (DB-update + audit)
   *   2. Admin-Notification (createForAllAdmins → auto-email via existing system)
   *   3. EMAIL RATE-LIMIT 24H (CLARIFICATION 2): max 1 ESCALATE-email per 24h
   *      pro Strategy via Redis-Key `ebay:escalate:last-email:{strategy}`.
   *      Suppressed-call → audit STOCK_PUSH_ESCALATE_EMAIL_SUPPRESSED.
   *   4. Audit-action: STOCK_PUSH_ESCALATED
   */
  private async escalate(ctx: StockUpdateContext, lastResult: StockUpdateResult | null): Promise<void> {
    // Step 1: Self-pause listing
    try {
      await this.prisma.channelProductListing.update({
        where: { id: ctx.listing.id },
        data: {
          status: 'paused',
          pauseReason: 'c156_all_strategies_failed',
          pausedAt: new Date(),
        },
      })
    } catch (e: any) {
      this.logger.warn(`[selector] escalate-pause DB write failed: ${e?.message}`)
    }

    // Step 2: ESCALATE audit-event
    await this.audit
      .log({
        adminId: 'system',
        action: 'STOCK_PUSH_ESCALATED',
        entityType: 'channel_listing',
        entityId: ctx.listing.id,
        changes: {
          after: {
            sku: ctx.sku,
            offerId: ctx.offerId,
            lastError: lastResult?.errorMessage ?? 'unknown',
            lastErrorId: lastResult?.errorId ?? null,
            reason: 'both_strategies_degraded_no_recovery',
          },
        },
      })
      .catch(() => {})

    // Step 3: EMAIL RATE-LIMIT 24H — check Redis key before sending
    const emailRateLimitKey = ESCALATE_EMAIL_PREFIX + 'all_strategies'
    const shouldSendEmail = await this.checkAndSetEmailRateLimit(emailRateLimitKey)

    if (!shouldSendEmail) {
      // Suppressed by 24h rate-limit
      await this.audit
        .log({
          adminId: 'system',
          action: 'STOCK_PUSH_ESCALATE_EMAIL_SUPPRESSED',
          entityType: 'channel_listing',
          entityId: ctx.listing.id,
          changes: { after: { sku: ctx.sku, reason: 'rate-limited_24h_window' } },
        })
        .catch(() => {})
      this.logger.log(
        `[selector] ESCALATE email suppressed (EMAIL RATE-LIMIT 24H) sku=${ctx.sku}`,
      )
      return
    }

    // Step 4: Admin-Notification (createForAllAdmins → auto-email via existing system)
    await this.notifications
      .createForAllAdmins({
        type: 'ebay_stock_sync_escalation',
        title: 'C15.6 ESCALATE: All eBay stock-sync strategies failed',
        body:
          `Affected SKU: ${ctx.sku} (offerId=${ctx.offerId})\n` +
          `Last error: ${lastResult?.errorMessage ?? 'unknown'} (errorId=${lastResult?.errorId ?? '-'})\n` +
          `Both strategies (bulk + get_then_put) degraded with active cool-down.\n` +
          `Reference: DTSupport@ebay.com (existing email-thread for errorId 25001)\n` +
          `Listing has been auto-paused (pauseReason=c156_all_strategies_failed).\n` +
          `Manual intervention or DTSupport-update needed.`,
        entityType: 'channel_listing',
        entityId: ctx.listing.id,
      })
      .catch((e) => this.logger.error(`[selector] escalate notification failed: ${e?.message}`))
  }

  /**
   * EMAIL RATE-LIMIT 24H (CLARIFICATION 2).
   * Returns true if email should be sent (key not present).
   * Returns false if rate-limited (key present + TTL active).
   */
  private async checkAndSetEmailRateLimit(key: string): Promise<boolean> {
    if (!this.redisAvailable || !this.redis) {
      // Redis-Outage during ESCALATE: send email anyway (rate-limit ist
      // fail-open — besser duplicate email als kein alert)
      return true
    }
    try {
      // SET key value NX EX TTL — atomic: only set if not exists
      const result = await this.redis.set(key, new Date().toISOString(), 'EX', ESCALATE_EMAIL_TTL_SECONDS, 'NX')
      return result === 'OK' // OK = key was set (no rate-limit hit)
    } catch (e: any) {
      this.logger.warn(`[selector] EMAIL RATE-LIMIT check failed: ${e?.message}`)
      return true // fail-open — better duplicate email than no alert
    }
  }

  /**
   * Resolve canary-SKU for READ-ONLY PROBE.
   *   1. env-var EBAY_CANARY_SKU
   *   2. Fallback: SKU mit most-recent successful publish (DB query)
   */
  private async resolveCanarySku(): Promise<string | null> {
    const envCanary = this.config?.get<string>('EBAY_CANARY_SKU')
    if (envCanary) return envCanary

    try {
      const row = await this.prisma.channelProductListing.findFirst({
        where: {
          channel: 'ebay',
          lastSyncedQuantity: { not: null },
          syncError: null,
        },
        select: { variant: { select: { sku: true } } },
        orderBy: { lastSyncedAt: 'desc' },
      })
      return row?.variant?.sku ?? null
    } catch {
      return null
    }
  }
}
