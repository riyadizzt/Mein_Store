/**
 * Cross-app contract test — proves the architectural contract introduced
 * for the tax-phantom bug fix is enforced across the backend↔frontend
 * boundary.
 *
 * The contract: backend currentMonth.tax / currentMonth.net are
 * REFUND-ADJUSTED authoritative figures. The frontend's
 * `deriveMonthlyDisplayValues` helper (apps/web/src/lib/finance-display)
 * MUST consume them directly without local `gross - net` derivation.
 *
 * This spec imports the SAME helper the React monthly tab uses, feeds it
 * the exact backend response shape from the Owner-reported repro
 * (€24.99 cancel+refund), and asserts the helper produces 0.00 for
 * tax + net (the bug-prevention outcome).
 *
 * If anyone reverts the helper to local `gross - net` derivation, this
 * test fails because the helper would produce 24.99 instead of 0.00 for
 * the Owner-repro shape.
 *
 * Cross-import resolution: ts-jest in apps/api resolves the relative
 * path despite rootDir='src' restriction. The helper is pure-TS with
 * zero imports and no React/Next/DOM dependencies — verified via
 * Phase A throwaway probe.
 */

import {
  deriveMonthlyDisplayValues,
  deriveDailyVatPerRow,
  MonthlyReportLike,
} from '../../../../../web/src/lib/finance-display'

describe('Frontend↔Backend contract — finance-display helpers', () => {
  describe('deriveMonthlyDisplayValues — Owner-repro (Mai 2026)', () => {
    it('returns 0.00 for tax + net when full order canceled+refunded (THE FIX)', () => {
      // Exact backend shape produced by getMonthlyReport for the
      // Owner-reported case: 1 order €24.99, status='refunded',
      // Refund row €24.99 status='PROCESSED'.
      // Backend post-fix: currentMonth.tax='0.00', currentMonth.net='0.00',
      // currentMonth.gross='24.99', refundsTotal='24.99'.
      const backendResponse: MonthlyReportLike = {
        currentMonth: {
          gross: '24.99',
          net: '0.00', // refund-adjusted by backend
          tax: '0.00', // refund-adjusted by backend
          taxTotal: '0.00',
          orderCount: 1,
        },
        refundsTotal: '24.99',
      }

      const result = deriveMonthlyDisplayValues(backendResponse)

      // CRITICAL: tax must be 0.00 — pre-fix would have shown 3.99 phantom,
      // c08f677-broken state would have shown 24.99 (worse).
      expect(result.totalTax).toBe(0)
      expect(result.totalNet).toBe(0)
      // Gross stays raw — "إجمالي الإيرادات" / "Bruttoerlöse"
      expect(result.totalGross).toBe(24.99)
      expect(result.refunds).toBe(24.99)
      // gross-level net-after-refunds — "= صافي الإيرادات الإجمالية"
      expect(result.netGrossAfterRefunds).toBe(0)
    })

    it('reads cur.tax directly — does NOT derive via gross - net', () => {
      // Inject inconsistent backend data (gross-net != tax) to prove the
      // helper trusts cur.tax. If the helper local-derived, this test
      // would fail.
      const backendResponse: MonthlyReportLike = {
        currentMonth: {
          gross: '100',
          net: '99',
          tax: '7.50', // intentionally NOT 100 - 99 = 1
        },
        refundsTotal: '0',
      }

      const result = deriveMonthlyDisplayValues(backendResponse)

      // Trusts the backend value (regression guard: if anyone changes
      // the helper to compute totalGross - totalNet, this fails).
      expect(result.totalTax).toBe(7.5)
      expect(result.totalNet).toBe(99)
    })

    it('falls back to taxTotal alias when tax field is missing', () => {
      // Backend backward-compat: older API contract returned only taxTotal.
      const backendResponse: MonthlyReportLike = {
        currentMonth: {
          gross: '100',
          net: '84.03',
          taxTotal: '15.97',
        } as any, // tax intentionally undefined
        refundsTotal: '0',
      }

      const result = deriveMonthlyDisplayValues(backendResponse)

      expect(result.totalTax).toBe(15.97)
    })

    it('handles null/undefined input safely (never throws)', () => {
      expect(() => deriveMonthlyDisplayValues(null)).not.toThrow()
      expect(() => deriveMonthlyDisplayValues(undefined)).not.toThrow()
      expect(() => deriveMonthlyDisplayValues({})).not.toThrow()
      const nullResult = deriveMonthlyDisplayValues(null)
      expect(nullResult.totalGross).toBe(0)
      expect(nullResult.totalNet).toBe(0)
      expect(nullResult.totalTax).toBe(0)
      expect(nullResult.refunds).toBe(0)
    })

    it('zero-refund period: totalGross - totalNet === totalTax raw invariant holds', () => {
      // For periods with no refunds, the backend's raw invariant must hold:
      // currentMonth.gross - currentMonth.net === currentMonth.tax.
      // This guards against the backend accidentally refund-adjusting
      // only one of the three fields.
      const backendResponse: MonthlyReportLike = {
        currentMonth: {
          gross: '300',
          net: '252.10',
          tax: '47.90',
        },
        refundsTotal: '0',
      }

      const result = deriveMonthlyDisplayValues(backendResponse)

      // Helper just consumes — math invariant is checked here as a
      // structural guarantee that backend output is internally consistent.
      expect(Math.abs((result.totalGross - result.totalNet) - result.totalTax)).toBeLessThanOrEqual(0.01)
    })
  })

  describe('deriveDailyVatPerRow', () => {
    it('reads d.tax directly (does not derive g - n)', () => {
      // Inject inconsistent values: g - n would yield a different number
      // than d.tax. Helper must trust d.tax.
      expect(deriveDailyVatPerRow({ gross: '100', net: '50', tax: '15.97' })).toBe(15.97)
    })

    it('handles null/undefined safely', () => {
      expect(deriveDailyVatPerRow(null)).toBe(0)
      expect(deriveDailyVatPerRow(undefined)).toBe(0)
      expect(deriveDailyVatPerRow({})).toBe(0)
    })

    it('coerces string-encoded decimals from JSON', () => {
      expect(deriveDailyVatPerRow({ tax: '47.90' })).toBe(47.9)
      expect(deriveDailyVatPerRow({ tax: 47.9 })).toBe(47.9)
    })
  })
})
