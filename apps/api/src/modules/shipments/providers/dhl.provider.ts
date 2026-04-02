import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  IShipmentProvider,
  CreateShipmentInput,
  ShipmentResult,
  CreateReturnLabelInput,
  ReturnLabelResult,
} from '../shipment-provider.interface'

const DHL_TRACKING_URL = 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode='

export class ManualShipmentRequiredError extends BadRequestException {
  constructor(orderNumber: string) {
    super({
      statusCode: 400,
      error: 'ManualShipmentRequired',
      isManualMode: true,
      message: {
        de: `DHL API nicht konfiguriert. Bitte Label für ${orderNumber} manuell im DHL Geschäftskundenportal erstellen.`,
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
  private readonly apiUrl: string
  private readonly apiKey: string
  private readonly apiSecret: string
  private readonly accountNumber: string
  private readonly isSandbox: boolean
  private readonly isConfigured: boolean

  constructor(private readonly config: ConfigService) {
    this.isSandbox = this.config.get('DHL_SANDBOX', 'true') === 'true'
    this.apiUrl = this.isSandbox
      ? 'https://api-sandbox.dhl.com/parcel/de/shipping/v2'
      : 'https://api-eu.dhl.com/parcel/de/shipping/v2'
    this.apiKey = this.config.get('DHL_API_KEY', '')
    this.apiSecret = this.config.get('DHL_API_SECRET', '')
    this.accountNumber = this.config.get('DHL_ACCOUNT_NUMBER', '')
    this.isConfigured = !!this.apiKey && !!this.accountNumber
    if (!this.isConfigured) {
      this.logger.warn('DHL API nicht konfiguriert — manueller Modus aktiv')
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

    // Basic validation
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
      this.logger.warn(`DHL API nicht konfiguriert — manuelles Label für ${input.orderNumber}`)
      throw new ManualShipmentRequiredError(input.orderNumber)
    }

    this.logger.log(`Creating DHL shipment for order ${input.orderNumber}`)

    const companyName = this.config.get('COMPANY_NAME', 'Malak')
    const companyStreet = this.config.get('COMPANY_SHIP_STREET', 'Musterstraße')
    const companyHouseNumber = this.config.get('COMPANY_SHIP_HOUSE', '1')
    const companyPostalCode = this.config.get('COMPANY_SHIP_PLZ', '10115')
    const companyCity = this.config.get('COMPANY_SHIP_CITY', 'Berlin')

    const body = {
      profile: 'STANDARD_GRUPPENPROFIL',
      shipments: [
        {
          product: 'V01PAK', // DHL Paket National
          billingNumber: this.accountNumber,
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
            country: this.toISO3(input.country),
          },
          details: {
            weight: { uom: 'g', value: input.weight },
          },
        },
      ],
    }

    const response = await fetch(`${this.apiUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'dhl-api-key': this.apiKey,
        Authorization: `Basic ${Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64')}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      this.logger.error(`DHL createShipment failed: ${response.status} ${error}`)
      throw new Error(`DHL API: ${response.status} — ${error}`)
    }

    const data = await response.json() as {
      items: Array<{
        shipmentNo: string
        sstatus: { title: string }
        label: { b64: string }
      }>
    }

    const item = data.items[0]
    const trackingNumber = item.shipmentNo
    const labelPdf = Buffer.from(item.label.b64, 'base64')

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
      `${this.apiUrl}/orders?shipment=${providerShipmentId}`,
      {
        method: 'DELETE',
        headers: {
          'dhl-api-key': this.apiKey,
          Authorization: `Basic ${Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64')}`,
        },
      },
    )

    if (!response.ok) {
      const error = await response.text()
      this.logger.error(`DHL deleteShipment failed: ${response.status} ${error}`)
      throw new Error(`DHL delete: ${response.status}`)
    }

    this.logger.log(`DHL shipment deleted: ${providerShipmentId}`)
  }

  async createReturnLabel(input: CreateReturnLabelInput): Promise<ReturnLabelResult> {
    if (!this.isConfigured) {
      throw new ManualShipmentRequiredError(input.orderId)
    }

    this.logger.log(`Creating DHL return label for order ${input.orderId}`)

    const companyName = this.config.get('COMPANY_NAME', 'Malak')
    const companyStreet = this.config.get('COMPANY_SHIP_STREET', 'Musterstraße')
    const companyHouseNumber = this.config.get('COMPANY_SHIP_HOUSE', '1')
    const companyPostalCode = this.config.get('COMPANY_SHIP_PLZ', '10115')
    const companyCity = this.config.get('COMPANY_SHIP_CITY', 'Berlin')

    const body = {
      profile: 'STANDARD_GRUPPENPROFIL',
      shipments: [
        {
          product: 'V01PAK',
          billingNumber: this.accountNumber,
          refNo: `RET-${input.orderId.slice(-8)}`,
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

    const response = await fetch(`${this.apiUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'dhl-api-key': this.apiKey,
        Authorization: `Basic ${Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64')}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      this.logger.error(`DHL createReturnLabel failed: ${response.status} ${error}`)
      throw new Error(`DHL return label: ${response.status}`)
    }

    const data = await response.json() as {
      items: Array<{ shipmentNo: string; label: { b64: string } }>
    }

    const item = data.items[0]
    return {
      returnTrackingNumber: item.shipmentNo,
      returnLabelPdf: Buffer.from(item.label.b64, 'base64'),
    }
  }

  private toISO3(iso2: string): string {
    const map: Record<string, string> = {
      DE: 'DEU', AT: 'AUT', CH: 'CHE', NL: 'NLD', BE: 'BEL',
      LU: 'LUX', FR: 'FRA', PL: 'POL',
    }
    return map[iso2] ?? iso2
  }
}
