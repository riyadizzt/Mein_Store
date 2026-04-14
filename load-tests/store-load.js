/**
 * k6 Load Test — Malak Bekleidung (Staging)
 *
 * Installation: brew install k6
 * Ausführen:    k6 run load-tests/store-load.js
 *
 * Ziel: 5.000 Bestellungen/Stunde (Peak: Black Friday)
 */
import http from 'k6/http'
import { check, sleep, group } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'

const BASE_URL = __ENV.API_URL || 'http://localhost:3001/api/v1'
const WEB_URL = __ENV.WEB_URL || 'http://localhost:3000'

// Custom metrics
const orderCreated = new Counter('orders_created')
const orderFailed = new Counter('orders_failed')
const errorRate = new Rate('error_rate')
const checkoutDuration = new Trend('checkout_duration')

export const options = {
  scenarios: {
    // Scenario 1: Browse (500 concurrent users)
    browse: {
      executor: 'constant-vus',
      vus: 500,
      duration: '2m',
      exec: 'browseFlow',
      tags: { scenario: 'browse' },
    },
    // Scenario 2: Checkout (50 concurrent buyers)
    checkout: {
      executor: 'constant-vus',
      vus: 50,
      duration: '2m',
      startTime: '30s',
      exec: 'checkoutFlow',
      tags: { scenario: 'checkout' },
    },
    // Scenario 3: Admin (20 concurrent admins)
    admin: {
      executor: 'constant-vus',
      vus: 20,
      duration: '2m',
      startTime: '30s',
      exec: 'adminFlow',
      tags: { scenario: 'admin' },
    },
    // Scenario 4: Webhooks (100 concurrent)
    webhooks: {
      executor: 'constant-vus',
      vus: 100,
      duration: '1m',
      startTime: '1m',
      exec: 'webhookFlow',
      tags: { scenario: 'webhooks' },
    },
  },
  thresholds: {
    // Performance targets
    http_req_duration: ['p(95)<500'],     // 95% under 500ms
    'http_req_duration{scenario:browse}': ['p(95)<300'],
    'http_req_duration{scenario:checkout}': ['p(95)<1000'],
    error_rate: ['rate<0.01'],             // Error rate under 1%
    orders_created: ['count>0'],
  },
}

// ── Browse Flow (Homepage → Katalog → PDP) ──────────────

export function browseFlow() {
  group('Homepage', () => {
    const res = http.get(`${WEB_URL}/de`)
    check(res, { 'homepage 200': (r) => r.status === 200 })
    errorRate.add(res.status !== 200)
  })

  sleep(1)

  group('Katalog', () => {
    const res = http.get(`${BASE_URL}/products?limit=20`)
    check(res, { 'products 200': (r) => r.status === 200 })
    errorRate.add(res.status !== 200)
  })

  sleep(0.5)

  group('Kategorien', () => {
    const res = http.get(`${BASE_URL}/categories`)
    check(res, { 'categories 200': (r) => r.status === 200 })
    errorRate.add(res.status !== 200)
  })

  sleep(0.5)

  group('Produkt Detail', () => {
    const res = http.get(`${BASE_URL}/products?limit=1`)
    check(res, { 'product detail 200': (r) => r.status === 200 })
    errorRate.add(res.status !== 200)
  })

  sleep(1 + Math.random() * 2)
}

// ── Checkout Flow (Login → Order → Payment) ─────────────

export function checkoutFlow() {
  // Login
  const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
    email: 'anna@test.de',
    password: 'Test1234!',
  }), { headers: { 'Content-Type': 'application/json' } })

  if (loginRes.status !== 200) {
    errorRate.add(true)
    return
  }

  const token = JSON.parse(loginRes.body).data?.accessToken
  if (!token) return

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }

  sleep(1)

  // Create order
  const start = Date.now()
  const orderRes = http.post(`${BASE_URL}/orders`, JSON.stringify({
    items: [{ variantId: 'test-variant-id', warehouseId: 'test-wh-id', quantity: 1 }],
    countryCode: 'DE',
  }), { headers: authHeaders })

  const duration = Date.now() - start
  checkoutDuration.add(duration)

  if (orderRes.status === 201) {
    orderCreated.add(1)
    check(orderRes, { 'order created': (r) => r.status === 201 })
  } else {
    orderFailed.add(1)
    errorRate.add(true)
  }

  sleep(2 + Math.random() * 3)
}

// ── Admin Flow ──────────────────────────────────────────

export function adminFlow() {
  // Admin Login
  const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
    email: 'admin@malak-bekleidung.com',
    password: 'Test1234!',
  }), { headers: { 'Content-Type': 'application/json' } })

  if (loginRes.status !== 200) return

  const token = JSON.parse(loginRes.body).data?.accessToken
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }

  group('Admin Dashboard', () => {
    const res = http.get(`${BASE_URL}/admin/dashboard`, { headers: authHeaders })
    check(res, { 'dashboard 200': (r) => r.status === 200 })
  })

  sleep(1)

  group('Admin Orders', () => {
    const res = http.get(`${BASE_URL}/admin/orders?limit=20`, { headers: authHeaders })
    check(res, { 'admin orders 200': (r) => r.status === 200 })
  })

  sleep(2 + Math.random() * 3)
}

// ── Webhook Flow ────────────────────────────────────────

export function webhookFlow() {
  // Simulate Stripe webhook (without valid signature — should be rejected)
  const res = http.post(`${BASE_URL}/payments/webhooks/stripe`, JSON.stringify({
    type: 'payment_intent.succeeded',
    data: { object: { id: `pi_test_${Date.now()}` } },
  }), {
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 'invalid-signature',
    },
  })

  // Should return 200 but with received: false (invalid signature)
  check(res, {
    'webhook responded': (r) => r.status === 200,
    'webhook rejected invalid sig': (r) => {
      try { return JSON.parse(r.body).received === false } catch { return false }
    },
  })

  sleep(0.1)
}
