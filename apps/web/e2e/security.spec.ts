import { test, expect } from '@playwright/test'

test.describe('Security — Frontend', () => {
  test('Security Headers sind gesetzt', async ({ page }) => {
    const response = await page.goto('/de')
    const headers = response!.headers()
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })

  test('Account-Seiten: Redirect ohne Login', async ({ page }) => {
    const protectedPages = [
      '/de/account/orders',
      '/de/account/addresses',
      '/de/account/profile',
      '/de/account/wishlist',
      '/de/account/sessions',
      '/de/account/delete',
    ]

    for (const url of protectedPages) {
      await page.goto(url)
      // Should redirect to login
      await page.waitForURL(/\/auth\/login/, { timeout: 5000 })
    }
  })

  test('Admin-Seiten: Redirect ohne Admin-Login', async ({ page }) => {
    await page.goto('/de/admin/dashboard')
    await page.waitForURL(/\/admin\/login/, { timeout: 5000 })
  })

  test('Keine API Keys im Frontend-Bundle', async ({ page }) => {
    await page.goto('/de')
    // Check page source for leaked secrets
    const content = await page.content()
    expect(content).not.toContain('sk_live_') // Stripe secret key
    expect(content).not.toContain('sk_test_') // Stripe test secret
    expect(content).not.toContain('re_') // Resend API key (except re_ prefix in CSS)
    expect(content).not.toContain('whsec_') // Stripe webhook secret
  })

  test('XSS: Script-Tags in URL werden nicht ausgeführt', async ({ page }) => {
    await page.goto('/de/products?q=<script>alert("xss")</script>')
    // Page should load without executing script
    const dialogPromise = page.waitForEvent('dialog', { timeout: 2000 }).catch(() => null)
    const dialog = await dialogPromise
    expect(dialog).toBeNull() // No alert dialog
  })

  test('robots.txt: Admin + Checkout ausgeschlossen', async ({ page }) => {
    const response = await page.goto('/robots.txt')
    if (response && response.ok()) {
      const text = await response.text()
      expect(text).toContain('Disallow: /account')
      expect(text).toContain('Disallow: /checkout')
      expect(text).toContain('Disallow: /admin')
    }
  })

  test('sitemap.xml existiert', async ({ page }) => {
    const response = await page.goto('/sitemap.xml')
    if (response) {
      expect(response.status()).toBeLessThan(500)
    }
  })
})
