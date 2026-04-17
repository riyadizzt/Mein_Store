/**
 * Canonical event catalog for the Admin webhook UI.
 *
 * Grouped by business domain so non-technical admins can navigate via
 * context ("Bestellungen" / "Retouren") instead of cryptic event names.
 * Each event carries a human-readable label and a one-sentence
 * description in all 3 supported languages (DE / EN / AR).
 *
 * Stays in lockstep with apps/api/src/modules/webhooks/events.ts
 * WEBHOOK_EVENT_TYPES. If you add an event there, add it here too.
 */

export type Locale = 'de' | 'en' | 'ar'
type Trans = { de: string; en: string; ar: string }

export interface WebhookEventDef {
  type: string
  label: Trans
  desc: Trans
}

export interface WebhookEventGroup {
  id: string
  label: Trans
  icon: string // lucide-react icon name (rendered via dynamic switch)
  events: WebhookEventDef[]
}

export const WEBHOOK_EVENT_GROUPS: WebhookEventGroup[] = [
  {
    id: 'orders',
    icon: 'ShoppingBag',
    label: { de: 'Bestellungen', en: 'Orders', ar: 'الطلبات' },
    events: [
      {
        type: 'order.created',
        label: { de: 'Neue Bestellung', en: 'New order', ar: 'طلب جديد' },
        desc: {
          de: 'Wird ausgelöst wenn ein Kunde eine neue Bestellung aufgibt (vor Zahlung).',
          en: 'Fires when a customer places a new order (before payment).',
          ar: 'يُشغَّل عندما يقدّم العميل طلباً جديداً (قبل الدفع).',
        },
      },
      {
        type: 'order.confirmed',
        label: { de: 'Bestellung bezahlt', en: 'Order paid', ar: 'تم دفع الطلب' },
        desc: {
          de: 'Zahlung wurde erfolgreich abgewickelt und die Bestellung ist bestätigt.',
          en: 'Payment was captured successfully and the order is confirmed.',
          ar: 'تم استلام الدفع بنجاح وتأكيد الطلب.',
        },
      },
      {
        type: 'order.status_changed',
        label: { de: 'Status geändert', en: 'Status changed', ar: 'تغيّر الحالة' },
        desc: {
          de: 'Der Bestellstatus wurde geändert (z.B. pending → processing).',
          en: 'The order status changed (e.g. pending → processing).',
          ar: 'تم تغيير حالة الطلب (مثلاً: قيد الانتظار ← قيد المعالجة).',
        },
      },
      {
        type: 'order.cancelled',
        label: { de: 'Bestellung storniert', en: 'Order cancelled', ar: 'تم إلغاء الطلب' },
        desc: {
          de: 'Eine Bestellung wurde vollständig oder teilweise storniert.',
          en: 'An order was fully or partially cancelled.',
          ar: 'تم إلغاء الطلب بالكامل أو جزئياً.',
        },
      },
      {
        type: 'order.shipped',
        label: { de: 'Bestellung versendet', en: 'Order shipped', ar: 'تم شحن الطلب' },
        desc: {
          de: 'Das DHL-Versandlabel wurde erstellt. Payload enthält Tracking-Nummer und Link.',
          en: 'DHL shipping label was created. Payload includes tracking number and link.',
          ar: 'تم إنشاء ملصق شحن DHL. تتضمن البيانات رقم التتبع والرابط.',
        },
      },
      {
        type: 'order.delivered',
        label: { de: 'Bestellung zugestellt', en: 'Order delivered', ar: 'تم تسليم الطلب' },
        desc: {
          de: 'DHL-Tracking meldet die Bestellung als zugestellt.',
          en: 'DHL tracking reports the order as delivered.',
          ar: 'يُبلغ تتبع DHL أن الطلب تم تسليمه.',
        },
      },
    ],
  },
  {
    id: 'returns',
    icon: 'RotateCcw',
    label: { de: 'Retouren', en: 'Returns', ar: 'المرتجعات' },
    events: [
      {
        type: 'return.requested',
        label: { de: 'Retoure beantragt', en: 'Return requested', ar: 'طلب إرجاع' },
        desc: {
          de: 'Ein Kunde hat eine Retoure beantragt. Noch keine Admin-Entscheidung.',
          en: 'A customer submitted a return request. Awaiting admin decision.',
          ar: 'قدّم العميل طلب إرجاع. بانتظار قرار المسؤول.',
        },
      },
      {
        type: 'return.approved',
        label: { de: 'Retoure genehmigt', en: 'Return approved', ar: 'تم قبول الإرجاع' },
        desc: {
          de: 'Admin hat die Retoure akzeptiert. Payload sagt ob der Shop das Label sendet.',
          en: 'Admin approved the return. Payload indicates whether the shop sends the label.',
          ar: 'وافق المسؤول على الإرجاع. تشير البيانات إلى ما إذا كان المتجر سيرسل الملصق.',
        },
      },
      {
        type: 'return.received',
        label: { de: 'Retoure eingetroffen', en: 'Return received', ar: 'وصل الإرجاع' },
        desc: {
          de: 'Die retournierte Ware wurde per Barcode-Scanner im Lager erfasst.',
          en: 'The returned goods were scanned into the warehouse.',
          ar: 'تم مسح البضاعة المُعادة في المستودع عبر الباركود.',
        },
      },
      {
        type: 'return.refunded',
        label: { de: 'Erstattung ausgezahlt', en: 'Refund processed', ar: 'تم رد المبلغ' },
        desc: {
          de: 'Die Erstattung wurde an den Kunden ausgezahlt (Stripe/PayPal/etc).',
          en: 'The refund has been paid back to the customer (Stripe/PayPal/etc).',
          ar: 'تم رد المبلغ إلى العميل (Stripe/PayPal/إلخ).',
        },
      },
    ],
  },
  {
    id: 'customers',
    icon: 'Users',
    label: { de: 'Kunden', en: 'Customers', ar: 'العملاء' },
    events: [
      {
        type: 'customer.registered',
        label: { de: 'Neuer Kunde', en: 'New customer', ar: 'عميل جديد' },
        desc: {
          de: 'Ein Kunde hat ein neues Konto erstellt (Passwort oder Google/Facebook-Login).',
          en: 'A customer created a new account (password or Google/Facebook login).',
          ar: 'أنشأ عميل حساباً جديداً (كلمة مرور أو تسجيل دخول جوجل/فيسبوك).',
        },
      },
      {
        type: 'customer.deletion_requested',
        label: { de: 'Kontolöschung beantragt', en: 'Deletion requested', ar: 'طلب حذف الحساب' },
        desc: {
          de: 'Ein Kunde hat die Löschung seines Kontos (DSGVO Art. 17) beantragt.',
          en: 'A customer requested deletion of their account (GDPR Art. 17).',
          ar: 'طلب عميل حذف حسابه (المادة 17 من اللائحة).',
        },
      },
      {
        type: 'contact.message_received',
        label: { de: 'Kontaktnachricht erhalten', en: 'Contact message received', ar: 'رسالة تواصل جديدة' },
        desc: {
          de: 'Das öffentliche Kontaktformular wurde abgeschickt (Spam-geschützt).',
          en: 'The public contact form was submitted (spam-protected).',
          ar: 'تم إرسال نموذج التواصل العام (محمي من السبام).',
        },
      },
    ],
  },
  {
    id: 'products',
    icon: 'Package',
    label: { de: 'Produkte & Lager', en: 'Products & Inventory', ar: 'المنتجات والمخزون' },
    events: [
      {
        type: 'product.created',
        label: { de: 'Neues Produkt', en: 'Product created', ar: 'منتج جديد' },
        desc: {
          de: 'Ein neues Produkt wurde angelegt. Payload enthält 3 Sprachen, alle Bilder und Shop-URLs — ideal für Auto-Post auf Instagram/Facebook.',
          en: 'A new product was created. Payload includes 3 languages, all images and shop URLs — ideal for auto-posting to Instagram/Facebook.',
          ar: 'تم إنشاء منتج جديد. تتضمن البيانات 3 لغات وجميع الصور وروابط المتجر — مثالية للنشر التلقائي على إنستجرام/فيسبوك.',
        },
      },
      {
        type: 'product.out_of_stock',
        label: { de: 'Produkt ausverkauft', en: 'Product out of stock', ar: 'نفذ المنتج' },
        desc: {
          de: 'Die letzte Einheit einer Variante wurde verkauft. (Post-Launch — noch nicht aktiv)',
          en: 'The last unit of a variant was sold. (Post-launch — not yet active)',
          ar: 'تم بيع آخر وحدة من الصنف. (بعد الإطلاق — غير مفعّل بعد)',
        },
      },
      {
        type: 'inventory.low_stock',
        label: { de: 'Bestand niedrig', en: 'Low stock', ar: 'المخزون منخفض' },
        desc: {
          de: 'Der Bestand ist unter den Schwellwert gefallen. (Post-Launch — noch nicht aktiv)',
          en: 'Stock dropped below the reorder threshold. (Post-launch — not yet active)',
          ar: 'انخفض المخزون تحت حد إعادة الطلب. (بعد الإطلاق — غير مفعّل بعد)',
        },
      },
      {
        type: 'inventory.restock',
        label: { de: 'Ware eingetroffen', en: 'Restock', ar: 'إعادة تخزين' },
        desc: {
          de: 'Wareneingang wurde gebucht — einzeln oder per CSV-Import.',
          en: 'Inventory intake was recorded — manually or via CSV import.',
          ar: 'تم تسجيل استلام البضاعة — يدوياً أو عبر استيراد CSV.',
        },
      },
    ],
  },
  {
    id: 'payments',
    icon: 'CreditCard',
    label: { de: 'Zahlungen', en: 'Payments', ar: 'المدفوعات' },
    events: [
      {
        type: 'payment.failed',
        label: { de: 'Zahlung fehlgeschlagen', en: 'Payment failed', ar: 'فشل الدفع' },
        desc: {
          de: 'Eine Zahlung wurde vom Provider (Stripe/PayPal/etc) abgelehnt.',
          en: 'A payment was declined by the provider (Stripe/PayPal/etc).',
          ar: 'رُفضت عملية دفع من قبل مزوّد الخدمة (Stripe/PayPal/إلخ).',
        },
      },
      {
        type: 'payment.disputed',
        label: { de: 'Chargeback / Reklamation', en: 'Chargeback / dispute', ar: 'نزاع / رد المبلغ' },
        desc: {
          de: 'Ein Kunde hat die Zahlung angefochten. Sofortige Admin-Prüfung erforderlich.',
          en: 'A customer filed a dispute on the payment. Immediate admin review required.',
          ar: 'قدّم عميل نزاعاً على الدفع. مطلوب مراجعة فورية من المسؤول.',
        },
      },
      {
        type: 'payment.refunded',
        label: { de: 'Zahlung erstattet', en: 'Payment refunded', ar: 'تم رد المبلغ' },
        desc: {
          de: 'Eine Erstattung wurde erfolgreich durchgeführt.',
          en: 'A refund was successfully processed.',
          ar: 'تمت عملية رد المبلغ بنجاح.',
        },
      },
    ],
  },
]

// Flat list of all event types — useful for validation.
export const ALL_EVENT_TYPES: string[] = WEBHOOK_EVENT_GROUPS.flatMap((g) =>
  g.events.map((e) => e.type),
)

export function findEventDef(type: string): WebhookEventDef | null {
  for (const g of WEBHOOK_EVENT_GROUPS) {
    const hit = g.events.find((e) => e.type === type)
    if (hit) return hit
  }
  return null
}

export function t3(l: string, de: string, ar: string): string {
  return l === 'ar' ? ar : de
}

export function t3all(l: string, trans: Trans): string {
  if (l === 'ar') return trans.ar
  if (l === 'en') return trans.en
  return trans.de
}
