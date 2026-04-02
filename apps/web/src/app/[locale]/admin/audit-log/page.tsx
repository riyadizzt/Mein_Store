'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { ScrollText, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const ACTION_COLORS: Record<string, string> = {
  ADMIN_LOGIN: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  ADMIN_LOGIN_FAILED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  ORDER_CREATED: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  ORDER_STATUS_CHANGED: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300',
  ORDER_CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  ORDER_PARTIAL_CANCEL: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300',
  ORDER_FULFILLMENT_CHANGED: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300',
  PRODUCT_CREATED: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300',
  PRODUCT_UPDATED: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300',
  PRODUCT_DELETED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
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
  RETURN_REJECTED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  RETURN_REFUNDED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
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
}

const ACTION_LABELS: Record<string, { de: string; en: string; ar: string }> = {
  ADMIN_LOGIN: { de: 'Admin-Anmeldung', en: 'Admin login', ar: 'تسجيل دخول المشرف' },
  ADMIN_LOGIN_FAILED: { de: 'Anmeldung fehlgeschlagen', en: 'Login failed', ar: 'فشل تسجيل الدخول' },
  ORDER_CREATED: { de: 'Bestellung erstellt', en: 'Order created', ar: 'طلب جديد' },
  ORDER_STATUS_CHANGED: { de: 'Bestellstatus geändert', en: 'Order status changed', ar: 'تغيير حالة الطلب' },
  ORDER_CANCELLED: { de: 'Bestellung storniert', en: 'Order cancelled', ar: 'إلغاء الطلب' },
  PRODUCT_CREATED: { de: 'Produkt erstellt', en: 'Product created', ar: 'منتج جديد' },
  PRODUCT_UPDATED: { de: 'Produkt bearbeitet', en: 'Product updated', ar: 'تعديل المنتج' },
  PRODUCT_DELETED: { de: 'Produkt gelöscht', en: 'Product deleted', ar: 'حذف المنتج' },
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
  RETURN_REJECTED: { de: 'Retoure abgelehnt', en: 'Return rejected', ar: 'رفض المرتجع' },
  RETURN_REFUNDED: { de: 'Erstattung verarbeitet', en: 'Refund processed', ar: 'معالجة الاسترداد' },
  ORDER_PARTIAL_CANCEL: { de: 'Teilstornierung', en: 'Partial cancel', ar: 'إلغاء جزئي' },
  ORDER_FULFILLMENT_CHANGED: { de: 'Lager geändert', en: 'Fulfillment changed', ar: 'تغيير المستودع' },
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
        <select value={adminFilter} onChange={(e) => { setAdminFilter(e.target.value); setPage(1) }} className="h-10 px-3 rounded-lg border bg-background text-sm min-w-[180px]">
          <option value="">{t('auditLog.allAdmins')}</option>
          {(admins ?? []).map((a: any) => (
            <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>
          ))}
        </select>
        <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1) }} className="h-10 px-3 rounded-lg border bg-background text-sm min-w-[180px]">
          <option value="">{t('auditLog.allActions')}</option>
          {(actionTypes ?? []).map((a: string) => (
            <option key={a} value={a}>{getActionLabel(a, locale)}</option>
          ))}
        </select>
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
        }
        const entityLink = (type: string, id: string) => {
          const links: Record<string, string> = { order: `/${locale}/admin/orders/${id}`, product: `/${locale}/admin/products/${id}`, user: `/${locale}/admin/customers/${id}`, return: `/${locale}/admin/returns`, inventory: `/${locale}/admin/inventory`, supplier: `/${locale}/admin/suppliers/${id}`, supplier_delivery: `/${locale}/admin/suppliers` }
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
              <td className="px-4 py-2.5 ltr:pl-14 rtl:pr-14 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{timeStr}</td>
              <td className="px-4 py-2.5">
                <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${getActionColor(log.action)}`}>
                  {getActionLabel(log.action, locale)}
                </span>
              </td>
              <td className="px-4 py-2.5 text-xs">
                {link ? (
                  <a href={link} className="inline-flex items-center gap-1 text-primary hover:underline">
                    {entity} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : <span className="text-muted-foreground">{entity}</span>}
              </td>
              <td className="px-4 py-2.5 text-xs">
                {ch ? (
                  <button onClick={() => setExpandedId(isExp ? null : log.id)} className="text-start">
                    {isExp ? (
                      <div className="space-y-0.5 max-w-[250px]">
                        {ch.before && ch.after ? Object.keys(ch.after).map((k: string) => (
                          <div key={k} className="text-[11px]">
                            <span className="text-muted-foreground">{k}: </span>
                            {ch.before[k] !== undefined && <span className="text-red-400 line-through">{String(ch.before[k])}</span>}
                            {' '}<span className="text-green-600">{String(ch.after[k])}</span>
                          </div>
                        )) : <span className="text-[10px] text-muted-foreground">{JSON.stringify(ch).slice(0, 80)}</span>}
                      </div>
                    ) : (
                      <span className="text-[#d4a853] hover:underline">{locale === 'ar' ? 'التفاصيل' : 'Details'}</span>
                    )}
                  </button>
                ) : <span className="text-muted-foreground/30">—</span>}
              </td>
              <td className="px-4 py-2.5 text-[10px] text-muted-foreground/50 font-mono tabular-nums">{log.ipAddress ?? '—'}</td>
            </tr>
          )
        }

        return (
          <div className="bg-background border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-start px-4 py-3 font-medium text-xs">{locale === 'ar' ? 'الوقت' : 'Zeit'}</th>
                    <th className="text-start px-4 py-3 font-medium text-xs">{locale === 'ar' ? 'الإجراء' : 'Aktion'}</th>
                    <th className="text-start px-4 py-3 font-medium text-xs">{locale === 'ar' ? 'الكائن' : 'Objekt'}</th>
                    <th className="text-start px-4 py-3 font-medium text-xs">{locale === 'ar' ? 'التغييرات' : 'Änderungen'}</th>
                    <th className="text-start px-4 py-3 font-medium text-xs">IP</th>
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
                        <td colSpan={5} className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${isDayCollapsed ? '' : 'rotate-90'}`} />
                            <span className="text-xs font-bold">{dateLabel}</span>
                            <span className="text-[10px] text-muted-foreground/50">{totalDayLogs} {locale === 'ar' ? 'إجراء' : 'Einträge'}</span>
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
                            <td colSpan={5} className="px-4 ltr:pl-8 rtl:pr-8 py-2">
                              <div className="flex items-center gap-2.5">
                                <ChevronRight className={`h-3 w-3 text-muted-foreground/60 transition-transform duration-200 ${isGroupCollapsed ? '' : 'rotate-90'}`} />
                                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-[#d4a853]/15 text-[#d4a853] text-[10px] font-bold">
                                  {adminName.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-xs font-semibold">{adminName}</span>
                                <span className="text-[10px] text-muted-foreground/40 tabular-nums">
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
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" />{t('auditLog.prev')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.totalPages}
              onClick={() => setPage(page + 1)}
              className="gap-1"
            >
              {t('auditLog.next')}<ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
