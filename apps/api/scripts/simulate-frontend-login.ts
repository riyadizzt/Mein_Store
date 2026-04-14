/**
 * Simulate EXACTLY what the frontend api.ts wrapper does when login
 * hits a 403. Confirms the error object reaches getErrorInfo with the
 * structure the page expects.
 */

async function main() {
  const API = 'http://localhost:3001/api/v1'

  // Replicate api.ts handleResponse behavior for a failed login
  async function fakeApiPost() {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cro.defi.mail@gmail.com', password: 'whatever' }),
      credentials: 'include',
    })

    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}))
      const error: any = new Error(body.message ?? `HTTP ${res.status}`)
      error.response = { status: res.status, data: body }
      throw error
    }
    return res.json()
  }

  try {
    await fakeApiPost()
    console.log('❌ Login unexpectedly succeeded')
  } catch (err: any) {
    console.log('── Thrown error (as the frontend would see it) ──\n')
    console.log('error.message:')
    console.log(`  ${err.message}`)
    console.log('  (typeof):', typeof err.message)
    console.log()
    console.log('error.response.status:', err.response?.status)
    console.log('error.response.data:')
    console.log('  ', JSON.stringify(err.response?.data, null, 2).replace(/\n/g, '\n   '))
    console.log()
    console.log('── getErrorInfo() simulation ──')
    const status = err?.response?.status
    const body = err?.response?.data
    const errorCode = body?.error
    const localizedMsg =
      typeof body?.message === 'object' ? body.message.de ?? body.message : null

    console.log('  status       :', status)
    console.log('  body.error   :', errorCode)
    console.log('  localizedMsg :', localizedMsg)
    console.log()

    if (status === 403 && errorCode === 'AccountBlocked') {
      console.log('  ✅ Would render: BLOCKED screen with contact CTA')
    } else if (status === 403) {
      console.log('  ⚠️  Would render: generic "temporarily locked" screen')
    } else if (status === 401) {
      console.log('  ⚠️  Would render: "wrong password" screen')
    } else {
      console.log(`  ⚠️  Would render: generic error (status ${status})`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
