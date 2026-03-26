// ─── Enums ───────────────────────────────────────────────────

export type Language = 'ar' | 'en' | 'de'

export type UserRole = 'customer' | 'admin' | 'warehouse_staff' | 'super_admin'

export type SalesChannel = 'website' | 'mobile' | 'pos' | 'facebook' | 'instagram' | 'tiktok'

export type OrderStatus =
  | 'pending'
  | 'pending_payment'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned'
  | 'refunded'

export type PaymentMethod =
  | 'stripe_card'
  | 'paypal'
  | 'klarna_pay_now'
  | 'klarna_pay_later'
  | 'klarna_installments'
  | 'sepa_direct_debit'
  | 'giropay'
  | 'apple_pay'
  | 'google_pay'
  | 'cash_on_delivery'

export type Gender = 'men' | 'women' | 'kids' | 'unisex'

export type SizeSystem = 'EU' | 'US' | 'UK'

// ─── API Response ─────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  message?: string
  error?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

// ─── Auth ────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface JwtPayload {
  sub: string // userId
  email: string
  role: UserRole
  iat?: number
  exp?: number
}

// ─── User ────────────────────────────────────────────────────

export interface UserPublic {
  id: string
  email: string
  firstName: string
  lastName: string
  phone?: string
  preferredLang: Language
  role: UserRole
  isVerified: boolean
  createdAt: string
}

// ─── Product ─────────────────────────────────────────────────

export interface ProductTranslationDto {
  language: Language
  name: string
  description?: string
  sizeGuide?: string
}

export interface ProductVariantDto {
  sku: string
  barcode?: string
  color?: string
  size?: string
  sizeSystem?: SizeSystem
  priceModifier: number
  weightGrams?: number
}

export interface ProductListItem {
  id: string
  slug: string
  brand?: string
  gender?: Gender
  basePrice: number
  salePrice?: number
  taxRate: number
  primaryImage?: string
  translations: ProductTranslationDto[]
  isActive: boolean
}

// ─── Inventory ───────────────────────────────────────────────

export interface InventoryStatus {
  variantId: string
  sku: string
  quantityOnHand: number
  quantityReserved: number
  quantityAvailable: number
  reorderPoint: number
}

// ─── Order ───────────────────────────────────────────────────

export interface OrderSummary {
  id: string
  orderNumber: string
  status: OrderStatus
  channel: SalesChannel
  totalAmount: number
  currency: string
  createdAt: string
}

// ─── Channel Sync ────────────────────────────────────────────

export interface ChannelSyncEvent {
  channel: SalesChannel
  eventType: string
  payload: Record<string, unknown>
  timestamp: string
}

// ─── i18n ────────────────────────────────────────────────────

export type TranslationKey = string

export interface LocalizedContent {
  ar: string
  en: string
  de: string
}
