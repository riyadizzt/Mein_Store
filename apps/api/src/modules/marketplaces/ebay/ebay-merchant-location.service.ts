/**
 * eBay Merchant-Location Service (C11b).
 *
 * Every eBay Offer carries a `merchantLocationKey` — a stable
 * string the seller defines once and then references on every
 * listing. eBay stores the physical "ships from" address
 * associated with that key; the value appears to buyers as
 * "Versand aus: Berlin, Deutschland" (or similar) and drives
 * shipping-time estimates.
 *
 * This service handles the one-time (per environment) creation
 * and idempotent maintenance of Malak's single inventory
 * location. Integrated as a pre-step in
 * EbaySandboxPoliciesService.bootstrapPolicies() — runs AFTER
 * the Selling-Policy opt-in and BEFORE policy creation, because
 * every Offer needs BOTH a valid location key AND valid policy
 * IDs.
 *
 * Design decisions (user-confirmed 2026-04-23):
 *   - Single location "malak-lager-berlin" for Phase 2. Future
 *     keys like "malak-lager-hamburg" remain possible.
 *   - Address source: COMPANY_SHIP_* env vars (same as DHL
 *     provider → single source of truth for the physical
 *     address; changes with 4 env-var edits, zero deploy).
 *   - stateOrProvince hardcoded "Berlin" (YAGNI — relocate
 *     triggers a code-change anyway).
 *   - GET-first idempotency: check existence before POST. If a
 *     disabled location is found we auto-enable it.
 *   - Location-key persisted on SalesChannelConfig.settings.
 *     merchantLocationKey (additive, mirrors the policyIds
 *     pattern from C10).
 *   - Production-guard inherited from caller — this service
 *     itself does NOT gate on env.mode; the sandbox-policies
 *     service (its only caller in C11b) already blocks
 *     production.
 *
 * Out-of-scope for C11b (future commits):
 *   - Multi-location (second warehouse / pickup point)
 *   - Admin-UI to edit the location name / address
 *   - Automatic re-sync on address change (today: admin clicks
 *     "Bootstrap sandbox policies" again)
 */

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { EbayApiClient, EbayApiError, type FetchLike } from './ebay-api.client'
import { resolveEbayEnv } from './ebay-env'
import { EbayAuthService } from './ebay-auth.service'

// ──────────────────────────────────────────────────────────────
// Stable key — must never change. Every Offer references it.
// ──────────────────────────────────────────────────────────────

export const MALAK_MERCHANT_LOCATION_KEY = 'malak-lager-berlin' as const

// ──────────────────────────────────────────────────────────────
// Result shapes
// ──────────────────────────────────────────────────────────────

export interface EnsureLocationResult {
  /** The merchant-location-key now known-good on eBay. */
  locationKey: string
  /** true = GET returned the location already (no POST issued). */
  alreadyExisted: boolean
  /** true = the found location was DISABLED and we enabled it. */
  wasDisabled: boolean
}

// ──────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────

@Injectable()
export class EbayMerchantLocationService {
  private readonly logger = new Logger(EbayMerchantLocationService.name)
  private fetchOverrideForTests: FetchLike | undefined

  constructor(
    private readonly config: ConfigService,
    private readonly auth: EbayAuthService,
  ) {}

  /**
   * Idempotent entry-point. Runs GET-first, POST-if-missing,
   * then ENABLE-if-disabled. Persists the location key to
   * SalesChannelConfig.settings.merchantLocationKey.
   *
   * Caller owns the token-fetch + client-build (so the bootstrap
   * can share one client/token across opt-in + location + policy
   * steps). If caller wants a self-contained ensure, use
   * ensureAutonomously() below.
   */
  async ensureMerchantLocation(
    client: EbayApiClient,
    token: string,
  ): Promise<EnsureLocationResult> {
    const key = MALAK_MERCHANT_LOCATION_KEY
    const existing = await this.tryGetLocation(client, token, key)

    let alreadyExisted = false
    let wasDisabled = false

    if (existing === null) {
      // Not found → create fresh.
      await this.createLocation(client, token, key)
      this.logger.log(`Created merchant location '${key}' fresh`)
    } else {
      alreadyExisted = true
      // If the existing location is disabled, re-enable it.
      // eBay lets sellers manually disable via the UI; a disabled
      // location cannot be used on new offers, so our bootstrap
      // must self-heal.
      if (this.isLocationDisabled(existing)) {
        await this.enableLocation(client, token, key)
        wasDisabled = true
        this.logger.log(`Found merchant location '${key}' disabled, re-enabled it`)
      } else {
        this.logger.log(`Merchant location '${key}' already enabled, no action`)
      }
    }

    // Persist the key on settings JSON so C11c's listing service
    // can look it up without a second GET round-trip. Additive
    // to any existing settings (policyIds etc.) — preserves them.
    await this.auth.patchSettings({ merchantLocationKey: key })

    return { locationKey: key, alreadyExisted, wasDisabled }
  }

  /**
   * Convenience wrapper for admin CLI / future standalone
   * endpoint. Fetches its own token + client. NOT used by the
   * sandbox-bootstrap flow (which passes in its own to share).
   */
  async ensureAutonomously(): Promise<EnsureLocationResult> {
    const token = await this.auth.getAccessTokenOrRefresh()
    const client = this.buildClient()
    return this.ensureMerchantLocation(client, token)
  }

  // ────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────

  /**
   * GET the location. Returns parsed object on 200, null on 404,
   * throws on any other error.
   */
  private async tryGetLocation(
    client: EbayApiClient,
    token: string,
    key: string,
  ): Promise<any | null> {
    try {
      return await client.request<any>(
        'GET',
        `/sell/inventory/v1/location/${encodeURIComponent(key)}`,
        { bearer: token },
      )
    } catch (e) {
      if (e instanceof EbayApiError && e.status === 404) {
        return null
      }
      throw e
    }
  }

  /**
   * POST create. Body structure mirrors eBay's Sell-Inventory
   * API v1 Location schema. Retry disabled — a 5xx is safer to
   * surface as a hard error than to risk duplicate creates
   * (even though POST /location/{key} is technically idempotent
   * on eBay's side, we trust GET-first + throw-on-unknown).
   */
  private async createLocation(
    client: EbayApiClient,
    token: string,
    key: string,
  ): Promise<void> {
    await client.request('POST', `/sell/inventory/v1/location/${encodeURIComponent(key)}`, {
      bearer: token,
      bodyKind: 'json',
      body: this.buildLocationPayload(),
      retry: false,
    })
  }

  /**
   * POST /location/{key}/enable. Used when GET returns a
   * disabled location.
   */
  private async enableLocation(
    client: EbayApiClient,
    token: string,
    key: string,
  ): Promise<void> {
    await client.request('POST', `/sell/inventory/v1/location/${encodeURIComponent(key)}/enable`, {
      bearer: token,
      // Enable has no body; eBay expects an empty POST. Pass
      // an empty object + json content-type to be safe.
      bodyKind: 'json',
      body: {},
      retry: false,
    })
  }

  /**
   * Detects DISABLED status. eBay returns
   *   { merchantLocationStatus: "ENABLED" | "DISABLED" }
   * directly on the location object. Defensive for missing
   * field: treat absent-or-null as enabled (the eBay default).
   */
  private isLocationDisabled(location: any): boolean {
    const status = location?.merchantLocationStatus
    if (typeof status !== 'string') return false
    return status.toUpperCase() === 'DISABLED'
  }

  /**
   * Payload shape — verified against eBay Sell-Inventory API docs.
   * Minimum required fields for a GERMANY location: location.address
   * (country + postalCode + city + addressLine1) + name + at least
   * one locationTypes entry.
   *
   * We read COMPANY_SHIP_STREET, COMPANY_SHIP_HOUSE, COMPANY_SHIP_PLZ,
   * COMPANY_SHIP_CITY from ConfigService — the same env vars the
   * DHL provider already uses (single source of truth for Malak's
   * physical ship-from address).
   */
  private buildLocationPayload() {
    const street = this.readAddressField('COMPANY_SHIP_STREET', 'Pannierstr.')
    const house = this.readAddressField('COMPANY_SHIP_HOUSE', '4')
    const postalCode = this.readAddressField('COMPANY_SHIP_PLZ', '12047')
    const city = this.readAddressField('COMPANY_SHIP_CITY', 'Berlin')

    return {
      name: 'Malak Bekleidung Lager Berlin',
      merchantLocationStatus: 'ENABLED',
      // eBay requires at least one of: WAREHOUSE / STORE / FULFILLMENT_CENTER.
      // Malak ships from a warehouse (not a physical store open to buyers),
      // so WAREHOUSE is the accurate classification.
      locationTypes: ['WAREHOUSE'],
      location: {
        address: {
          addressLine1: `${street} ${house}`.trim(),
          city,
          stateOrProvince: 'Berlin', // YAGNI — user-confirmed hardcode
          postalCode,
          country: 'DE',
        },
      },
    }
  }

  /**
   * Reads an env var via ConfigService; falls back to the literal
   * default if unset or empty-string. Matches the DHL-provider
   * pattern line-for-line so both channels stay consistent.
   */
  private readAddressField(key: string, fallback: string): string {
    const raw = this.config.get<string>(key, '')
    return raw && raw.trim().length > 0 ? raw.trim() : fallback
  }

  private buildClient(): EbayApiClient {
    const env = resolveEbayEnv()
    return this.fetchOverrideForTests
      ? new EbayApiClient(env, this.fetchOverrideForTests)
      : new EbayApiClient(env)
  }

  __setFetchForTests(f: FetchLike | undefined): void {
    this.fetchOverrideForTests = f
  }
}
