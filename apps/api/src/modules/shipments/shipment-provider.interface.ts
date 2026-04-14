export interface CreateShipmentInput {
  recipientName: string
  street: string
  houseNumber: string
  postalCode: string
  city: string
  country: string // ISO 2-letter
  weight: number   // grams
  orderId: string
  orderNumber: string
}

export interface ShipmentResult {
  providerShipmentId: string
  trackingNumber: string
  trackingUrl: string
  labelPdf: Buffer   // PDF binary for label
}

export interface CreateReturnLabelInput {
  originalTrackingNumber: string
  senderName: string
  street: string
  houseNumber: string
  postalCode: string
  city: string
  country: string
  weight: number
  orderId: string
}

export interface ReturnLabelResult {
  returnTrackingNumber: string
  returnLabelPdf: Buffer
  qrCodeBase64?: string // QR code for DHL Mobile Retoure (customer shows at Paketshop)
}

export interface IShipmentProvider {
  readonly providerName: string
  createShipment(input: CreateShipmentInput): Promise<ShipmentResult>
  deleteShipment(providerShipmentId: string): Promise<void>
  createReturnLabel(input: CreateReturnLabelInput): Promise<ReturnLabelResult>
}

export const SHIPMENT_PROVIDERS = 'SHIPMENT_PROVIDERS'
