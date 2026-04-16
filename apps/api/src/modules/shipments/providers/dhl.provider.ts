import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as fs from 'fs'
import * as path from 'path'
import {
  IShipmentProvider,
  CreateShipmentInput,
  ShipmentResult,
  CreateReturnLabelInput,
  ReturnLabelResult,
} from '../shipment-provider.interface'

const DHL_TRACKING_URL = 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode='
const LABELS_DIR = path.join(process.cwd(), 'storage', 'labels')

export class ManualShipmentRequiredError extends BadRequestException {
  constructor(orderNumber: string) {
    super({
      statusCode: 400,
      error: 'ManualShipmentRequired',
      isManualMode: true,
      message: {
        de: `DHL API nicht konfiguriert. Bitte Label fuer ${orderNumber} manuell im DHL Geschaeftskundenportal erstellen.`,
        en: `DHL API not configured. Please create the label for ${orderNumber} manually in the DHL business portal.`,
        ar: `DHL API غير مُعد. يرجى إنشاء ملصق الشحن لـ ${orderNumber} يدوياً في بوابة DHL.`,
      },
    })
  }
}

@Injectable()
export class DHLProvider implements IShipmentProvider {
  readonly providerName = 'dhl'
  private readonly logger = new Logger(DHLProvider.name)
  private readonly shippingApiUrl: string
  private readonly trackingApiUrl: string
  private readonly apiKey: string       // Developer Portal API Key (dhl-api-key header)
  private readonly gkpUser: string      // Geschaeftskundenportal Username (Basic Auth)
  private readonly gkpPass: string      // Geschaeftskundenportal Password (Basic Auth)
  private readonly accountNumberNational: string  // EKP + 01 01 (V01PAK)
  private readonly accountNumberInternational: string  // EKP + 53 01 (V53WPAK)
  private readonly isSandbox: boolean
  private readonly isConfigured: boolean

  constructor(private readonly config: ConfigService) {
    this.isSandbox = this.config.get('DHL_SANDBOX', 'true') === 'true'
    this.shippingApiUrl = this.isSandbox
      ? 'https://api-sandbox.dhl.com/parcel/de/shipping/v2'
      : 'https://api-eu.dhl.com/parcel/de/shipping/v2'
    this.trackingApiUrl = this.isSandbox
      ? 'https://api-sandbox.dhl.com/track/shipments'
      : 'https://api-eu.dhl.com/track/shipments'
    this.apiKey = this.config.get('DHL_API_KEY', '')
    // GKP credentials for Basic Auth (Geschaeftskundenportal login)
    this.gkpUser = this.config.get('DHL_GKP_USER', '')
    this.gkpPass = this.config.get('DHL_GKP_PASS', '')
    const ekp = this.config.get('DHL_EKP', '') || this.config.get('DHL_ACCOUNT_NUMBER', '').slice(0, 10) || '6335926295'
    this.accountNumberNational = this.config.get('DHL_BILLING_NATIONAL', '') || `${ekp}0101`
    this.accountNumberInternational = this.config.get('DHL_BILLING_INTERNATIONAL', '') || `${ekp}5301`
    this.isConfigured = !!this.apiKey && !!this.gkpUser && !!this.gkpPass
    if (!this.isConfigured) {
      this.logger.warn('DHL API nicht konfiguriert — manueller Modus aktiv')
    }

    // Ensure labels directory exists
    if (!fs.existsSync(LABELS_DIR)) {
      fs.mkdirSync(LABELS_DIR, { recursive: true })
    }
  }

  /** Returns true if DHL API credentials are set */
  get isApiAvailable(): boolean {
    return this.isConfigured
  }

  async validateAddress(address: { street: string; houseNumber?: string; postalCode: string; city: string; country: string }): Promise<{
    valid: boolean
    warnings: string[]
  }> {
    const warnings: string[] = []

    if (!address.street?.trim()) warnings.push('Street is missing')
    if (!address.postalCode?.trim()) warnings.push('Postal code is missing')
    if (!address.city?.trim()) warnings.push('City is missing')
    if (!address.country?.trim()) warnings.push('Country is missing')

    // German PLZ format check (5 digits)
    if (address.country?.toUpperCase() === 'DE' && address.postalCode) {
      if (!/^\d{5}$/.test(address.postalCode.trim())) {
        warnings.push('German postal code must be 5 digits')
      }
    }

    // Austrian PLZ format (4 digits)
    if (address.country?.toUpperCase() === 'AT' && address.postalCode) {
      if (!/^\d{4}$/.test(address.postalCode.trim())) {
        warnings.push('Austrian postal code must be 4 digits')
      }
    }

    // Swiss PLZ format (4 digits)
    if (address.country?.toUpperCase() === 'CH' && address.postalCode) {
      if (!/^\d{4}$/.test(address.postalCode.trim())) {
        warnings.push('Swiss postal code must be 4 digits')
      }
    }

    // House number check for DE
    if (address.country?.toUpperCase() === 'DE' && !address.houseNumber?.trim()) {
      warnings.push('House number is missing (required for German addresses)')
    }

    return { valid: warnings.length === 0, warnings }
  }

  async createShipment(input: CreateShipmentInput): Promise<ShipmentResult> {
    if (!this.isConfigured) {
      this.logger.warn(`DHL API nicht konfiguriert — manuelles Label fuer ${input.orderNumber}`)
      throw new ManualShipmentRequiredError(input.orderNumber)
    }

    this.logger.log(`Creating DHL shipment for order ${input.orderNumber}`)

    const companyName = this.config.get('COMPANY_NAME', '') || 'Malak Bekleidung'
    const companyStreet = this.config.get('COMPANY_SHIP_STREET', '') || 'Pannierstr.'
    const companyHouseNumber = this.config.get('COMPANY_SHIP_HOUSE', '') || '4'
    const companyPostalCode = this.config.get('COMPANY_SHIP_PLZ', '') || '12047'
    const companyCity = this.config.get('COMPANY_SHIP_CITY', '') || 'Berlin'

    // Determine product + billing number based on destination country
    const destCountry = input.country?.toUpperCase() ?? 'DE'
    const isNational = destCountry === 'DE'
    const product = isNational ? 'V01PAK' : 'V53WPAK'
    const billingNumber = isNational ? this.accountNumberNational : this.accountNumberInternational

    const body = {
      profile: 'STANDARD_GRUPPENPROFIL',
      shipments: [
        {
          product,
          billingNumber,
          refNo: input.orderNumber,
          shipper: {
            name1: companyName,
            addressStreet: companyStreet,
            addressHouse: companyHouseNumber,
            postalCode: companyPostalCode,
            city: companyCity,
            country: 'DEU',
          },
          consignee: {
            name1: input.recipientName,
            addressStreet: input.street,
            addressHouse: input.houseNumber,
            postalCode: input.postalCode,
            city: input.city,
            country: this.toISO3(destCountry),
          },
          details: {
            weight: { uom: 'g', value: Math.max(input.weight, 100) }, // minimum 100g
          },
        },
      ],
    }

    const response = await fetch(`${this.shippingApiUrl}/orders?includeDocs=URL,QR_LABEL`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'dhl-api-key': this.apiKey,
        Authorization: `Basic ${Buffer.from(`${this.gkpUser}:${this.gkpPass}`).toString('base64')}`,
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      this.logger.error(`DHL createShipment failed: ${response.status} ${error}`)
      let detail = ''
      try {
        const parsed = JSON.parse(error)
        detail = parsed?.items?.[0]?.validationMessages?.map((m: any) => m.validationMessage).join('; ')
          ?? parsed?.detail ?? parsed?.title ?? error
      } catch { detail = error }
      throw new BadRequestException({
        statusCode: 400,
        error: 'DHLApiError',
        message: {
          de: `DHL-Fehler: ${detail}`,
          en: `DHL error: ${detail}`,
          ar: `خطأ DHL: ${detail}`,
        },
      })
    }

    const data = await response.json() as {
      items: Array<{
        shipmentNo: string
        sstatus: { title: string; statusCode: number }
        label: { b64?: string; url?: string }
        validationMessages?: Array<{ validationMessage: string }>
      }>
    }

    const item = data.items[0]

    if (item.sstatus?.statusCode !== 0 && !item.shipmentNo) {
      const msg = item.validationMessages?.map(v => v.validationMessage).join('; ') ?? 'Unknown DHL error'
      throw new Error(`DHL: ${msg}`)
    }

    const trackingNumber = item.shipmentNo

    // Get label PDF — either from base64 or by downloading the URL
    let labelPdf: Buffer
    if (item.label?.b64) {
      labelPdf = Buffer.from(item.label.b64, 'base64')
    } else if (item.label?.url) {
      const labelRes = await fetch(item.label.url)
      labelPdf = Buffer.from(await labelRes.arrayBuffer())
    } else {
      labelPdf = Buffer.alloc(0)
    }

    // Store label PDF to disk
    if (labelPdf.length > 0) {
      const labelPath = path.join(LABELS_DIR, `${trackingNumber}.pdf`)
      fs.writeFileSync(labelPath, labelPdf)
      this.logger.log(`Label PDF stored: ${labelPath} (${labelPdf.length} bytes)`)
    }

    this.logger.log(`DHL shipment created: ${trackingNumber} for order ${input.orderNumber}`)

    return {
      providerShipmentId: trackingNumber,
      trackingNumber,
      trackingUrl: `${DHL_TRACKING_URL}${trackingNumber}`,
      labelPdf,
    }
  }

  async deleteShipment(providerShipmentId: string): Promise<void> {
    if (!this.isConfigured) return
    this.logger.log(`Deleting DHL shipment: ${providerShipmentId}`)

    const response = await fetch(
      `${this.shippingApiUrl}/orders?shipment=${providerShipmentId}`,
      {
        method: 'DELETE',
        headers: {
          'dhl-api-key': this.apiKey,
          Authorization: `Basic ${Buffer.from(`${this.gkpUser}:${this.gkpPass}`).toString('base64')}`,
        },
      },
    )

    if (!response.ok) {
      const error = await response.text()
      this.logger.error(`DHL deleteShipment failed: ${response.status} ${error}`)
      throw new Error(`DHL delete: ${response.status}`)
    }

    // Remove stored label
    const labelPath = path.join(LABELS_DIR, `${providerShipmentId}.pdf`)
    if (fs.existsSync(labelPath)) {
      fs.unlinkSync(labelPath)
    }

    this.logger.log(`DHL shipment deleted: ${providerShipmentId}`)
  }

  async createReturnLabel(input: CreateReturnLabelInput): Promise<ReturnLabelResult> {
    if (!this.isConfigured) {
      throw new ManualShipmentRequiredError(input.orderId)
    }

    this.logger.log(`Creating DHL return label for order ${input.orderId}`)

    const companyName = this.config.get('COMPANY_NAME', '') || 'Malak Bekleidung'
    const companyStreet = this.config.get('COMPANY_SHIP_STREET', '') || 'Pannierstr.'
    const companyHouseNumber = this.config.get('COMPANY_SHIP_HOUSE', '') || '4'
    const companyPostalCode = this.config.get('COMPANY_SHIP_PLZ', '') || '12047'
    const companyCity = this.config.get('COMPANY_SHIP_CITY', '') || 'Berlin'

    const body = {
      profile: 'STANDARD_GRUPPENPROFIL',
      shipments: [
        {
          product: 'V01PAK',
          billingNumber: this.accountNumberNational, // Returns always go to DE
          refNo: input.returnNumber || `RET-${input.orderId.slice(-8)}`,
          shipper: {
            name1: input.senderName,
            addressStreet: input.street,
            addressHouse: input.houseNumber,
            postalCode: input.postalCode,
            city: input.city,
            country: this.toISO3(input.country),
          },
          consignee: {
            name1: companyName,
            addressStreet: companyStreet,
            addressHouse: companyHouseNumber,
            postalCode: companyPostalCode,
            city: companyCity,
            country: 'DEU',
          },
          details: {
            weight: { uom: 'g', value: input.weight },
          },
        },
      ],
    }

    const response = await fetch(`${this.shippingApiUrl}/orders?includeDocs=URL,QR`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'dhl-api-key': this.apiKey,
        Authorization: `Basic ${Buffer.from(`${this.gkpUser}:${this.gkpPass}`).toString('base64')}`,
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      this.logger.error(`DHL createReturnLabel failed: ${response.status} ${error}`)
      throw new Error(`DHL return label: ${response.status}`)
    }

    const data = await response.json() as any

    this.logger.log(`DHL return response keys: ${JSON.stringify(Object.keys(data?.items?.[0] ?? {}))}`)
    if (data?.items?.[0]) {
      const keys = Object.keys(data.items[0])
      for (const k of keys) {
        if (k !== 'label') this.logger.log(`DHL return field "${k}": ${JSON.stringify(data.items[0][k])?.slice(0, 100)}`)
      }
    }

    const item = data.items[0]
    this.logger.log(`DHL label keys: ${JSON.stringify(Object.keys(item.label ?? {}))} | b64=${!!item.label?.b64} | url=${!!item.label?.url}`)

    let returnLabelPdf: Buffer
    if (item.label?.b64) {
      returnLabelPdf = Buffer.from(item.label.b64, 'base64')
      this.logger.log(`DHL return label: base64, ${returnLabelPdf.length} bytes`)
    } else if (item.label?.url) {
      this.logger.log(`DHL return label URL: ${item.label.url}`)
      const labelRes = await fetch(item.label.url)
      returnLabelPdf = Buffer.from(await labelRes.arrayBuffer())
      this.logger.log(`DHL return label: downloaded from URL, ${returnLabelPdf.length} bytes`)
    } else {
      this.logger.warn(`DHL return label: NO label data received`)
      returnLabelPdf = Buffer.alloc(0)
    }

    // Extract QR code for Mobile Retoure
    let qrCodeBase64: string | undefined
    if (item.qrLabel?.b64) {
      qrCodeBase64 = item.qrLabel.b64
    } else if (item.qrLabel?.url) {
      try {
        const qrRes = await fetch(item.qrLabel.url)
        const qrBuf = Buffer.from(await qrRes.arrayBuffer())
        qrCodeBase64 = qrBuf.toString('base64')
      } catch { /* QR optional */ }
    }

    // Store return label
    if (returnLabelPdf.length > 0) {
      if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR, { recursive: true })
      const labelPath = path.join(LABELS_DIR, `RET-${item.shipmentNo}.pdf`)
      fs.writeFileSync(labelPath, returnLabelPdf)
      this.logger.log(`Return label stored: ${labelPath}`)
    }

    // Store QR code
    if (qrCodeBase64) {
      const qrPath = path.join(LABELS_DIR, `RET-QR-${item.shipmentNo}.png`)
      fs.writeFileSync(qrPath, Buffer.from(qrCodeBase64, 'base64'))
    }

    return {
      returnTrackingNumber: item.shipmentNo,
      returnLabelPdf,
      qrCodeBase64,
    }
  }

  // ── DHL Tracking API ──────────────────────────────────────

  async getTrackingStatus(trackingNumber: string): Promise<{
    status: string
    statusDetail: string
    timestamp: string | null
    estimatedDelivery: string | null
  } | null> {
    if (!this.isConfigured) return null

    try {
      const response = await fetch(
        `${this.trackingApiUrl}?trackingNumber=${trackingNumber}`,
        {
          headers: {
            'DHL-API-Key': this.apiKey,
            Accept: 'application/json',
          },
        },
      )

      if (!response.ok) {
        this.logger.warn(`DHL tracking query failed for ${trackingNumber}: ${response.status}`)
        return null
      }

      const data = await response.json() as {
        shipments?: Array<{
          status?: { statusCode?: string; status?: string; description?: string; timestamp?: string }
          estimatedTimeOfDelivery?: string
          events?: Array<{ statusCode?: string; timestamp?: string; description?: string }>
        }>
      }

      const shipment = data.shipments?.[0]
      if (!shipment) return null

      const status = shipment.status?.statusCode ?? shipment.status?.status ?? 'unknown'
      const statusDetail = shipment.status?.description ?? ''
      const timestamp = shipment.status?.timestamp ?? null
      const estimatedDelivery = shipment.estimatedTimeOfDelivery ?? null

      return { status, statusDetail, timestamp, estimatedDelivery }
    } catch (err) {
      this.logger.error(`DHL tracking API error for ${trackingNumber}`, err)
      return null
    }
  }

  // ── Label PDF access ──────────────────────────────────────

  getLabelPath(trackingNumber: string): string | null {
    const labelPath = path.join(LABELS_DIR, `${trackingNumber}.pdf`)
    return fs.existsSync(labelPath) ? labelPath : null
  }

  getReturnLabelPath(trackingNumber: string): string | null {
    const labelPath = path.join(LABELS_DIR, `RET-${trackingNumber}.pdf`)
    return fs.existsSync(labelPath) ? labelPath : null
  }

  // ── Helpers ───────────────────────────────────────────────

  private toISO3(iso2: string): string {
    const map: Record<string, string> = {
      DE: 'DEU', AT: 'AUT', CH: 'CHE', NL: 'NLD', BE: 'BEL',
      LU: 'LUX', FR: 'FRA', PL: 'POL', IT: 'ITA', ES: 'ESP',
      DK: 'DNK', SE: 'SWE', CZ: 'CZE', GB: 'GBR',
    }
    return map[iso2] ?? iso2
  }
}
