/**
 * C15.6 — EbayEndpointHealthService (Redis-based, v3).
 *
 * Tracks per-Strategy health-state in Redis (Upstash) für Multi-Strategy
 * Stock-Push (siehe Section 3 PLAN.md v3 + ADR-3-v3).
 *
 * Persistence:
 *   Redis-Keys:
 *     ebay:strategy-health:bulk-update             → JSON HealthState
 *     ebay:strategy-health:get-then-put            → JSON HealthState
 *     ebay:strategy-health:bulk-update:phase       → 'ladder' | 'weekly'
 *     ebay:strategy-health:get-then-put:phase      → 'ladder' | 'weekly'
 *     ebay:verify-failure:get-then-put             → counter (TTL 1h, ENHANCEMENT 4)
 *   TTL: 24h auto-cleanup für health-state-keys
 *
 * Cool-Down-Ladder (PLAN.md v3 Section 3):
 *   1st degrade in 24h-window → 1h cool-down
 *   2nd degrade               → 4h
 *   3rd degrade               → 12h
 *   4th+ degrade              → 24h
 *
 * WEEKLY PROBE PHASE (CLARIFICATION 3, Owner-Spec 2026-05-02):
 *   Nach 24h-rung erreicht → Phase wechselt zu "weekly"
 *   Probe alle 7 Tage statt nach Cool-Down-rung
 *   Weekly probe success → reset to ladder bottom (1h cool-down)
 *   Weekly probe fail → bleib in weekly phase
 *   Begründung: verhindert "stuck at 24h forever" wenn eBay nach 1+ Wochen fixen
 *
 * Recovery-Probe Pattern:
 *   2-consecutive probe-success required für Restore (Risk #15 mitigation)
 *   probeSuccessCount in HealthState
 *
 * Redis-Outage-Fallback:
 *   In-memory-Map als Fallback aktiv solange Redis nicht erreichbar
 *   Log-warn (single-fire) + admin-notification-hook
 *   Service läuft weiter mit cold-start-cost
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { StrategyName } from './ebay-stock-strategies/ebay-stock-update-strategy.interface'

const STRATEGY_NAMES: StrategyName[] = ['bulk', 'get_then_put']

const KEY_PREFIX = 'ebay:strategy-health:'
const VERIFY_FAILURE_PREFIX = 'ebay:verify-failure:'
const HEALTH_TTL_SECONDS = 24 * 60 * 60 // 24h auto-cleanup
const VERIFY_FAILURE_TTL_SECONDS = 60 * 60 // 1h sliding window for ENHANCEMENT 4
const VERIFY_FAILURE_ALERT_THRESHOLD = 5

// Cool-Down ladder in seconds (PLAN.md v3 Section 3)
const COOLDOWN_LADDER_SECONDS = [
  1 * 60 * 60,   // 1st: 1h
  4 * 60 * 60,   // 2nd: 4h
  12 * 60 * 60,  // 3rd: 12h
  24 * 60 * 60,  // 4th+: 24h
]
const WEEKLY_PROBE_INTERVAL_SECONDS = 7 * 24 * 60 * 60 // 7 days

const FAILURE_THRESHOLD_FOR_DEGRADE = 3
const PROBE_SUCCESS_THRESHOLD_FOR_RESTORE = 2

export type HealthPhase = 'ladder' | 'weekly'

export interface HealthState {
  failures: number
  lastFailureAt: string | null  // ISO
  isHealthy: boolean
  cooldownUntil: string | null  // ISO
  degradeCount24h: number
  probeSuccessCount: number
  /** WEEKLY PROBE PHASE — when 'weekly', cooldownUntil is 7d-window-end. */
  phase: HealthPhase
  /** Last weekly-probe-attempt (ISO). Used to throttle probes to 7d. */
  lastWeeklyProbeAt: string | null
}

@Injectable()
export class EbayEndpointHealthService implements OnModuleDestroy {
  private readonly logger = new Logger(EbayEndpointHealthService.name)
  private redis: Redis | null = null
  private redisAvailable = true
  private readonly fallbackState = new Map<StrategyName, HealthState>()

  constructor(private readonly config: ConfigService) {
    try {
      const url = this.config.get<string>('UPSTASH_REDIS_REST_URL')
      const token = this.config.get<string>('UPSTASH_REDIS_REST_TOKEN')
      if (url && token) {
        const host = url.replace('https://', '')
        this.redis = new Redis({ host, port: 6379, password: token, tls: {}, lazyConnect: true })
      } else {
        this.logger.warn('Redis env-vars missing — HealthService runs in-memory-only mode')
        this.redisAvailable = false
      }
    } catch (e: any) {
      this.logger.warn(`Redis init failed — fallback to in-memory: ${e?.message}`)
      this.redisAvailable = false
    }
    // Initialize fallback states
    for (const s of STRATEGY_NAMES) {
      this.fallbackState.set(s, this.defaultHealthState())
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

  /** Public for tests / reset-endpoints. */
  defaultHealthState(): HealthState {
    return {
      failures: 0,
      lastFailureAt: null,
      isHealthy: true,
      cooldownUntil: null,
      degradeCount24h: 0,
      probeSuccessCount: 0,
      phase: 'ladder',
      lastWeeklyProbeAt: null,
    }
  }

  async readState(strategy: StrategyName): Promise<HealthState> {
    if (!this.redisAvailable || !this.redis) return this.fallbackState.get(strategy) ?? this.defaultHealthState()
    try {
      const raw = await this.redis.get(KEY_PREFIX + strategy)
      if (!raw) return this.defaultHealthState()
      const parsed = JSON.parse(raw)
      return { ...this.defaultHealthState(), ...parsed }
    } catch (e: any) {
      this.handleRedisOutage(e)
      return this.fallbackState.get(strategy) ?? this.defaultHealthState()
    }
  }

  private async writeState(strategy: StrategyName, state: HealthState): Promise<void> {
    this.fallbackState.set(strategy, state)
    if (!this.redisAvailable || !this.redis) return
    try {
      await this.redis.set(KEY_PREFIX + strategy, JSON.stringify(state), 'EX', HEALTH_TTL_SECONDS)
    } catch (e: any) {
      this.handleRedisOutage(e)
    }
  }

  /**
   * Record a successful eBay-call for this strategy.
   *
   * Recovery-Pattern: 2-consecutive probe-successes required für Restore
   * (Risk #15 — guards gegen False-Positive recovery wenn eBay-API
   * intermittent während recovery-window).
   */
  async recordSuccess(strategy: StrategyName): Promise<void> {
    const s = await this.readState(strategy)
    const wasUnhealthy = !s.isHealthy

    if (wasUnhealthy) {
      s.probeSuccessCount = (s.probeSuccessCount ?? 0) + 1
      if (s.probeSuccessCount >= PROBE_SUCCESS_THRESHOLD_FOR_RESTORE) {
        // Restore — back to healthy + ladder bottom
        s.isHealthy = true
        s.cooldownUntil = null
        s.probeSuccessCount = 0
        s.failures = 0
        s.degradeCount24h = 0
        s.phase = 'ladder'
        this.logger.log(`[health] Strategy ${strategy} RESTORED after 2 consecutive probe-success`)
      }
    } else {
      // Healthy strategy reporting success — reset failure counter
      s.failures = 0
    }
    await this.writeState(strategy, s)
  }

  /**
   * Record a failed eBay-call.
   *
   * Returns true if this failure caused a transition to degraded.
   *
   * Failure-tracking:
   *   - Increment failures-counter
   *   - 3 consecutive failures → degrade + apply Cool-Down-Ladder (if phase='ladder')
   *   - In WEEKLY phase: failure → extend lastWeeklyProbeAt (no ladder progression)
   *   - Reset probeSuccessCount on any failure
   */
  async recordFailure(strategy: StrategyName): Promise<boolean> {
    const s = await this.readState(strategy)
    s.failures++
    s.lastFailureAt = new Date().toISOString()
    s.probeSuccessCount = 0  // ANY failure resets probe-success counter

    let nowDegraded = false

    if (s.isHealthy && s.failures >= FAILURE_THRESHOLD_FOR_DEGRADE) {
      // First-time degrade transition
      s.isHealthy = false
      s.degradeCount24h = 1
      s.phase = 'ladder'
      s.cooldownUntil = this.computeLadderCooldownUntil(s.degradeCount24h)
      nowDegraded = true
      this.logger.warn(
        `[health] Strategy ${strategy} DEGRADED — ladder rung 1, cooldown until ${s.cooldownUntil}`,
      )
    } else if (!s.isHealthy && s.phase === 'ladder' && s.failures >= FAILURE_THRESHOLD_FOR_DEGRADE) {
      // Re-degrade during ladder phase — climb the ladder
      s.degradeCount24h++
      s.failures = 0  // reset for next rung
      const reachedTop = s.degradeCount24h > COOLDOWN_LADDER_SECONDS.length
      if (reachedTop) {
        // WEEKLY PROBE PHASE — switch to weekly probe pattern
        s.phase = 'weekly'
        s.lastWeeklyProbeAt = new Date().toISOString()
        s.cooldownUntil = new Date(Date.now() + WEEKLY_PROBE_INTERVAL_SECONDS * 1000).toISOString()
        this.logger.warn(
          `[health] Strategy ${strategy} entered WEEKLY PROBE PHASE — next probe ${s.cooldownUntil}`,
        )
      } else {
        s.cooldownUntil = this.computeLadderCooldownUntil(s.degradeCount24h)
        this.logger.warn(
          `[health] Strategy ${strategy} ladder-rung ${s.degradeCount24h} — cooldown ${s.cooldownUntil}`,
        )
      }
    } else if (!s.isHealthy && s.phase === 'weekly') {
      // WEEKLY PROBE PHASE — failure during weekly probe → extend probe-window
      s.failures = 0
      s.lastWeeklyProbeAt = new Date().toISOString()
      s.cooldownUntil = new Date(Date.now() + WEEKLY_PROBE_INTERVAL_SECONDS * 1000).toISOString()
      this.logger.warn(
        `[health] Strategy ${strategy} WEEKLY PROBE failed — next probe in 7 days (${s.cooldownUntil})`,
      )
    }

    await this.writeState(strategy, s)
    return nowDegraded
  }

  /**
   * ENHANCEMENT 4 — Verify-GET Failure Tracking.
   *
   * Records non-blocking verify-GET failure (PUT was successful, but post-GET
   * verify failed). Counter persists in Redis with 1h sliding window.
   * If counter > VERIFY_FAILURE_ALERT_THRESHOLD (5) → returns true to caller
   * (caller emits admin-alert).
   */
  async recordVerifyFailure(strategy: StrategyName): Promise<{
    count: number
    alertTriggered: boolean
  }> {
    if (!this.redisAvailable || !this.redis) {
      // In-memory fallback — track via a simple counter (per-process, lost on restart)
      // Acceptable since this is alert-triggering metric, not state-of-truth.
      return { count: 1, alertTriggered: false }
    }
    try {
      const key = VERIFY_FAILURE_PREFIX + strategy
      // FIXED-WINDOW (not sliding) — TTL set only on first INCR.
      // Post-MVP enhancement: refresh TTL on every increment for true
      // sliding window (Owner-Concern-1 Block-2-Approval 2026-05-02).
      const count = await this.redis.incr(key)
      if (count === 1) await this.redis.expire(key, VERIFY_FAILURE_TTL_SECONDS)
      return {
        count,
        alertTriggered: count > VERIFY_FAILURE_ALERT_THRESHOLD,
      }
    } catch (e: any) {
      this.handleRedisOutage(e)
      return { count: 0, alertTriggered: false }
    }
  }

  /**
   * Pick primary strategy based on health-state.
   *
   * Order: bulk → get_then_put.
   * Skip degraded strategies UNLESS cool-down expired (eligible for probe).
   * Returns null when both strategies degraded with active cool-down → ESCALATE.
   *
   * In WEEKLY phase: probe nur wenn lastWeeklyProbeAt > 7 days ago.
   */
  async pickPrimary(): Promise<StrategyName | null> {
    const now = Date.now()
    for (const name of STRATEGY_NAMES) {
      const s = await this.readState(name)
      if (s.isHealthy) return name
      // Degraded — check if probe-eligible
      if (s.cooldownUntil && new Date(s.cooldownUntil).getTime() <= now) {
        return name
      }
    }
    return null  // ESCALATE
  }

  async isAllDegraded(): Promise<boolean> {
    for (const name of STRATEGY_NAMES) {
      const s = await this.readState(name)
      if (s.isHealthy) return false
      // Degraded but cool-down expired → still considered "available" (eligible for probe)
      if (s.cooldownUntil && new Date(s.cooldownUntil) <= new Date()) return false
    }
    return true
  }

  /**
   * Manual-Reset for owner (admin endpoint optional).
   * Clears health-state — next call will treat strategy as fresh-healthy.
   */
  async resetForProbe(strategy: StrategyName): Promise<void> {
    await this.writeState(strategy, this.defaultHealthState())
    this.logger.log(`[health] Strategy ${strategy} manually reset to default-healthy state`)
  }

  /** For tests + admin-endpoint read-only snapshot. */
  async snapshotAll(): Promise<Record<StrategyName, HealthState>> {
    const result: Partial<Record<StrategyName, HealthState>> = {}
    for (const name of STRATEGY_NAMES) {
      result[name] = await this.readState(name)
    }
    return result as Record<StrategyName, HealthState>
  }

  // ── Internals ────────────────────────────────────────────────

  private computeLadderCooldownUntil(degradeRung: number): string {
    const ladderIndex = Math.min(degradeRung - 1, COOLDOWN_LADDER_SECONDS.length - 1)
    const cooldownSecs = COOLDOWN_LADDER_SECONDS[ladderIndex]
    return new Date(Date.now() + cooldownSecs * 1000).toISOString()
  }

  private handleRedisOutage(error: any): void {
    if (this.redisAvailable) {
      this.redisAvailable = false
      this.logger.warn(
        `[health] Redis unavailable — falling back to in-memory state. error=${error?.message ?? error}`,
      )
      // Fire-and-forget admin-notification hook (optional, owner via existing system)
    }
  }
}
