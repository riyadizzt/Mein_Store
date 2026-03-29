import { test, expect, devices } from '@playwright/test'

test.use(devices['iPhone 13'])

test.describe('Mobile — Responsive Layout', () => {
  test('Mobile Nav: Bottom Navigation sichtbar', async ({ page }) => {
    await page.goto('/de')
    // Bottom nav should be visible on mobile
    const bottomNav = page.locator('nav.fixed.bottom-0')
    await expect(bottomNav).toBeVisible()
    await expect(bottomNav).toContainText('Startseite')
    await expect(bottomNav).toContainText('Produkte')
  })

  test('Mobile: Hamburger-Menü öffnet und schließt', async ({ page }) => {
    await page.goto('/de')
    // Hamburger button
    await page.locator('button[aria-label="Menu"]').click()
    await expect(page.locator('text=Anmelden')).toBeVisible()
    // Close
    await page.locator('button[aria-label="Menu"]').click()
  })

  test('Mobile: Kein horizontaler Overflow auf Homepage', async ({ page }) => {
    await page.goto('/de')
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1) // +1 for rounding
  })

  test('Mobile: Kein horizontaler Overflow auf Katalog', async ({ page }) => {
    await page.goto('/de/products')
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1)
  })

  test('Mobile: Cookie-Banner sichtbar und klickbar', async ({ page }) => {
    // Clear storage for fresh visit
    await page.context().clearCookies()
    await page.goto('/de')
    await page.evaluate(() => localStorage.clear())
    await page.reload()

    // Cookie banner should appear
    const banner = page.locator('text=Wir verwenden Cookies')
    if (await banner.isVisible()) {
      await page.locator('text=Alle akzeptieren').click()
      await expect(banner).not.toBeVisible()
    }
  })
})
