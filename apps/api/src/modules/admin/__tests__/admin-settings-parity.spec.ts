/**
 * Parity regression test for GET /admin/settings ↔ PATCH /admin/settings.
 *
 * Background: on 14.04.2026 the admin noticed the "address autocomplete"
 * toggle silently reverted to OFF after save. Investigation showed the
 * PATCH whitelist contained 107 keys but the GET handler only projected
 * 46 of them — 61 writable keys were never returned. PATCH saved
 * correctly, but the frontend's next GET returned `undefined` for the
 * missing key, the form fell back to its default, and the toggle
 * appeared to "turn off by itself".
 *
 * This test constructs AdminController directly (no NestJS DI — far too
 * many injected services to set up for a single endpoint) with a mock
 * Prisma that returns a distinctive value for every writable key. Then
 * it calls getSettings() and asserts:
 *
 *   1. Every key from ADMIN_SETTINGS_WRITABLE_KEYS is present in the
 *      response (missing-key regression guard).
 *   2. For string-typed fields, the response propagates the stored DB
 *      value rather than falling back to a default.
 *   3. The whitelist itself has no duplicates.
 *   4. The specific addressAutocompleteEnabled key is in the whitelist
 *      (14.04.2026 named regression guard).
 */

import { AdminController, ADMIN_SETTINGS_WRITABLE_KEYS } from '../admin.controller'

describe('AdminController — settings GET/PATCH parity', () => {
  let controller: AdminController

  beforeEach(() => {
    // Fake Prisma: returns a distinctive value for every writable key so
    // we can tell whether the GET response actually reads from storage
    // vs. silently falling back to a default.
    const mockPrisma: any = {
      shopSetting: {
        findMany: jest.fn().mockResolvedValue(
          ADMIN_SETTINGS_WRITABLE_KEYS.map((key) => ({
            key,
            value: `stored-${key}`,
          })),
        ),
      },
    }

    // AdminController has 19 injected services; getSettings() only needs
    // this.prisma. Construct manually with null for everything else — no
    // method on the other services is ever touched by this endpoint.
    // If this breaks because getSettings() starts using another service,
    // that's a signal the change needs reviewing.
    const ctorArgs = Array(19).fill(null)
    ctorArgs[9] = mockPrisma // prisma is the 10th positional argument
    controller = new (AdminController as any)(...ctorArgs)
  })

  it('every writable key is projected by getSettings() with the stored value', async () => {
    const response = await controller.getSettings()
    const responseKeys = new Set(Object.keys(response))

    const missing: string[] = []
    const stale: string[] = []

    for (const key of ADMIN_SETTINGS_WRITABLE_KEYS) {
      if (!responseKeys.has(key)) {
        missing.push(key)
        continue
      }
      // Boolean-cast fields (stripeEnabled, klarnaEnabled, paypalEnabled)
      // are converted to boolean in the response — they have their own
      // env-derived fallback and a string mock cannot reach them. Skip
      // value-check for non-string responses.
      const actual = (response as Record<string, unknown>)[key]
      if (typeof actual !== 'string') continue
      const expected = `stored-${key}`
      if (actual !== expected) {
        stale.push(`${key}: expected "${expected}", got "${actual}"`)
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `${missing.length} writable keys are NOT in the GET response:\n  ` +
          missing.join('\n  '),
      )
    }
    if (stale.length > 0) {
      throw new Error(
        `${stale.length} keys return a stale / fallback value instead of the DB value:\n  ` +
          stale.join('\n  '),
      )
    }
  })

  it('ADMIN_SETTINGS_WRITABLE_KEYS has no duplicate entries', () => {
    const set = new Set(ADMIN_SETTINGS_WRITABLE_KEYS)
    expect(set.size).toBe(ADMIN_SETTINGS_WRITABLE_KEYS.length)
  })

  it('ADMIN_SETTINGS_WRITABLE_KEYS includes the 14.04.2026 regression key', () => {
    expect(ADMIN_SETTINGS_WRITABLE_KEYS).toContain('addressAutocompleteEnabled')
  })

  it('GET response exposes the same count-or-more keys than the whitelist', async () => {
    const response = await controller.getSettings()
    // The response also includes a handful of env-derived keys
    // (dhlConfigured, emailFrom) so it is a superset, never a subset.
    expect(Object.keys(response).length).toBeGreaterThanOrEqual(
      ADMIN_SETTINGS_WRITABLE_KEYS.length,
    )
  })
})
