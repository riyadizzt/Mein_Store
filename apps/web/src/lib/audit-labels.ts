/**
 * Translation dictionary for the admin audit-log "changes" column.
 *
 * The audit log stores raw field keys like `reason: payment_timeout` and
 * `companyPhone: 0157/...`. An Arabic-speaking admin cannot read those.
 * This module translates the KEY names (field labels) and specific
 * ENUM VALUES (reason codes, status codes) into DE/EN/AR.
 *
 * Coverage is intentionally NOT exhaustive — only the most common keys
 * written by audit.log() calls across the backend. Unknown keys fall
 * through to the raw key name, unknown values to the raw string. That
 * way adding a new audited field never crashes the UI, it just shows
 * the internal name until someone adds it to the dictionary here.
 */

type Locale = 'de' | 'en' | 'ar'
type L = Record<Locale, string>

// ── Field-name labels ──────────────────────────────────────────
// Add entries as new audit fields get introduced. Order is purely
// for readability — runtime doesn't care.
const FIELD_LABELS: Record<string, L> = {
  // ── Order / Payment ──
  orderNumber: { de: 'Bestellnummer', en: 'Order No.', ar: 'رقم الطلب' },
  orderId: { de: 'Bestell-ID', en: 'Order ID', ar: 'معرف الطلب' },
  status: { de: 'Status', en: 'Status', ar: 'الحالة' },
  reason: { de: 'Grund', en: 'Reason', ar: 'السبب' },
  itemCount: { de: 'Anzahl Artikel', en: 'Item count', ar: 'عدد الأصناف' },
  cancelledItems: { de: 'Stornierte Artikel', en: 'Cancelled items', ar: 'الأصناف الملغاة' },
  // R10-B Teil 2/3: new audit-change keys from the inspect flow
  itemsSkipped: { de: 'Übersprungene Artikel', en: 'Items skipped', ar: 'الأصناف المتجاوزة' },
  itemsRemoved: { de: 'Aus Bestand entfernt', en: 'Removed from stock', ar: 'مزال من المخزون' },
  totalItems: { de: 'Gesamt', en: 'Total items', ar: 'إجمالي الأصناف' },
  // R5/R7 per-line + consolidate warehouse changes
  itemId: { de: 'Artikel-ID', en: 'Item ID', ar: 'معرف العنصر' },
  warehouseId: { de: 'Lager-ID', en: 'Warehouse ID', ar: 'معرف المستودع' },
  warehouseName: { de: 'Lagername', en: 'Warehouse name', ar: 'اسم المستودع' },
  sku: { de: 'SKU', en: 'SKU', ar: 'رمز المنتج' },
  itemsMoved: { de: 'Verschobene Artikel', en: 'Items moved', ar: 'العناصر المنقولة' },
  // WAREHOUSE_CHANGE_BLOCKED_AFTER_CAPTURE payload fields.
  // (method, amount, warehouseId already defined elsewhere — reused here.)
  targetWarehouseId: { de: 'Ziel-Lager', en: 'Target warehouse', ar: 'المستودع المستهدف' },
  force: { de: 'Force-Override', en: 'Force override', ar: 'تجاوز إجباري' },
  orderStatus: { de: 'Bestell-Status', en: 'Order status', ar: 'حالة الطلب' },
  // PHANTOM_RESERVATION_CLEANED payload fields
  reservationId: { de: 'Reservierungs-ID', en: 'Reservation ID', ar: 'معرف الحجز' },
  originalWarehouseId: { de: 'Ursprünglich. Lager', en: 'Original warehouse', ar: 'المستودع الأصلي' },
  qty: { de: 'Menge', en: 'Quantity', ar: 'الكمية' },
  cleanupReason: { de: 'Bereinigungs-Grund', en: 'Cleanup reason', ar: 'سبب التنظيف' },
  // PRODUCTS_CATEGORY_CHANGED payload (size-charts hardening D)
  categoryId: { de: 'Kategorie-ID', en: 'Category ID', ar: 'معرف الفئة' },
  categoryName: { de: 'Kategorie', en: 'Category', ar: 'الفئة' },
  categorySlug: { de: 'Kategorie-Slug', en: 'Category slug', ar: 'رمز الفئة' },
  chartName: { de: 'Größentabelle', en: 'Size chart', ar: 'جدول المقاسات' },
  // R12 — pre/post payment cancel differentiation
  refunded: { de: 'Erstattet', en: 'Refunded', ar: 'تم الاسترداد' },
  paymentWas: { de: 'Zahlungsstatus', en: 'Payment was', ar: 'حالة الدفع' },
  refundAmount: { de: 'Erstattungsbetrag', en: 'Refund amount', ar: 'مبلغ الاسترداد' },
  manualRefund: { de: 'Manuelle Erstattung', en: 'Manual refund', ar: 'استرداد يدوي' },
  // RETURN_REFUND_FAILED + related return audit fields
  returnNumber: { de: 'Retourennummer', en: 'Return No.', ar: 'رقم المرتجع' },
  isFullReturn: { de: 'Vollretoure', en: 'Full return', ar: 'إرجاع كامل' },
  provider: { de: 'Anbieter', en: 'Provider', ar: 'مزوّد الدفع' },
  error: { de: 'Fehler', en: 'Error', ar: 'خطأ' },
  amount: { de: 'Betrag', en: 'Amount', ar: 'المبلغ' },
  method: { de: 'Methode', en: 'Method', ar: 'الطريقة' },
  // warehouseId already defined above (R5/R7 block) — removed duplicate
  name: { de: 'Name', en: 'Name', ar: 'الاسم' },
  total: { de: 'Gesamt', en: 'Total', ar: 'المجموع' },
  shipped: { de: 'Versendet', en: 'Shipped', ar: 'تم الشحن' },
  errors: { de: 'Fehler', en: 'Errors', ar: 'الأخطاء' },

  // ── User ──
  email: { de: 'E-Mail', en: 'Email', ar: 'البريد الإلكتروني' },
  firstName: { de: 'Vorname', en: 'First name', ar: 'الاسم الأول' },
  lastName: { de: 'Nachname', en: 'Last name', ar: 'اسم العائلة' },
  phone: { de: 'Telefon', en: 'Phone', ar: 'الهاتف' },
  role: { de: 'Rolle', en: 'Role', ar: 'الدور' },
  isActive: { de: 'Aktiv', en: 'Active', ar: 'نشط' },
  isBlocked: { de: 'Gesperrt', en: 'Blocked', ar: 'محظور' },
  isVerified: { de: 'Verifiziert', en: 'Verified', ar: 'تم التحقق' },
  lockedUntil: { de: 'Gesperrt bis', en: 'Locked until', ar: 'مقفل حتى' },
  tags: { de: 'Tags', en: 'Tags', ar: 'العلامات' },
  anonymized: { de: 'Anonymisiert', en: 'Anonymized', ar: 'مجهول الهوية' },
  originalEmail: { de: 'Ursprüngliche E-Mail', en: 'Original email', ar: 'البريد الأصلي' },
  userIds: { de: 'Benutzer-IDs', en: 'User IDs', ar: 'معرفات المستخدمين' },
  subject: { de: 'Betreff', en: 'Subject', ar: 'الموضوع' },
  to: { de: 'An', en: 'To', ar: 'إلى' },
  success: { de: 'Erfolgreich', en: 'Success', ar: 'ناجح' },
  attempt: { de: 'Versuch', en: 'Attempt', ar: 'المحاولة' },
  ip: { de: 'IP-Adresse', en: 'IP address', ar: 'عنوان IP' },
  userAgent: { de: 'Benutzer-Agent', en: 'User agent', ar: 'وكيل المستخدم' },
  recoveryEmail: { de: 'Wiederherstellungs-E-Mail', en: 'Recovery email', ar: 'بريد الاستعادة' },

  // ── Settings: Company ──
  companyName: { de: 'Firmenname', en: 'Company name', ar: 'اسم الشركة' },
  companyAddress: { de: 'Firmenadresse', en: 'Company address', ar: 'عنوان الشركة' },
  companyVatId: { de: 'USt-IdNr.', en: 'VAT ID', ar: 'الرقم الضريبي' },
  companyCeo: { de: 'Geschäftsführer', en: 'CEO', ar: 'المدير العام' },
  companyPhone: { de: 'Firmentelefon', en: 'Company phone', ar: 'هاتف الشركة' },
  companyEmail: { de: 'Firmen-E-Mail', en: 'Company email', ar: 'بريد الشركة' },
  companyRegister: { de: 'Handelsregister', en: 'Company register', ar: 'السجل التجاري' },
  logoUrl: { de: 'Logo', en: 'Logo', ar: 'الشعار' },
  faviconUrl: { de: 'Favicon', en: 'Favicon', ar: 'أيقونة الموقع' },
  brandName: { de: 'Markenname', en: 'Brand name', ar: 'اسم العلامة' },
  accentColor: { de: 'Akzentfarbe', en: 'Accent color', ar: 'لون التمييز' },

  // ── Settings: Bank ──
  bankName: { de: 'Bank', en: 'Bank', ar: 'البنك' },
  bankIban: { de: 'IBAN', en: 'IBAN', ar: 'IBAN' },
  bankBic: { de: 'BIC', en: 'BIC', ar: 'BIC' },

  // ── Settings: Payments ──
  stripeEnabled: { de: 'Stripe aktiv', en: 'Stripe enabled', ar: 'Stripe مفعل' },
  klarnaEnabled: { de: 'Klarna aktiv', en: 'Klarna enabled', ar: 'Klarna مفعل' },
  paypalEnabled: { de: 'PayPal aktiv', en: 'PayPal enabled', ar: 'PayPal مفعل' },
  vorkasse_enabled: { de: 'Vorkasse aktiv', en: 'Bank transfer enabled', ar: 'التحويل البنكي مفعل' },
  vorkasse_account_holder: { de: 'Kontoinhaber', en: 'Account holder', ar: 'صاحب الحساب' },
  vorkasse_iban: { de: 'Vorkasse IBAN', en: 'Bank transfer IBAN', ar: 'IBAN التحويل البنكي' },
  vorkasse_bic: { de: 'Vorkasse BIC', en: 'Bank transfer BIC', ar: 'BIC التحويل البنكي' },
  vorkasse_bank_name: { de: 'Bankname', en: 'Bank name', ar: 'اسم البنك' },
  vorkasse_deadline_days: { de: 'Frist (Tage)', en: 'Deadline (days)', ar: 'المهلة (أيام)' },
  sumup_enabled: { de: 'SumUp aktiv', en: 'SumUp enabled', ar: 'SumUp مفعل' },
  sumup_merchant_code: { de: 'SumUp Händler-Code', en: 'SumUp merchant code', ar: 'رمز تاجر SumUp' },

  // ── Settings: Shipping / Marketing / Returns ──
  freeShippingThreshold: { de: 'Gratisversand ab', en: 'Free shipping from', ar: 'شحن مجاني من' },
  minOrderValue: { de: 'Mindestbestellwert', en: 'Min order value', ar: 'الحد الأدنى للطلب' },
  minOrderEnabled: { de: 'Mindestbestellwert aktiv', en: 'Min order enabled', ar: 'الحد الأدنى مفعل' },
  welcomePopupEnabled: { de: 'Willkommens-Popup', en: 'Welcome popup', ar: 'النافذة الترحيبية' },
  welcomeDiscountPercent: { de: 'Willkommensrabatt %', en: 'Welcome discount %', ar: 'خصم الترحيب %' },
  returnsEnabled: { de: 'Retouren aktiv', en: 'Returns enabled', ar: 'الإرجاع مفعل' },
  addressAutocompleteEnabled: { de: 'Adress-Autovervollständigung', en: 'Address autocomplete', ar: 'الإكمال التلقائي للعنوان' },

  // ── Settings: Notifications ──
  notif_email_new_order: { de: 'E-Mail: Neue Bestellung', en: 'Email: new order', ar: 'إيميل: طلب جديد' },
  notif_email_low_stock: { de: 'E-Mail: Mindestbestand', en: 'Email: low stock', ar: 'إيميل: مخزون منخفض' },
  notif_sound_enabled: { de: 'Ton aktiv', en: 'Sound enabled', ar: 'الصوت مفعل' },
  notif_daily_summary: { de: 'Tägliche Zusammenfassung', en: 'Daily summary', ar: 'ملخص يومي' },
  notif_daily_summary_email: { de: 'Tages-E-Mail-Empfänger', en: 'Daily summary email', ar: 'بريد الملخص اليومي' },
  notif_email_auto_cancel: { de: 'E-Mail: Auto-Storno', en: 'Email: auto cancel', ar: 'إيميل: إلغاء تلقائي' },
}

// ── Enum-value labels ──────────────────────────────────────────
// Nested: [field key] → [raw value] → localized label
const VALUE_LABELS: Record<string, Record<string, L>> = {
  reason: {
    payment_timeout: { de: 'Zahlungstimeout', en: 'Payment timeout', ar: 'انتهاء مهلة الدفع' },
    customer_request: { de: 'Kundenwunsch', en: 'Customer request', ar: 'طلب العميل' },
    manual: { de: 'Manuell', en: 'Manual', ar: 'يدوي' },
    fraud: { de: 'Betrug', en: 'Fraud', ar: 'احتيال' },
    no_response: { de: 'Keine Antwort', en: 'No response', ar: 'لا يوجد رد' },
    wrong_size: { de: 'Falsche Größe', en: 'Wrong size', ar: 'مقاس خاطئ' },
    damaged: { de: 'Beschädigt', en: 'Damaged', ar: 'تالف' },
    quality_issue: { de: 'Qualitätsproblem', en: 'Quality issue', ar: 'مشكلة في الجودة' },
    wrong_product: { de: 'Falscher Artikel', en: 'Wrong product', ar: 'منتج خاطئ' },
    right_of_withdrawal: { de: 'Widerruf', en: 'Right of withdrawal', ar: 'حق الانسحاب' },
    changed_mind: { de: 'Meinung geändert', en: 'Changed mind', ar: 'تغيير الرأي' },
    other: { de: 'Sonstiges', en: 'Other', ar: 'أخرى' },
    // R10-B Teil 2/3: reason values that show up in the new audit actions
    scanner_already_restocked: {
      de: 'Scanner hatte bereits eingebucht',
      en: 'Scanner already restocked',
      ar: 'الماسح قام بالإدخال مسبقاً',
    },
    damaged_after_scanner_restock: {
      de: 'Beschädigung nach Scanner-Eingang',
      en: 'Damaged after scanner intake',
      ar: 'تضرر بعد إدخال الماسح',
    },
  },
  status: {
    pending: { de: 'Ausstehend', en: 'Pending', ar: 'معلق' },
    pending_payment: { de: 'Warte auf Zahlung', en: 'Awaiting payment', ar: 'بانتظار الدفع' },
    confirmed: { de: 'Bestätigt', en: 'Confirmed', ar: 'مؤكد' },
    processing: { de: 'In Bearbeitung', en: 'Processing', ar: 'قيد المعالجة' },
    shipped: { de: 'Versendet', en: 'Shipped', ar: 'تم الشحن' },
    delivered: { de: 'Zugestellt', en: 'Delivered', ar: 'تم التسليم' },
    cancelled: { de: 'Storniert', en: 'Cancelled', ar: 'ملغى' },
    returned: { de: 'Retourniert', en: 'Returned', ar: 'مُرتجع' },
    refunded: { de: 'Erstattet', en: 'Refunded', ar: 'مسترد' },
    disputed: { de: 'Widersprochen', en: 'Disputed', ar: 'متنازع عليه' },
    label_sent: { de: 'Label gesendet', en: 'Label sent', ar: 'تم إرسال ملصق الإرجاع' },
    in_transit: { de: 'In Zustellung', en: 'In transit', ar: 'في الطريق' },
    received: { de: 'Erhalten', en: 'Received', ar: 'تم الاستلام' },
    inspected: { de: 'Geprüft', en: 'Inspected', ar: 'تم الفحص' },
    requested: { de: 'Angefragt', en: 'Requested', ar: 'مطلوب' },
    rejected: { de: 'Abgelehnt', en: 'Rejected', ar: 'مرفوض' },
  },
  method: {
    card: { de: 'Karte', en: 'Card', ar: 'بطاقة' },
    stripe_card: { de: 'Kreditkarte', en: 'Credit card', ar: 'بطاقة ائتمان' },
    paypal: { de: 'PayPal', en: 'PayPal', ar: 'PayPal' },
    klarna: { de: 'Klarna', en: 'Klarna', ar: 'Klarna' },
    klarna_pay_now: { de: 'Klarna Sofort', en: 'Klarna Pay Now', ar: 'Klarna الدفع الآن' },
    sumup: { de: 'SumUp', en: 'SumUp', ar: 'SumUp' },
    vorkasse: { de: 'Vorkasse', en: 'Bank transfer', ar: 'تحويل بنكي' },
  },
  role: {
    customer: { de: 'Kunde', en: 'Customer', ar: 'عميل' },
    admin: { de: 'Admin', en: 'Admin', ar: 'مدير' },
    super_admin: { de: 'Super-Admin', en: 'Super admin', ar: 'مدير عام' },
    warehouse_staff: { de: 'Lagermitarbeiter', en: 'Warehouse staff', ar: 'موظف مستودع' },
  },
}

// ── Public API ─────────────────────────────────────────────────

/** Translate a field name. Falls back to the raw key. */
export function labelKey(key: string, locale: string): string {
  const loc = (['de', 'en', 'ar'] as const).includes(locale as any) ? (locale as Locale) : 'de'
  return FIELD_LABELS[key]?.[loc] ?? key
}

/** Translate an enum value for a known key. Falls back to the raw value. */
export function labelValue(key: string, value: unknown, locale: string): string {
  if (value === null || value === undefined) return '—'
  const str = String(value)
  const loc = (['de', 'en', 'ar'] as const).includes(locale as any) ? (locale as Locale) : 'de'
  return VALUE_LABELS[key]?.[str]?.[loc] ?? str
}
