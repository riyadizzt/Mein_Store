/**
 * C15.6 Tests — EbayEndpointHealthService.
 *
 * Coverage:
 *  - Cool-down ladder progression (1h → 4h → 12h → 24h)
 *  - WEEKLY PROBE PHASE transition (CLARIFICATION 3)
 *  - Recovery via 2-consecutive probe-success (Risk #15 mitigation)
 *  - Probe-fail resets success counter (Risk #15 strict)
 *  - Verify-failure tracking (alertTriggered=true at >5/h)
 *  - Redis-Outage fallback to in-memory
 */

import { ConfigService } from '@nestjs/config'
import { EbayEndpointHealthService } from '../ebay-endpoint-health.service'

// In-Memory Redis mock — captures all SET/GET/INCR/EXPIRE calls
class FakeRedis {
  store = new Map<string, string>()
  ttls = new Map<string, number>()
  failNext = false

  async get(key: string): Promise<string | null> {
    if (this.failNext) {
      this.failNext = false
      throw new Error('redis-outage')
    }
    return this.store.get(key) ?? null
  }
  async set(key: string, value: string, _exFlag?: string, _ex?: number): Promise<'OK' | null> {
    if (this.failNext) {
      this.failNext = false
      throw new Error('redis-outage')
    }
    this.store.set(key, value)
    if (typeof _ex === 'number') this.ttls.set(key, _ex)
    return 'OK'
  }
  async incr(key: string): Promise<number> {
    if (this.failNext) {
      this.failNext = false
      throw new Error('redis-outage')
    }
    const cur = parseInt(this.store.get(key) ?? '0', 10)
    const next = cur + 1
    this.store.set(key, String(next))
    return next
  }
  async expire(key: string, ttl: number): Promise<number> {
    this.ttls.set(key, ttl)
    return 1
  }
  disconnect() {}
}

function buildService(): { svc: EbayEndpointHealthService; fake: FakeRedis } {
  const fake = new FakeRedis()
  // Use config that returns env vars so service tries Redis init.
  const config = {
    get: (k: string) => {
      if (k === 'UPSTASH_REDIS_REST_URL') return 'https://fake'
      if (k === 'UPSTASH_REDIS_REST_TOKEN') return 'fake-token'
      return undefined
    },
  } as unknown as ConfigService
  const svc = new EbayEndpointHealthService(config)
  // Inject fake redis (override the real one)
  ;(svc as any).redis = fake
  ;(svc as any).redisAvailable = true
  return { svc, fake }
}

describe('EbayEndpointHealthService', () => {
  it('Cool-Down Ladder: 1st degrade → 1h cooldown', async () => {
    const { svc } = buildService()

    // 3 failures = degrade
    await svc.recordFailure('bulk')
    await svc.recordFailure('bulk')
    const degraded = await svc.recordFailure('bulk')

    expect(degraded).toBe(true)
    const state = await svc.readState('bulk')
    expect(state.isHealthy).toBe(false)
    expect(state.degradeCount24h).toBe(1)
    expect(state.cooldownUntil).not.toBeNull()
    // Cooldown ~1h from now
    const cooldownMs = new Date(state.cooldownUntil!).getTime() - Date.now()
    expect(cooldownMs).toBeGreaterThan(55 * 60 * 1000) // > 55min
    expect(cooldownMs).toBeLessThanOrEqual(60 * 60 * 1000 + 1000) // ≤ 1h+buffer
    expect(state.phase).toBe('ladder')
  })

  it('Cool-Down Ladder: 4th-rung re-degrade enters WEEKLY PROBE PHASE', async () => {
    const { svc } = buildService()
    // Climb ladder by 4 cycles of (3 failures = degrade)
    for (let cycle = 1; cycle <= 4; cycle++) {
      await svc.recordFailure('bulk')
      await svc.recordFailure('bulk')
      await svc.recordFailure('bulk')
    }
    // 5th cycle pushes overflow → WEEKLY
    await svc.recordFailure('bulk')
    await svc.recordFailure('bulk')
    await svc.recordFailure('bulk')

    const state = await svc.readState('bulk')
    expect(state.phase).toBe('weekly')
    expect(state.lastWeeklyProbeAt).not.toBeNull()
    // Cooldown ~7 days
    const cooldownMs = new Date(state.cooldownUntil!).getTime() - Date.now()
    expect(cooldownMs).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000)
  })

  it('Recovery via 2-consecutive probe-success (Risk #15)', async () => {
    const { svc } = buildService()
    // Force degrade
    await svc.recordFailure('bulk')
    await svc.recordFailure('bulk')
    await svc.recordFailure('bulk')

    // 1st success → still degraded (counter=1, not enough)
    await svc.recordSuccess('bulk')
    let state = await svc.readState('bulk')
    expect(state.isHealthy).toBe(false)
    expect(state.probeSuccessCount).toBe(1)

    // 2nd consecutive success → restore
    await svc.recordSuccess('bulk')
    state = await svc.readState('bulk')
    expect(state.isHealthy).toBe(true)
    expect(state.cooldownUntil).toBeNull()
    expect(state.probeSuccessCount).toBe(0)
    expect(state.degradeCount24h).toBe(0)
  })

  it('Risk #15 strict: any failure resets probeSuccessCount', async () => {
    const { svc } = buildService()
    // Degrade
    await svc.recordFailure('bulk')
    await svc.recordFailure('bulk')
    await svc.recordFailure('bulk')
    // 1st probe success
    await svc.recordSuccess('bulk')
    let state = await svc.readState('bulk')
    expect(state.probeSuccessCount).toBe(1)
    // Failure interrupts recovery
    await svc.recordFailure('bulk')
    state = await svc.readState('bulk')
    expect(state.probeSuccessCount).toBe(0) // reset
  })

  it('verify-failure tracking: alertTriggered=true at >5/h', async () => {
    const { svc } = buildService()
    let last
    for (let i = 0; i < 6; i++) {
      last = await svc.recordVerifyFailure('get_then_put')
    }
    expect(last!.count).toBe(6)
    expect(last!.alertTriggered).toBe(true)
  })

  it('Redis-Outage falls back to in-memory state', async () => {
    const { svc, fake } = buildService()
    // Simulate Redis-Outage on next read
    fake.failNext = true
    const state = await svc.readState('bulk') // should NOT throw
    expect(state.isHealthy).toBe(true) // default-state from in-memory fallback
    expect((svc as any).redisAvailable).toBe(false)
  })
})
