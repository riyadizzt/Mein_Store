import { test, expect } from '@playwright/test'

test.describe('i18n — Deutsch', () => {
  test('DE: Homepage mit deutschen Texten', async ({ page }) => {
    await page.goto('/de')
    await expect(page.locator('text=Willkommen bei Malak')).toBeVisible()
    await expect(page.locator('text=Startseite')).toBeVisible()
    await expect(page.locator('text=Produkte')).toBeVisible()
  })

  test('DE: Footer mit Impressum + Datenschutz + AGB', async ({ page }) => {
    await page.goto('/de')
    await expect(page.locator('footer')).toContainText('Impressum')
    await expect(page.locator('footer')).toContainText('Datenschutz')
    await expect(page.locator('footer')).toContainText('AGB')
  })
})

test.describe('i18n — English', () => {
  test('EN: Homepage with English texts', async ({ page }) => {
    await page.goto('/en')
    await expect(page.locator('text=Welcome to Malak')).toBeVisible()
    await expect(page.locator('text=Home')).toBeVisible()
    await expect(page.locator('text=Products')).toBeVisible()
  })

  test('EN: Footer with Imprint + Privacy + Terms', async ({ page }) => {
    await page.goto('/en')
    await expect(page.locator('footer')).toContainText('Imprint')
    await expect(page.locator('footer')).toContainText('Privacy Policy')
    await expect(page.locator('footer')).toContainText('Terms')
  })
})

test.describe('i18n — العربية (RTL)', () => {
  test('AR: Homepage mit arabischen Texten + RTL', async ({ page }) => {
    await page.goto('/ar')
    await expect(page.locator('text=مرحباً بكم في متجر ملاك')).toBeVisible()
    await expect(page.locator('text=الرئيسية')).toBeVisible()

    // RTL check: html dir attribute
    const dir = await page.locator('html').getAttribute('dir')
    expect(dir).toBe('rtl')
  })

  test('AR: html lang=ar', async ({ page }) => {
    await page.goto('/ar')
    const lang = await page.locator('html').getAttribute('lang')
    expect(lang).toBe('ar')
  })
})

test.describe('i18n — Language Switching', () => {
  test('Sprachwechsel DE → EN behält die Route', async ({ page }) => {
    await page.goto('/de/products')
    // Open language switcher
    await page.locator('button[aria-label="Language"]').click()
    await page.locator('text=English').click()
    await page.waitForURL(/\/en\/products/)
    await expect(page.locator('text=Products')).toBeVisible()
  })
})
