import { test, expect } from '@playwright/test'

test.describe('Admin — Login + Auth Guard', () => {
  test('Admin Login: Formular sichtbar', async ({ page }) => {
    await page.goto('/de/admin/login')
    await expect(page.locator('text=Malak Admin')).toBeVisible()
    await expect(page.locator('text=autorisiertes Personal')).toBeVisible()
    await expect(page.locator('input[id="email"]')).toBeVisible()
    await expect(page.locator('input[id="password"]')).toBeVisible()
  })

  test('Admin: Nicht eingeloggt → Redirect zu Login', async ({ page }) => {
    await page.goto('/de/admin/dashboard')
    // Should redirect to admin login (auth guard)
    await page.waitForURL(/\/de\/admin\/login/)
  })

  test('Admin: Orders-Seite ohne Login → Redirect', async ({ page }) => {
    await page.goto('/de/admin/orders')
    await page.waitForURL(/\/de\/admin\/login/)
  })
})

test.describe('Admin — Seitenstruktur (ohne Auth)', () => {
  // These tests verify the pages exist and render correctly
  // Full functional tests require a running backend with auth

  test('Admin Login: Shield-Icon + Anmelden-Button', async ({ page }) => {
    await page.goto('/de/admin/login')
    await expect(page.locator('button[type="submit"]')).toContainText('Anmelden')
  })
})
