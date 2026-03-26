// ── Input / Output ────────────────────────────────────────────

export interface ShippingInput {
  countryCode: string    // ISO 3166-1 alpha-2, z.B. 'DE', 'AT'
  weightGrams: number    // Gesamtgewicht der Bestellung
  subtotal: number       // Bestellwert vor Versandkosten (für Gratisversand-Check)
}

export interface ShippingResult {
  cost: number           // Versandkosten in EUR
  zoneName: string       // z.B. 'Deutschland', 'EU', 'International'
  isFreeShipping: boolean
  estimatedDays?: number // Lieferzeitschätzung (optional — für DHL/UPS-APIs)
  carrier?: string       // 'dhl' | 'ups' | 'zone_based'
}

// ── Strategy Interface ────────────────────────────────────────
// Alle Implementierungen folgen diesem Interface:
//
//   ZoneBasedCalculator     → aktiv (DB-Zonen-Tabelle)
//   DHLApiCalculator        → geplant (DHL Geschäftskunden API)
//   UPSApiCalculator        → geplant (UPS Shipping API + OAuth2)
//
// Welche Implementierung aktiv ist: SHIPPING_PROVIDER in .env

export interface ShippingCalculator {
  calculate(input: ShippingInput): Promise<ShippingResult>
}

export const SHIPPING_CALCULATOR = 'SHIPPING_CALCULATOR'
