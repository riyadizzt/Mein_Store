'use client'

import React, { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { ScrollText, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { labelKey, labelValue } from '@/lib/audit-labels'

// ── Render helpers for the `changes` JSON payload ──────────────
// Audit logs write three different shapes depending on the action:
//   1. { before: {...}, after: {...} }  → field-by-field diff
//   2. { after: {...} }                  → only new values (settings updates)
//   3. { before: {...} }                 → only old values (deletions)
//   4. any other shape                   → pretty-print key/value
// Settings updates trigger shape #2 which previously fell through to a
// 80-char JSON.stringify and rendered as garbled raw text in the admin.

function formatAuditValue(key: string, v: unknown, locale: string): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? '✓' : '✗'
  if (typeof v === 'number') return v.toString()
  if (typeof v === 'string') {
    // Try to translate against a known enum (reason, status, method, role).
    // labelValue() returns the raw string if no mapping exists, so unknown
    // values pass through unchanged (URLs, free-form text, IDs, etc.).
    return labelValue(key, v, locale)
  }
  if (Array.isArray(v)) return v.map((x) => formatAuditValue(key, x, locale)).join(', ')
  try { return JSON.stringify(v) } catch { return String(v) }
}

function renderKvList(
  obj: Record<string, unknown>,
  valueClass: string,
  locale: string,
  strikethrough = false,
): React.ReactNode {
  return Object.keys(obj).map((k) => (
    <div key={k} className="text-xs leading-normal break-words">
      <span className="text-muted-foreground">{labelKey(k, locale)}:</span>{' '}
      <span className={`${valueClass} ${strikethrough ? 'line-through' : ''}`}>
        {formatAuditValue(k, obj[k], locale)}
      </span>
    </div>
  ))
}

function renderChanges(ch: any, locale: string): React.ReactNode {
  // Case 1: full before/after diff
  if (ch && typeof ch === 'object' && ch.before && ch.after) {
    const allKeys = new Set<string>([
      ...Object.keys(ch.before ?? {}),
      ...Object.keys(ch.after ?? {}),
    ])
    return [...allKeys].map((k) => {
      const beforeVal = ch.before?.[k]
      const afterVal = ch.after?.[k]
      const changed = JSON.stringify(beforeVal) !== JSON.stringify(afterVal)
      return (
        <div key={k} className="text-xs leading-normal break-words">
          <span className="text-muted-foreground">{labelKey(k, locale)}:</span>{' '}
          {beforeVal !== undefined && (
            <span className={`${changed ? 'text-red-400 line-through' : 'text-foreground'}`}>
              {formatAuditValue(k, beforeVal, locale)}
            </span>
          )}
          {changed && afterVal !== undefined && <> → </>}
          {afterVal !== undefined && changed && (
            <span className="text-green-600">{formatAuditValue(k, afterVal, locale)}</span>
          )}
        </div>
      )
    })
  }
  // Case 2: after-only (settings updates, creations)
  if (ch && typeof ch === 'object' && ch.after && typeof ch.after === 'object') {
    return (
      <>
        <div className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wide mb-1">
          {locale === 'ar' ? 'القيم الجديدة' : locale === 'en' ? 'New values' : 'Neue Werte'}
        </div>
        {renderKvList(ch.after as Record<string, unknown>, 'text-green-600', locale)}
      </>
    )
  }
  // Case 3: before-only (deletions)
  if (ch && typeof ch === 'object' && ch.before && typeof ch.before === 'object') {
    return (
      <>
        <div className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wide mb-1">
          {locale === 'ar' ? 'تم حذفها' : locale === 'en' ? 'Removed' : 'Gelöschte Werte'}
        </div>
        {renderKvList(ch.before as Record<string, unknown>, 'text-red-400', locale, true)}
      </>
    )
  }
  // Case 4: flat object (no before/after wrapper)
  if (ch && typeof ch === 'object') {
    return renderKvList(ch as Record<string, unknown>, 'text-foreground', locale)
  }
  return <span className="text-xs text-muted-foreground">{String(ch).slice(0, 80)}</span>
}

const ACTION_COLORS: Record<string, string> = {
  ADMIN_LOGIN: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  ADMIN_LOGIN_FAILED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  ORDER_CREATED: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  ORDER_STATUS_CHANGED: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300',
  ORDER_CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  ORDER_PARTIAL_CANCEL: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300',
  ORDER_FULFILLMENT_CHANGED: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300',
  // R5 — per-line warehouse move (subset of fulfillment change)
  ORDER_ITEM_WAREHOUSE_CHANGED: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300',
  // R7 — consolidate all lines into one warehouse (stronger signal)
  ORDER_WAREHOUSE_CONSOLIDATED: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300',
  // Blocked attempt to move a reservation after payment capture. Strong red
  // because it signals a lifecycle-boundary violation attempt — admin tried
  // to do something that would have caused phantom-reservation drift.
  WAREHOUSE_CHANGE_BLOCKED_AFTER_CAPTURE: 'bg-red-200 text-red-900 dark:bg-red-600/30 dark:text-red-200',
  // Remedial cleanup of a pre-existing phantom reservation (e.g. the one
  // from ORD-20260418-000001 produced before the guard was in place).
  // Slate because it's an operational remediation, not an incident.
  PHANTOM_RESERVATION_CLEANED: 'bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-300',
  // R12 — differentiate cancel-flows by money impact
  ORDER_CANCELLED_PRE_PAYMENT: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  ORDER_CANCELLED_POST_PAYMENT: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  PRODUCT_CREATED: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300',
  PRODUCT_UPDATED: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300',
  PRODUCT_DELETED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  PRODUCT_HARD_DELETED: 'bg-red-200 text-red-900 dark:bg-red-600/30 dark:text-red-200',
  PRODUCT_RESTORED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  PRODUCT_DUPLICATED: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300',
  PRODUCT_PRICE_CHANGED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  PRODUCTS_ACTIVATED: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  PRODUCTS_DEACTIVATED: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300',
  PRODUCTS_DELETED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  VARIANT_UPDATED: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300',
  VARIANT_DELETED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  VARIANT_COLOR_ADDED: 'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-300',
  VARIANT_SIZE_ADDED: 'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-300',
  INVENTORY_INTAKE: 'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300',
  INVENTORY_OUTPUT: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300',
  INVENTORY_ADJUSTED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300',
  INVENTORY_TRANSFER: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300',
  INVENTORY_TRANSFERRED: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300',
  RETURN_APPROVED: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  RETURN_SCANNED: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300',
  RETURN_RECEIVED: 'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300',
  RETURN_INSPECTED: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  // R10-B Teil 2: signals that the Dedup-Guard prevented a second restock
  // because the Scanner-Flow already booked the item into inventory. Slate
  // (neutral) because it's an informational event, not a success or alert.
  RETURN_INSPECTED_NO_DOUBLE_RESTOCK: 'bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-300',
  // R10-B Teil 3: a damaged item was removed from sellable stock after the
  // scanner had already booked it. Rose because it's a stock-leaving event.
  RETURN_DAMAGED_REMOVED_FROM_STOCK: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300',
  RETURN_REJECTED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  RETURN_REFUNDED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  // Finance-critical: refund API call failed (Stripe/PayPal/Klarna/SumUp).
  // Return stays at 'inspected' awaiting admin retry — the persisted
  // refundError column drives the red banner in the return detail.
  RETURN_REFUND_FAILED: 'bg-red-200 text-red-900 dark:bg-red-600/30 dark:text-red-200',
  VORKASSE_REFUND_CONFIRMED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  RETURN_LABEL_UPDATED: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
  RETURN_STATUS_APPROVED: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  RETURN_STATUS_INSPECTED: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  RETURN_STATUS_LABEL_SENT: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
  RETURN_STATUS_RECEIVED: 'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300',
  RETURN_STATUS_REFUNDED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  RETURN_STATUS_REJECTED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  STAFF_INVITED: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300',
  STAFF_CREATED: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300',
  STAFF_ROLE_CHANGED: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300',
  STAFF_ACTIVATED: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  STAFF_DEACTIVATED: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300',
  STAFF_DELETED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  STAFF_PASSWORD_RESET: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300',
  SHIPMENT_STATUS_DELIVERED: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  SHIPMENT_STATUS_IN_TRANSIT: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
  SHIPMENT_STATUS_LABEL_CREATED: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
  SHIPMENT_CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  SHIPMENT_TRACKING_UPDATED: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  SHIPMENTS_BATCH_CREATED: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300',
  USER_BLOCKED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  USER_UNBLOCKED: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  CUSTOMER_BULK_TAGGED: 'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-300',
  CUSTOMER_EMAIL_SENT: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
  CUSTOMER_TAGS_CHANGED: 'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-300',
  SETTINGS_UPDATED: 'bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-300',
  COUPON_CREATED: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/20 dark:text-fuchsia-300',
  SUPPLIER_CREATED: 'bg-lime-100 text-lime-800 dark:bg-lime-500/20 dark:text-lime-300',
  SUPPLIER_UPDATED: 'bg-lime-100 text-lime-800 dark:bg-lime-500/20 dark:text-lime-300',
  SUPPLIER_DELETED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  SUPPLIER_DELIVERY_RECEIVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  SUPPLIER_PAYMENT: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  SUPPLIER_PAYMENT_UPDATED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  SUPPLIER_PAYMENT_DELETED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  SUPPLIER_DELIVERY_CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  INVENTORY_BATCH_TRANSFER: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300',
  INVENTORY_CSV_INTAKE: 'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300',
  STOCKTAKE_STARTED: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  STOCKTAKE_DELETED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  STOCKTAKE_CORRECTION_STARTED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  PRODUCTS_CATEGORY_CHANGED: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300',
  CATEGORY_ARCHIVED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  CATEGORY_ARCHIVED_WITH_MOVE: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  CATEGORY_ARCHIVE_BLOCKED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  CATEGORY_REACTIVATED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  EBAY_POLICY_IDS_UPDATED: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  EBAY_MERCHANT_LOCATION_ENSURED: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  ADMIN_PASSWORD_RESET: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300',
  MAINTENANCE_AUTO_DISABLED: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300',
  EMERGENCY_RECOVERY: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  ORDER_AUTO_CANCELLED: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300',
  PRODUCTS_CHANNEL_ENABLED: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  PRODUCTS_CHANNEL_DISABLED: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300',
  DELIVERY_CREATED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  PAYMENT_CREATED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
}

const ACTION_LABELS: Record<string, { de: string; en: string; ar: string }> = {
  ADMIN_LOGIN: { de: 'Admin-Anmeldung', en: 'Admin login', ar: 'تسجيل دخول المشرف' },
  ADMIN_LOGIN_FAILED: { de: 'Anmeldung fehlgeschlagen', en: 'Login failed', ar: 'فشل تسجيل الدخول' },
  ORDER_CREATED: { de: 'Bestellung erstellt', en: 'Order created', ar: 'طلب جديد' },
  ORDER_STATUS_CHANGED: { de: 'Bestellstatus geändert', en: 'Order status changed', ar: 'تغيير حالة الطلب' },
  ORDER_CANCELLED: { de: 'Bestellung storniert', en: 'Order cancelled', ar: 'إلغاء الطلب' },
  ORDER_AUTO_CANCELLED: { de: 'Automatisch storniert (Zahlungstimeout)', en: 'Auto-cancelled (payment timeout)', ar: 'إلغاء تلقائي (انتهاء مهلة الدفع)' },
  PRODUCT_CREATED: { de: 'Produkt erstellt', en: 'Product created', ar: 'منتج جديد' },
  PRODUCT_UPDATED: { de: 'Produkt bearbeitet', en: 'Product updated', ar: 'تعديل المنتج' },
  PRODUCT_DELETED: { de: 'Produkt gelöscht', en: 'Product deleted', ar: 'حذف المنتج' },
  PRODUCT_HARD_DELETED: { de: 'Produkt endgültig gelöscht', en: 'Product permanently deleted', ar: 'حذف المنتج نهائياً' },
  PRODUCT_RESTORED: { de: 'Produkt wiederhergestellt', en: 'Product restored', ar: 'استعادة المنتج' },
  INVENTORY_INTAKE: { de: 'Wareneingang', en: 'Stock received', ar: 'استلام بضاعة' },
  INVENTORY_OUTPUT: { de: 'Warenausgang', en: 'Stock output', ar: 'صرف بضاعة' },
  INVENTORY_ADJUSTED: { de: 'Bestand korrigiert', en: 'Stock adjusted', ar: 'تعديل المخزون' },
  INVENTORY_TRANSFER: { de: 'Bestandstransfer', en: 'Stock transfer', ar: 'نقل المخزون' },
  STAFF_INVITED: { de: 'Mitarbeiter eingeladen', en: 'Staff invited', ar: 'دعوة موظف' },
  STAFF_ROLE_CHANGED: { de: 'Rolle geändert', en: 'Role changed', ar: 'تغيير الدور' },
  STAFF_DEACTIVATED: { de: 'Mitarbeiter deaktiviert', en: 'Staff deactivated', ar: 'تعطيل الموظف' },
  STAFF_PASSWORD_RESET: { de: 'Passwort zurückgesetzt', en: 'Password reset', ar: 'إعادة تعيين كلمة المرور' },
  RETURN_LABEL_UPDATED: { de: 'Rücksendeetikett erstellt', en: 'Return label created', ar: 'إنشاء ملصق الإرجاع' },
  RETURN_APPROVED: { de: 'Retoure genehmigt', en: 'Return approved', ar: 'موافقة الإرجاع' },
  RETURN_SCANNED: { de: 'Retoure gescannt', en: 'Return scanned', ar: 'مسح المرتجع' },
  RETURN_RECEIVED: { de: 'Retoure eingetroffen', en: 'Return received', ar: 'استلام المرتجع' },
  RETURN_INSPECTED: { de: 'Retoure geprüft', en: 'Return inspected', ar: 'فحص المرتجع' },
  RETURN_INSPECTED_NO_DOUBLE_RESTOCK: {
    de: 'Retoure geprüft — Doppelbuchung verhindert',
    en: 'Return inspected — double-restock prevented',
    ar: 'فحص المرتجع — تم منع الازدواج',
  },
  RETURN_DAMAGED_REMOVED_FROM_STOCK: {
    de: 'Beschädigte Ware aus Bestand entfernt',
    en: 'Damaged item removed from stock',
    ar: 'إزالة البضائع التالفة من المخزون',
  },
  RETURN_REJECTED: { de: 'Retoure abgelehnt', en: 'Return rejected', ar: 'رفض المرتجع' },
  RETURN_REFUNDED: { de: 'Erstattung verarbeitet', en: 'Refund processed', ar: 'معالجة الاسترداد' },
  RETURN_REFUND_FAILED: { de: 'Erstattung fehlgeschlagen', en: 'Refund failed', ar: 'فشل الاسترداد' },
  VORKASSE_REFUND_CONFIRMED: { de: 'Vorkasse-Überweisung bestätigt', en: 'Vorkasse transfer confirmed', ar: 'تأكيد التحويل المصرفي' },
  ORDER_PARTIAL_CANCEL: { de: 'Teilstornierung', en: 'Partial cancel', ar: 'إلغاء جزئي' },
  ORDER_FULFILLMENT_CHANGED: { de: 'Lager geändert', en: 'Fulfillment changed', ar: 'تغيير المستودع' },
  ORDER_ITEM_WAREHOUSE_CHANGED: { de: 'Artikel-Lager geändert', en: 'Item warehouse changed', ar: 'تغيير مستودع العنصر' },
  ORDER_WAREHOUSE_CONSOLIDATED: { de: 'Lager konsolidiert', en: 'Warehouse consolidated', ar: 'دمج المستودعات' },
  WAREHOUSE_CHANGE_BLOCKED_AFTER_CAPTURE: { de: 'Lager-Wechsel blockiert (nach Zahlung)', en: 'Warehouse change blocked (post-capture)', ar: 'تم حظر تغيير المستودع (بعد الدفع)' },
  PHANTOM_RESERVATION_CLEANED: { de: 'Phantom-Reservierung bereinigt', en: 'Phantom reservation cleaned', ar: 'تم تنظيف حجز وهمي' },
  ORDER_CANCELLED_PRE_PAYMENT: { de: 'Storno vor Zahlung', en: 'Cancelled pre-payment', ar: 'إلغاء قبل الدفع' },
  ORDER_CANCELLED_POST_PAYMENT: { de: 'Storno mit Erstattung', en: 'Cancelled post-payment', ar: 'إلغاء مع استرداد' },
  CUSTOMER_BULK_TAGGED: { de: 'Kunden getaggt', en: 'Customers tagged', ar: 'وسم العملاء' },
  CUSTOMER_EMAIL_SENT: { de: 'E-Mail gesendet', en: 'Email sent', ar: 'إرسال بريد' },
  CUSTOMER_TAGS_CHANGED: { de: 'Kunden-Tags geändert', en: 'Tags changed', ar: 'تغيير الوسوم' },
  INVENTORY_TRANSFERRED: { de: 'Bestand transferiert', en: 'Stock transferred', ar: 'نقل المخزون' },
  PRODUCT_DUPLICATED: { de: 'Produkt dupliziert', en: 'Product duplicated', ar: 'نسخ المنتج' },
  PRODUCT_PRICE_CHANGED: { de: 'Preis geändert', en: 'Price changed', ar: 'تغيير السعر' },
  PRODUCTS_ACTIVATED: { de: 'Produkte aktiviert', en: 'Products activated', ar: 'تفعيل المنتجات' },
  PRODUCTS_DEACTIVATED: { de: 'Produkte deaktiviert', en: 'Products deactivated', ar: 'تعطيل المنتجات' },
  PRODUCTS_DELETED: { de: 'Produkte gelöscht', en: 'Products deleted', ar: 'حذف المنتجات' },
  RETURN_STATUS_APPROVED: { de: 'Retoure genehmigt', en: 'Return approved', ar: 'موافقة الإرجاع' },
  RETURN_STATUS_INSPECTED: { de: 'Retoure geprüft', en: 'Return inspected', ar: 'فحص المرتجع' },
  RETURN_STATUS_LABEL_SENT: { de: 'Label gesendet', en: 'Label sent', ar: 'إرسال الملصق' },
  RETURN_STATUS_RECEIVED: { de: 'Retoure eingetroffen', en: 'Return received', ar: 'استلام المرتجع' },
  RETURN_STATUS_REFUNDED: { de: 'Erstattet', en: 'Refunded', ar: 'تم الاسترداد' },
  RETURN_STATUS_REJECTED: { de: 'Retoure abgelehnt', en: 'Return rejected', ar: 'رفض المرتجع' },
  SETTINGS_UPDATED: { de: 'Einstellungen geändert', en: 'Settings updated', ar: 'تحديث الإعدادات' },
  COUPON_CREATED: { de: 'Gutschein erstellt', en: 'Coupon created', ar: 'إنشاء قسيمة' },
  STAFF_ACTIVATED: { de: 'Mitarbeiter aktiviert', en: 'Staff activated', ar: 'تفعيل الموظف' },
  STAFF_CREATED: { de: 'Mitarbeiter erstellt', en: 'Staff created', ar: 'إنشاء موظف' },
  STAFF_DELETED: { de: 'Mitarbeiter gelöscht', en: 'Staff deleted', ar: 'حذف الموظف' },
  SHIPMENT_STATUS_DELIVERED: { de: 'Zugestellt', en: 'Delivered', ar: 'تم التسليم' },
  SHIPMENT_STATUS_IN_TRANSIT: { de: 'Unterwegs', en: 'In transit', ar: 'في الطريق' },
  SHIPMENT_STATUS_LABEL_CREATED: { de: 'Versandlabel erstellt', en: 'Label created', ar: 'إنشاء ملصق الشحن' },
  SHIPMENT_CANCELLED: { de: 'Versand storniert', en: 'Shipment cancelled', ar: 'إلغاء الشحنة' },
  SHIPMENT_TRACKING_UPDATED: { de: 'Tracking aktualisiert', en: 'Tracking updated', ar: 'تحديث التتبع' },
  SHIPMENTS_BATCH_CREATED: { de: 'Sammelversand erstellt', en: 'Batch created', ar: 'إنشاء شحنة جماعية' },
  USER_BLOCKED: { de: 'Benutzer gesperrt', en: 'User blocked', ar: 'حظر المستخدم' },
  USER_UNBLOCKED: { de: 'Benutzer entsperrt', en: 'User unblocked', ar: 'إلغاء حظر المستخدم' },
  VARIANT_COLOR_ADDED: { de: 'Farbe hinzugefügt', en: 'Color added', ar: 'إضافة لون' },
  VARIANT_DELETED: { de: 'Variante gelöscht', en: 'Variant deleted', ar: 'حذف المتغير' },
  VARIANT_SIZE_ADDED: { de: 'Größe hinzugefügt', en: 'Size added', ar: 'إضافة مقاس' },
  VARIANT_UPDATED: { de: 'Variante aktualisiert', en: 'Variant updated', ar: 'تحديث المتغير' },
  SUPPLIER_CREATED: { de: 'Lieferant erstellt', en: 'Supplier created', ar: 'إنشاء مورد' },
  SUPPLIER_UPDATED: { de: 'Lieferant bearbeitet', en: 'Supplier updated', ar: 'تعديل المورد' },
  SUPPLIER_DELETED: { de: 'Lieferant gelöscht', en: 'Supplier deleted', ar: 'حذف المورد' },
  SUPPLIER_DELIVERY_RECEIVED: { de: 'Wareneingang', en: 'Delivery received', ar: 'استلام بضاعة من مورد' },
  SUPPLIER_PAYMENT: { de: 'Lieferantenzahlung', en: 'Supplier payment', ar: 'دفع للمورد' },
  SUPPLIER_PAYMENT_UPDATED: { de: 'Zahlung bearbeitet', en: 'Payment updated', ar: 'تعديل الدفعة' },
  SUPPLIER_PAYMENT_DELETED: { de: 'Zahlung gelöscht', en: 'Payment deleted', ar: 'حذف الدفعة' },
  SUPPLIER_DELIVERY_CANCELLED: { de: 'Lieferung storniert', en: 'Delivery cancelled', ar: 'إلغاء التوريد' },
  INVENTORY_BATCH_TRANSFER: { de: 'Sammel-Transfer', en: 'Batch transfer', ar: 'نقل جماعي بين المستودعات' },
  INVENTORY_CSV_INTAKE: { de: 'CSV-Wareneingang', en: 'CSV stock intake', ar: 'استلام بضاعة عبر CSV' },
  STOCKTAKE_STARTED: { de: 'Inventur gestartet', en: 'Stocktake started', ar: 'بدء الجرد' },
  STOCKTAKE_DELETED: { de: 'Inventur verworfen', en: 'Stocktake discarded', ar: 'تم تجاهل الجرد' },
  STOCKTAKE_CORRECTION_STARTED: { de: 'Korrektur-Inventur gestartet', en: 'Correction stocktake started', ar: 'بدء جرد تصحيحي' },
  PRODUCTS_CATEGORY_CHANGED: { de: 'Kategorie geändert', en: 'Category changed', ar: 'تغيير فئة المنتجات' },
  CATEGORY_ARCHIVED: { de: 'Kategorie archiviert', en: 'Category archived', ar: 'تم أرشفة الفئة' },
  CATEGORY_ARCHIVED_WITH_MOVE: { de: 'Kategorie archiviert (Produkte verschoben)', en: 'Category archived (products moved)', ar: 'أرشفة الفئة (نُقلت المنتجات)' },
  CATEGORY_ARCHIVE_BLOCKED: { de: 'Archivierung blockiert', en: 'Archive blocked', ar: 'تم منع الأرشفة' },
  CATEGORY_REACTIVATED: { de: 'Kategorie reaktiviert', en: 'Category reactivated', ar: 'تمت إعادة تفعيل الفئة' },
  EBAY_POLICY_IDS_UPDATED: { de: 'eBay-Policy-IDs aktualisiert', en: 'eBay policy IDs updated', ar: 'تم تحديث معرّفات سياسات eBay' },
  EBAY_MERCHANT_LOCATION_ENSURED: { de: 'eBay-Merchant-Location eingerichtet', en: 'eBay merchant location ensured', ar: 'تم إعداد موقع التاجر eBay' },
  PRODUCTS_CHANNEL_ENABLED: { de: 'Kanal aktiviert', en: 'Channel enabled', ar: 'تفعيل القناة' },
  PRODUCTS_CHANNEL_DISABLED: { de: 'Kanal deaktiviert', en: 'Channel disabled', ar: 'إلغاء تفعيل القناة' },
  DELIVERY_CREATED: { de: 'Lieferung erstellt', en: 'Delivery created', ar: 'إنشاء توصيل' },
  PAYMENT_CREATED: { de: 'Zahlung erstellt', en: 'Payment created', ar: 'إنشاء دفعة' },
  ADMIN_PASSWORD_RESET: { de: 'Admin-Passwort zurückgesetzt', en: 'Admin password reset', ar: 'إعادة تعيين كلمة مرور المشرف' },
  MAINTENANCE_AUTO_DISABLED: { de: 'Wartungsmodus automatisch beendet', en: 'Maintenance auto-disabled', ar: 'إيقاف وضع الصيانة تلقائياً' },
  EMERGENCY_RECOVERY: { de: 'Notfall-Wiederherstellung', en: 'Emergency recovery', ar: 'استعادة طوارئ' },
}

function getActionLabel(action: string, locale: string): string {
  const label = ACTION_LABELS[action]
  if (label) return locale === 'ar' ? label.ar : locale === 'en' ? label.en : label.de
  // Fallback: make technical name readable
  return action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
}

function getActionColor(action: string) {
  return ACTION_COLORS[action] ?? 'bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-300'
}

export default function AuditLogPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const [adminFilter, setAdminFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit-log', adminFilter, actionFilter, page],
    queryFn: async () => {
      const params: Record<string, string> = { page: String(page), limit: '30' }
      if (adminFilter) params.adminId = adminFilter
      if (actionFilter) params.action = actionFilter
      const { data } = await api.get('/admin/audit-log', { params })
      return data
    },
  })

  const { data: admins } = useQuery({
    queryKey: ['admin-audit-admins'],
    queryFn: async () => { const { data } = await api.get('/admin/audit-log/admins'); return data },
  })

  const { data: actionTypes } = useQuery({
    queryKey: ['admin-audit-actions'],
    queryFn: async () => { const { data } = await api.get('/admin/audit-log/actions'); return data },
  })

  const logs = data?.data ?? []
  const meta = data?.meta ?? { total: 0, page: 1, totalPages: 1 }
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())
  const toggleDay = (dk: string) => setCollapsedDays((prev) => { const n = new Set(prev); n.has(dk) ? n.delete(dk) : n.add(dk); return n })
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const toggleGroup = (gk: string) => setCollapsedGroups((prev) => { const n = new Set(prev); n.has(gk) ? n.delete(gk) : n.add(gk); return n })


  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('auditLog.title') }]} />
      <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
        <ScrollText className="h-6 w-6" />
        {t('auditLog.title')}
      </h1>
      <p className="text-sm text-muted-foreground mb-6">{t('auditLog.description')}</p>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="min-w-[220px]">
          <SearchableSelect
            value={adminFilter}
            onChange={(v) => { setAdminFilter(v); setPage(1) }}
            options={(admins ?? []).map((a: any) => ({ value: a.id, label: `${a.firstName} ${a.lastName}`.trim() || a.email || a.id }))}
            placeholder={t('auditLog.allAdmins')}
            searchPlaceholder={locale === 'ar' ? 'ابحث عن مشرف...' : locale === 'en' ? 'Search admin...' : 'Admin suchen...'}
            emptyLabel={t('auditLog.allAdmins')}
          />
        </div>
        <div className="min-w-[260px]">
          <SearchableSelect
            value={actionFilter}
            onChange={(v) => { setActionFilter(v); setPage(1) }}
            options={(actionTypes ?? []).map((a: string) => ({ value: a, label: getActionLabel(a, locale), sublabel: a }))}
            placeholder={t('auditLog.allActions')}
            searchPlaceholder={locale === 'ar' ? 'ابحث عن إجراء...' : locale === 'en' ? 'Search action...' : 'Aktion suchen...'}
            emptyLabel={t('auditLog.allActions')}
          />
        </div>
      </div>

      {/* Table with Day Grouping */}
      {(() => {
        const dateFmt = locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'de' ? 'de-DE' : 'en-GB'
        const entityLabels: Record<string, string> = {
          order: locale === 'ar' ? 'طلب' : locale === 'en' ? 'Order' : 'Bestellung',
          product: locale === 'ar' ? 'منتج' : locale === 'en' ? 'Product' : 'Produkt',
          inventory: locale === 'ar' ? 'المخزون' : locale === 'en' ? 'Inventory' : 'Lager',
          user: locale === 'ar' ? 'مستخدم' : locale === 'en' ? 'User' : 'Benutzer',
          auth: locale === 'ar' ? 'المصادقة' : locale === 'en' ? 'Auth' : 'Anmeldung',
          return: locale === 'ar' ? 'إرجاع' : locale === 'en' ? 'Return' : 'Retoure',
          variant: locale === 'ar' ? 'متغير' : locale === 'en' ? 'Variant' : 'Variante',
          category: locale === 'ar' ? 'فئة' : locale === 'en' ? 'Category' : 'Kategorie',
          coupon: locale === 'ar' ? 'قسيمة' : locale === 'en' ? 'Coupon' : 'Gutschein',
          settings: locale === 'ar' ? 'الإعدادات' : locale === 'en' ? 'Settings' : 'Einstellungen',
          supplier: locale === 'ar' ? 'مورد' : locale === 'en' ? 'Supplier' : 'Lieferant',
          supplier_delivery: locale === 'ar' ? 'توريد' : locale === 'en' ? 'Delivery' : 'Wareneingang',
          shipment: locale === 'ar' ? 'شحنة' : locale === 'en' ? 'Shipment' : 'Sendung',
          stocktake: locale === 'ar' ? 'جرد' : locale === 'en' ? 'Stocktake' : 'Inventur',
          staff: locale === 'ar' ? 'موظف' : locale === 'en' ? 'Staff' : 'Mitarbeiter',
          payment: locale === 'ar' ? 'دفعة' : locale === 'en' ? 'Payment' : 'Zahlung',
          contact_message: locale === 'ar' ? 'رسالة تواصل' : locale === 'en' ? 'Contact message' : 'Kontaktnachricht',
        }
        const entityLink = (type: string, id: string) => {
          const links: Record<string, string> = {
            order: `/${locale}/admin/orders/${id}`,
            product: `/${locale}/admin/products/${id}`,
            user: `/${locale}/admin/customers/${id}`,
            return: `/${locale}/admin/returns`,
            inventory: `/${locale}/admin/inventory`,
            supplier: `/${locale}/admin/suppliers/${id}`,
            supplier_delivery: `/${locale}/admin/suppliers`,
            stocktake: `/${locale}/admin/inventory/stocktake`,
            staff: `/${locale}/admin/staff`,
            contact_message: `/${locale}/admin/contact-messages`,
          }
          return links[type]
        }

        // Group by date → then by admin name
        const grouped: Record<string, Record<string, any[]>> = {}
        for (const log of logs) {
          const dk = new Date(log.createdAt).toISOString().slice(0, 10)
          const adminName = log.adminName || 'System'
          if (!grouped[dk]) grouped[dk] = {}
          if (!grouped[dk][adminName]) grouped[dk][adminName] = []
          grouped[dk][adminName].push(log)
        }

        const renderLogRow = (log: any) => {
          const dt = new Date(log.createdAt)
          const timeStr = dt.toLocaleTimeString(dateFmt, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          const entity = entityLabels[log.entityType] ?? log.entityType ?? ''
          const link = entityLink(log.entityType, log.entityId)
          const ch = log.changes as any
          const isExp = expandedId === log.id

          return (
            <tr key={log.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
              <td className="px-4 py-2.5 ltr:pl-14 rtl:pr-14 text-sm text-muted-foreground tabular-nums whitespace-nowrap">{timeStr}</td>
              <td className="px-4 py-2.5">
                <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                  {getActionLabel(log.action, locale)}
                </span>
              </td>
              <td className="px-4 py-2.5 text-sm">
                {link ? (
                  <a href={link} className="inline-flex items-center gap-1 text-primary hover:underline">
                    {entity} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : <span className="text-muted-foreground">{entity}</span>}
              </td>
              <td className="px-4 py-2.5 text-sm">
                {ch ? (
                  <button onClick={() => setExpandedId(isExp ? null : log.id)} className="text-start">
                    {isExp ? (
                      <div className="space-y-1 max-w-[420px]">
                        {renderChanges(ch, locale)}
                      </div>
                    ) : (
                      <span className="text-[#d4a853] hover:underline">{locale === 'ar' ? 'التفاصيل' : 'Details'}</span>
                    )}
                  </button>
                ) : <span className="text-muted-foreground/30">—</span>}
              </td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground/60 font-mono tabular-nums">{log.ipAddress ?? '—'}</td>
            </tr>
          )
        }

        return (
          <div className="bg-background border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-start px-4 py-3 font-semibold text-[15px]">{locale === 'ar' ? 'الوقت' : locale === 'en' ? 'Time' : 'Zeit'}</th>
                    <th className="text-start px-4 py-3 font-semibold text-[15px]">{locale === 'ar' ? 'الإجراء' : locale === 'en' ? 'Action' : 'Aktion'}</th>
                    <th className="text-start px-4 py-3 font-semibold text-[15px]">{locale === 'ar' ? 'الكائن' : locale === 'en' ? 'Object' : 'Objekt'}</th>
                    <th className="text-start px-4 py-3 font-semibold text-[15px]">{locale === 'ar' ? 'التغييرات' : locale === 'en' ? 'Changes' : 'Änderungen'}</th>
                    <th className="text-start px-4 py-3 font-semibold text-[15px]">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b">{Array.from({ length: 5 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}</tr>
                    ))
                  ) : logs.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-16 text-center">
                      <ScrollText className="h-10 w-10 mx-auto mb-2 text-muted-foreground/15" />
                      <p className="text-muted-foreground text-sm">{t('auditLog.noEntries')}</p>
                    </td></tr>
                  ) : Object.entries(grouped).map(([dateKey, adminGroups]) => {
                    const dateLabel = new Date(dateKey + 'T12:00:00').toLocaleDateString(dateFmt, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
                    const isDayCollapsed = collapsedDays.has(dateKey)
                    const totalDayLogs = Object.values(adminGroups).reduce((s, g) => s + g.length, 0)

                    return [
                      // === Day header ===
                      <tr key={`day-${dateKey}`} className="bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => toggleDay(dateKey)}>
                        <td colSpan={5} className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isDayCollapsed ? '' : 'rotate-90'}`} />
                            <span className="text-sm font-bold">{dateLabel}</span>
                            <span className="text-xs text-muted-foreground/60">{totalDayLogs} {locale === 'ar' ? 'إجراء' : 'Einträge'}</span>
                          </div>
                        </td>
                      </tr>,
                      // === Admin groups inside day ===
                      ...(isDayCollapsed ? [] : Object.entries(adminGroups).map(([adminName, adminLogs]) => {
                        const groupKey = `${dateKey}::${adminName}`
                        const isGroupCollapsed = collapsedGroups.has(groupKey)

                        return [
                          // Admin sub-header
                          <tr key={`grp-${groupKey}`} className="bg-muted/10 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => toggleGroup(groupKey)}>
                            <td colSpan={5} className="px-4 ltr:pl-8 rtl:pr-8 py-2.5">
                              <div className="flex items-center gap-3">
                                <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-200 ${isGroupCollapsed ? '' : 'rotate-90'}`} />
                                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-[#d4a853]/15 text-[#d4a853] text-xs font-bold">
                                  {adminName.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-sm font-semibold">{adminName}</span>
                                <span className="text-xs text-muted-foreground/50 tabular-nums">
                                  {adminLogs.length} {locale === 'ar' ? 'إجراء' : locale === 'en' ? 'actions' : 'Aktionen'}
                                </span>
                              </div>
                            </td>
                          </tr>,
                          // Individual log rows
                          ...(isGroupCollapsed ? [] : adminLogs.map(renderLogRow)),
                        ]
                      }).flat()),
                    ]
                  }).flat()}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}


      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">
            {t('auditLog.page', { page: meta.page, total: meta.totalPages })}
          </p>
          {/* dir="ltr" on the pagination container forces left-to-right
              button order (prev, next) even when the surrounding page is
              Arabic/RTL. This matches the Amazon/Zalando/Shopify Arabic
              convention: arrow direction and position agree (← on left,
              → on right, both pointing outward from the counter). */}
          <div className="flex gap-2" dir="ltr">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="gap-1.5 px-4"
            >
              <ChevronLeft className="h-4 w-4" />
              {t('auditLog.prev')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.totalPages}
              onClick={() => setPage(page + 1)}
              className="gap-1.5 px-4"
            >
              {t('auditLog.next')}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
