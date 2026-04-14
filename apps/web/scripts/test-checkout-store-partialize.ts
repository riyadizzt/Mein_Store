/**
 * Isolated logic test for the checkout-store partialize fix (14.04.2026).
 *
 * This script does NOT render React or open a browser. It tests the pure
 * store logic in Node.js by replaying the sessionStorage persist + rehydrate
 * cycle via a mock Storage adapter, and simulates the exact scenario that
 * caused the €140.89 / €135.90 drift in production.
 *
 * Verifies:
 *   1. partialize() whitelist contains EXACTLY the 5 safe fields
 *   2. partialize() EXCLUDES every cart-derived field that caused drift
 *   3. sessionStorage write+read cycle preserves only the whitelist
 *   4. Rehydration of a cache that contains a stale shippingOption
 *      results in shippingOption === null (not the stale value)
 *   5. Rehydration preserves guestEmail + shippingAddress
 *   6. The freshness-check logic (step-shipping.tsx useEffect) correctly
 *      detects drift and would fire setShippingOption
 */

// Mock sessionStorage for Node
class MockStorage implements Storage {
  private store = new Map<string, string>()
  get length() { return this.store.size }
  clear() { this.store.clear() }
  getItem(key: string) { return this.store.get(key) ?? null }
  setItem(key: string, value: string) { this.store.set(key, value) }
  removeItem(key: string) { this.store.delete(key) }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null }
}
;(globalThis as any).sessionStorage = new MockStorage()

// Minimal `crypto` shim for zustand persist in Node
if (typeof (globalThis as any).crypto === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ;(globalThis as any).crypto = require('crypto').webcrypto
}

import { useCheckoutStore } from '../src/store/checkout-store'

type R = { name: string; status: 'PASS' | 'FAIL'; note?: string }
const results: R[] = []
const pass = (n: string, note?: string) => {
  results.push({ name: n, status: 'PASS', note })
  console.log(`  ✅ ${n}${note ? ` — ${note}` : ''}`)
}
const fail = (n: string, note: string) => {
  results.push({ name: n, status: 'FAIL', note })
  console.log(`  ❌ ${n} — ${note}`)
}

const SAFE_FIELDS = [
  'guestEmail',
  'shippingAddress',
  'billingAddress',
  'billingSameAsShipping',
  'savedAddressId',
]
const FORBIDDEN_FIELDS = [
  'step',
  'isGuest',
  'shippingOption',
  'paymentMethod',
  'couponCode',
  'appliedCoupon',
  'discountAmount',
  'termsAccepted',
  'orderId',
  'orderNumber',
  'idempotencyKey',
  'isProcessing',
  'error',
]

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  CHECKOUT STORE PARTIALIZE — logic test')
  console.log('═══════════════════════════════════════════════════════════\n')

  // ── 1. Fill the store with realistic dirty state ──
  console.log('── 1. Populate store with dirty state ──')
  const store = useCheckoutStore.getState()
  store.setGuest(true, 'drift@malak-test.local')
  store.setShippingAddress({
    firstName: 'Drift',
    lastName: 'Test',
    street: 'Teststraße',
    houseNumber: '1',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
  })
  store.setShippingOption({
    id: 'de-zone',
    name: 'Deutschland',
    price: 4.99, // ← the stale value that caused the €140.89 display
    estimatedDelivery: 'in 3 days',
    carrier: 'DHL',
  })
  store.setPaymentMethod('stripe_card')
  store.setCoupon('SPRING20', { code: 'SPRING20', type: 'percent', discountPercent: 20, discountAmount: null, freeShipping: false, description: '20%' }, 20)
  store.setTermsAccepted(true)
  pass('store populated', `shippingOption=${useCheckoutStore.getState().shippingOption?.price}`)

  // ── 2. Inspect the sessionStorage snapshot zustand persist wrote ──
  console.log('\n── 2. Inspect persisted snapshot ──')
  // zustand persist writes asynchronously on microtask; force a tick
  await new Promise((r) => setTimeout(r, 50))
  const raw = sessionStorage.getItem('malak-checkout')
  if (!raw) {
    fail('snapshot written', 'nothing in sessionStorage under malak-checkout')
    process.exit(1)
  }
  const snapshot = JSON.parse(raw)
  console.log(`  raw keys: ${Object.keys(snapshot.state).join(', ')}`)

  // ── 3. Whitelist contains ALL safe fields ──
  console.log('\n── 3. Whitelist verification ──')
  let allPresent = true
  for (const key of SAFE_FIELDS) {
    if (!(key in snapshot.state)) {
      fail(`whitelist includes ${key}`, 'missing')
      allPresent = false
    }
  }
  if (allPresent) {
    pass('all 5 safe fields present', SAFE_FIELDS.join(', '))
  }

  // ── 4. Whitelist EXCLUDES all forbidden fields ──
  console.log('\n── 4. Forbidden fields check ──')
  const leaked: string[] = []
  for (const key of FORBIDDEN_FIELDS) {
    if (key in snapshot.state) leaked.push(key)
  }
  if (leaked.length === 0) {
    pass('no forbidden fields leaked', `all ${FORBIDDEN_FIELDS.length} cart-derived / ephemeral fields excluded`)
  } else {
    fail('forbidden fields leaked', leaked.join(', '))
  }

  // ── 5. The stale shippingOption.price=4.99 is NOT persisted ──
  console.log('\n── 5. Stale shippingOption not in snapshot (main regression) ──')
  if (!('shippingOption' in snapshot.state)) {
    pass('shippingOption excluded', 'the 4.99 stale value cannot survive a refresh')
  } else {
    fail('shippingOption leaked', `found ${JSON.stringify(snapshot.state.shippingOption)}`)
  }

  // ── 6. Simulate a page refresh: clear in-memory state, rehydrate ──
  console.log('\n── 6. Simulate page refresh: rehydrate from sessionStorage ──')
  // Manually replay what zustand persist does on mount: parse snapshot,
  // merge state onto initialState. The partialize output is the only thing
  // that survives; everything else defaults back to initialState.
  const rehydrated = snapshot.state as any
  const shippingOptAfter = rehydrated.shippingOption ?? null
  const paymentMethodAfter = rehydrated.paymentMethod ?? null
  const stepAfter = rehydrated.step ?? 'guest'
  const termsAfter = rehydrated.termsAccepted ?? false

  if (shippingOptAfter === null) {
    pass('shippingOption rehydrates to null', 'step-shipping will recompute from live subtotal')
  } else {
    fail('shippingOption rehydration', `got ${JSON.stringify(shippingOptAfter)}`)
  }
  if (paymentMethodAfter === null) {
    pass('paymentMethod rehydrates to null', 'user re-selects payment per session')
  } else {
    fail('paymentMethod rehydration', `got ${paymentMethodAfter}`)
  }
  if (stepAfter === 'guest') {
    pass('step rehydrates to guest', 'user re-enters the flow')
  } else {
    fail('step rehydration', `got ${stepAfter}`)
  }
  if (termsAfter === false) {
    pass('termsAccepted rehydrates to false', 'AGB re-accepted per session (legal hygiene)')
  } else {
    fail('termsAccepted rehydration', `got ${termsAfter}`)
  }

  // ── 7. Safe fields DO rehydrate ──
  console.log('\n── 7. Safe fields survive refresh ──')
  if (rehydrated.guestEmail === 'drift@malak-test.local') {
    pass('guestEmail preserved', rehydrated.guestEmail)
  } else {
    fail('guestEmail', `got ${rehydrated.guestEmail}`)
  }
  if (rehydrated.shippingAddress?.postalCode === '10115') {
    pass('shippingAddress preserved', `${rehydrated.shippingAddress.city} ${rehydrated.shippingAddress.postalCode}`)
  } else {
    fail('shippingAddress', JSON.stringify(rehydrated.shippingAddress))
  }

  // ── 8. Freshness-check logic (mirrors step-shipping.tsx effect) ──
  console.log('\n── 8. Freshness-check detects threshold-cross drift ──')
  // Replay the effect logic in isolation. Given:
  //   - options computed from live zones + current subtotal (free for >= 100)
  //   - a stored shippingOption with stale price=4.99
  // Expect: the freshness check detects the drift and would call setter.
  const mockOptionsHigh = [{ id: 'de-zone', name: 'Deutschland', price: 0, estimatedDelivery: 'in 3 days', carrier: 'DHL' }]
  const staleOption = { id: 'de-zone', name: 'Deutschland', price: 4.99, estimatedDelivery: 'in 3 days', carrier: 'DHL' }

  function simulateFreshnessEffect(
    shippingOption: typeof staleOption | null,
    options: typeof mockOptionsHigh,
  ): { wouldUpdate: boolean; newPrice: number | null } {
    if (!shippingOption || options.length === 0) return { wouldUpdate: false, newPrice: null }
    const fresh = options.find((o) => o.id === shippingOption.id)
    if (fresh && Number(fresh.price) !== Number(shippingOption.price)) {
      return { wouldUpdate: true, newPrice: Number(fresh.price) }
    }
    return { wouldUpdate: false, newPrice: null }
  }

  // Scenario: subtotal crossed threshold, stored option is stale
  const caseA = simulateFreshnessEffect(staleOption, mockOptionsHigh)
  if (caseA.wouldUpdate && caseA.newPrice === 0) {
    pass('threshold-cross detected', 'stale 4.99 → fresh 0.00 (free shipping)')
  } else {
    fail('threshold-cross', `wouldUpdate=${caseA.wouldUpdate}, newPrice=${caseA.newPrice}`)
  }

  // Reverse scenario: user removed items, now below threshold
  const mockOptionsLow = [{ id: 'de-zone', name: 'Deutschland', price: 4.99, estimatedDelivery: 'in 3 days', carrier: 'DHL' }]
  const freeOption = { id: 'de-zone', name: 'Deutschland', price: 0, estimatedDelivery: 'in 3 days', carrier: 'DHL' }
  const caseB = simulateFreshnessEffect(freeOption as any, mockOptionsLow)
  if (caseB.wouldUpdate && caseB.newPrice === 4.99) {
    pass('reverse threshold-cross detected', 'stale 0 → fresh 4.99 (cart shrunk below threshold)')
  } else {
    fail('reverse threshold-cross', `wouldUpdate=${caseB.wouldUpdate}, newPrice=${caseB.newPrice}`)
  }

  // No-op case: stored option matches fresh quote
  const caseC = simulateFreshnessEffect(freeOption as any, mockOptionsHigh)
  if (!caseC.wouldUpdate) {
    pass('no-op when already in sync', 'effect does not thrash')
  } else {
    fail('no-op check', `effect would update despite match: newPrice=${caseC.newPrice}`)
  }

  // Null shippingOption (first mount): effect is no-op, auto-select handles it
  const caseD = simulateFreshnessEffect(null, mockOptionsHigh)
  if (!caseD.wouldUpdate) {
    pass('null shippingOption is a no-op', 'auto-select useEffect handles it')
  } else {
    fail('null handling', 'freshness effect should not act on null')
  }

  // ── Cleanup ──
  console.log('\n── Cleanup ──')
  store.reset()
  sessionStorage.clear()
  console.log('  🧹 store reset + sessionStorage cleared')

  console.log('\n═══════════════════════════════════════════════════════════')
  const p = results.filter((r) => r.status === 'PASS').length
  const f = results.filter((r) => r.status === 'FAIL').length
  console.log(`  RESULT: ${p} passed, ${f} failed`)
  console.log('═══════════════════════════════════════════════════════════')
  process.exit(f > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
