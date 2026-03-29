/**
 * k6 Concurrency Test — Anti-Überverkauf
 *
 * 50 parallele Bestellungen auf den GLEICHEN Artikel mit Bestand = 5
 * Erwartung: Genau 5 Erfolge, 45 Fehler (409 Conflict)
 *
 * Ausführen: k6 run load-tests/concurrency-test.js
 */
import http from 'k6/http'
import { check } from 'k6'
import { Counter } from 'k6/metrics'

const BASE_URL = __ENV.API_URL || 'http://localhost:3001/api/v1'

const successOrders = new Counter('successful_orders')
const conflictOrders = new Counter('conflict_orders')

export const options = {
  vus: 50,
  iterations: 50,  // Exactly 50 requests total
  thresholds: {
    successful_orders: ['count<=5'],   // Max 5 should succeed (stock = 5)
    conflict_orders: ['count>=45'],     // At least 45 should get 409
  },
}

export default function () {
  // All VUs try to buy the same product simultaneously
  const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
    email: 'anna@test.de',
    password: 'Test1234!',
  }), { headers: { 'Content-Type': 'application/json' } })

  if (loginRes.status !== 200) return

  const token = JSON.parse(loginRes.body).data?.accessToken
  if (!token) return

  const orderRes = http.post(`${BASE_URL}/orders`, JSON.stringify({
    items: [{ variantId: 'CONCURRENCY_TEST_VARIANT_ID', warehouseId: 'CONCURRENCY_TEST_WH_ID', quantity: 1 }],
    countryCode: 'DE',
  }), {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Idempotency-Key': `conc-test-${__VU}-${Date.now()}`,
    },
  })

  if (orderRes.status === 201) {
    successOrders.add(1)
    check(orderRes, { 'order success': (r) => r.status === 201 })
  } else if (orderRes.status === 409) {
    conflictOrders.add(1)
    check(orderRes, { 'stock conflict': (r) => r.status === 409 })
  }
}
