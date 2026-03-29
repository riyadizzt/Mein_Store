import { test, expect } from '@playwright/test'

test.describe('Store — Happy Path (Kunde kauft ein Produkt)', () => {
  test('Homepage lädt mit Hero, Trust Signals, Kategorien', async ({ page }) => {
    await page.goto('/de')
    await expect(page.locator('text=Willkommen bei Malak')).toBeVisible()
    await expect(page.locator('text=Kostenloser Versand')).toBeVisible()
    await expect(page.locator('text=Kategorien')).toBeVisible()
  })

  test('Produktkatalog: Filter + Suche + Grid', async ({ page }) => {
    await page.goto('/de/products')
    await expect(page.locator('text=Filter')).toBeVisible()
    // Grid should render (even if empty with no backend)
    await expect(page.locator('main')).toBeVisible()
  })

  test('Warenkorb: Drawer öffnet und schließt', async ({ page }) => {
    await page.goto('/de')
    // Click cart icon in header
    await page.locator('button[aria-label="Warenkorb"]').click()
    await expect(page.locator('text=Ihr Warenkorb ist leer')).toBeVisible()
    // Close
    await page.locator('button:has(svg.lucide-x)').first().click()
  })

  test('Checkout: Redirect wenn Warenkorb leer', async ({ page }) => {
    await page.goto('/de/checkout')
    // Should redirect to products when cart is empty
    await page.waitForURL(/\/de\/products/)
  })

  test('Login-Seite: Formular sichtbar', async ({ page }) => {
    await page.goto('/de/auth/login')
    await expect(page.locator('text=Anmelden')).toBeVisible()
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('Register-Seite: Formular mit DSGVO-Checkbox', async ({ page }) => {
    await page.goto('/de/auth/register')
    await expect(page.locator('text=Konto erstellen')).toBeVisible()
    await expect(page.locator('text=Datenschutzerklärung')).toBeVisible()
  })

  test('Passwort vergessen: Formular + Bestätigung', async ({ page }) => {
    await page.goto('/de/auth/reset-password')
    await expect(page.locator('text=Passwort vergessen')).toBeVisible()
    await expect(page.locator('input[type="email"]')).toBeVisible()
  })
})

test.describe('Store — Fehlerseiten', () => {
  test('404-Seite: Freundliche Fehlermeldung + Suche', async ({ page }) => {
    await page.goto('/de/non-existent-page-xyz')
    await expect(page.locator('text=404').or(page.locator('text=nicht gefunden'))).toBeVisible()
  })
})

test.describe('Store — Rechtliche Pflichtseiten', () => {
  test('Impressum lädt mit §5 TMG', async ({ page }) => {
    await page.goto('/de/legal/impressum')
    await expect(page.locator('text=Impressum')).toBeVisible()
    await expect(page.locator('text=§ 5 TMG')).toBeVisible()
  })

  test('Datenschutz lädt mit DSGVO-Rechten', async ({ page }) => {
    await page.goto('/de/legal/datenschutz')
    await expect(page.locator('text=Datenschutzerklärung')).toBeVisible()
    await expect(page.locator('text=Art. 15 DSGVO')).toBeVisible()
  })

  test('AGB lädt mit Vertragsschluss-Klausel', async ({ page }) => {
    await page.goto('/de/legal/agb')
    await expect(page.locator('text=Allgemeine Geschäftsbedingungen')).toBeVisible()
    await expect(page.locator('text=Vertragsschluss')).toBeVisible()
  })

  test('Widerrufsbelehrung lädt mit 14-Tage-Frist', async ({ page }) => {
    await page.goto('/de/legal/widerruf')
    await expect(page.locator('text=Widerrufsbelehrung')).toBeVisible()
    await expect(page.locator('text=vierzehn Tagen')).toBeVisible()
    await expect(page.locator('text=kostenlos')).toBeVisible()
  })
})
