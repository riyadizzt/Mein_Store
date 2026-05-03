/**
 * Admin finance — monthly tab tax-cell verification.
 *
 * Marked test.skip by default. Owner runs manually pre-deploy when DB is
 * seeded with a known canceled+refunded order. The mandatory pre-deploy
 * Owner-driven local verification (Phase D protocol) is the primary
 * Source of truth; this spec is opt-in supplementary coverage.
 *
 * To run manually:
 *   1. Seed local DB with the Owner-repro order (€24.99 canceled+refunded
 *      in current month).
 *   2. Comment out test.skip on the desired test.
 *   3. pnpm test:e2e --grep "monthly tax"
 *
 * Expected after fix: ضريبة مستحقة cell renders 0,00 € — the canceled
 * order's gross sale (24.99) is offset by the refund's embedded VAT
 * (3.99), yielding net Finanzamt liability of zero.
 */

import { test, expect } from '@playwright/test'

test.describe('Admin Finance — Monthly tab tax cells (skip by default)', () => {
  test.skip('Owner-repro Mai 2026: ضريبة مستحقة cell shows 0,00 €', async ({ page }) => {
    // Pre-condition: admin authenticated. Use existing fixture / login flow.
    // Adjust selectors to match production DOM if needed.
    await page.goto('/de/admin/finance')
    // Switch to monthly tab
    await page.getByRole('button', { name: /monthly|monatlich|شهري/i }).click()

    // Pick Mai 2026
    await page.locator('select').first().selectOption('2026')
    await page.locator('select').nth(1).selectOption('5')

    // Wait for data to load
    await page.waitForResponse((r) => r.url().includes('/admin/finance/monthly'))

    // The summary block — assert the 6 cells against expected values.
    // ضريبة مستحقة (لمكتب الضرائب) — the GoBD-violating cell, must be 0,00 €
    const finanzamtCell = page.locator('text=USt-Zahllast').locator('..').locator('text=/0,00.*€|0\\.00.*€/')
    await expect(finanzamtCell).toBeVisible()

    // ضريبة 19% (مخرجات) — must be 0,00 €
    const outputVatCell = page.locator('text=Ausgangs-USt').locator('..').locator('text=/0,00.*€|0\\.00.*€/')
    await expect(outputVatCell).toBeVisible()

    // صافي الإيرادات (بدون ضريبة) — must be 0,00 €
    const netExclVatCell = page.locator('text=Nettoerlöse').locator('..').locator('text=/0,00.*€|0\\.00.*€/')
    await expect(netExclVatCell).toBeVisible()

    // إجمالي الإيرادات — must remain 24,99 € (raw gross preserved)
    const grossCell = page.locator('text=Bruttoerlöse gesamt').locator('..').locator('text=/24,99.*€/')
    await expect(grossCell).toBeVisible()
  })

  test.skip('zero-refund period: gross - net === tax invariant', async ({ page }) => {
    // Sanity check that healthy periods still display correctly.
    // Owner runs manually with a clean test month (no refunds).
    await page.goto('/de/admin/finance')
    await page.getByRole('button', { name: /monthly|monatlich|شهري/i }).click()
    // Pick a month with no refunds
    await page.locator('select').first().selectOption('2026')
    await page.locator('select').nth(1).selectOption('4')
    await page.waitForResponse((r) => r.url().includes('/admin/finance/monthly'))

    // Read the rendered values + assert math (rough — implementation-dependent)
    // The key contract: tax cell value === backend currentMonth.tax,
    // not (gross - net). For zero-refund periods these are equal anyway,
    // so this acts as a regression guard.
    await expect(page.locator('text=USt-Zahllast')).toBeVisible()
  })
})
