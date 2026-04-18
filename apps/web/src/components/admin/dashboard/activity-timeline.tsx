'use client'

import type { LucideIcon } from 'lucide-react'
import {
  Settings,
  KeyRound,
  Package,
  PackagePlus,
  PackageCheck,
  Sparkles,
  Tag,
  CheckCircle2,
  XCircle,
  Pause,
  Trash2,
  RotateCcw,
  Copy,
  Palette,
  Ruler,
  Undo2,
  CreditCard,
  UserPlus,
  UserCog,
  UserCheck,
  UserMinus,
  UserX,
  Ticket,
  Radio,
  BarChart3,
  ArrowRightLeft,
  Pencil,
  Factory,
  Truck,
  Clock,
  Warehouse,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  Siren,
  ScanLine,
  Inbox,
  Search,
  Scissors,
  Activity,
  Flame,
  BadgeEuro,
  PackageX,
  AlertTriangle,
} from 'lucide-react'

interface ActionConfig {
  de: string
  en: string
  ar: string
  Icon: LucideIcon
  color: string // combined "bg-X-100 text-X-700 dark:bg-X-500/20 dark:text-X-300"
}

const ACTION_LABELS: Record<string, ActionConfig> = {
  SETTINGS_UPDATED:          { de: 'Einstellungen geändert',         en: 'Settings updated',        ar: 'تم تحديث الإعدادات',        Icon: Settings,       color: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300' },
  ADMIN_LOGIN:               { de: 'Admin-Login',                    en: 'Admin login',             ar: 'تسجيل دخول المشرف',         Icon: KeyRound,       color: 'bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300' },
  ADMIN_LOGIN_FAILED:        { de: 'Login fehlgeschlagen',           en: 'Login failed',            ar: 'فشل تسجيل الدخول',          Icon: ShieldAlert,    color: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300' },
  ADMIN_PASSWORD_RESET:      { de: 'Admin-Passwort zurückgesetzt',   en: 'Admin password reset',    ar: 'إعادة تعيين كلمة مرور المشرف', Icon: ShieldCheck,  color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300' },
  ORDER_STATUS_CHANGED:      { de: 'Bestellstatus geändert',         en: 'Order status changed',    ar: 'تم تغيير حالة الطلب',       Icon: Package,        color: 'bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-300' },
  ORDER_CANCELLED:           { de: 'Bestellung storniert',           en: 'Order cancelled',         ar: 'تم إلغاء الطلب',            Icon: XCircle,        color: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300' },
  ORDER_AUTO_CANCELLED:      { de: 'Automatisch storniert',          en: 'Auto-cancelled',          ar: 'إلغاء تلقائي',               Icon: Clock,          color: 'bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-300' },
  ORDER_REFUNDED:            { de: 'Erstattung durchgeführt',        en: 'Refund processed',        ar: 'تم الاسترداد',              Icon: Undo2,          color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  ORDER_PARTIAL_CANCEL:      { de: 'Teilstornierung',                en: 'Partial cancel',          ar: 'إلغاء جزئي',                 Icon: Scissors,       color: 'bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-300' },
  ORDER_FULFILLMENT_CHANGED: { de: 'Lager geändert',                 en: 'Warehouse changed',       ar: 'تم تغيير المستودع',         Icon: Warehouse,      color: 'bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-300' },
  ORDER_ITEM_WAREHOUSE_CHANGED: { de: 'Artikel-Lager geändert',      en: 'Item warehouse moved',    ar: 'تغيير مستودع العنصر',        Icon: ArrowRightLeft, color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' },
  ORDER_WAREHOUSE_CONSOLIDATED: { de: 'Lager konsolidiert',         en: 'Warehouse consolidated',  ar: 'دمج المستودعات',            Icon: Warehouse,      color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' },
  WAREHOUSE_CHANGE_BLOCKED_AFTER_CAPTURE: { de: 'Lager-Wechsel blockiert',     en: 'Warehouse change blocked', ar: 'حظر تغيير المستودع',     Icon: ShieldAlert,    color: 'bg-red-100 text-red-800 dark:bg-red-600/30 dark:text-red-200' },
  ORDER_CANCELLED_PRE_PAYMENT: { de: 'Storno vor Zahlung',          en: 'Cancelled pre-payment',   ar: 'إلغاء قبل الدفع',           Icon: XCircle,        color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  ORDER_CANCELLED_POST_PAYMENT: { de: 'Storno mit Erstattung',      en: 'Cancelled post-payment',  ar: 'إلغاء مع استرداد',          Icon: Undo2,          color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  PRODUCT_CREATED:           { de: 'Neues Produkt erstellt',         en: 'New product created',    ar: 'تم إنشاء منتج جديد',        Icon: Sparkles,       color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  PRODUCT_PRICE_CHANGED:     { de: 'Preis geändert',                 en: 'Price changed',           ar: 'تم تغيير السعر',            Icon: Tag,            color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  PRODUCT_DELETED:           { de: 'Produkt gelöscht',               en: 'Product deleted',         ar: 'تم حذف المنتج',             Icon: Trash2,         color: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300' },
  PRODUCT_HARD_DELETED:      { de: 'Produkt endgültig gelöscht',     en: 'Product permanently deleted', ar: 'حذف المنتج نهائياً',     Icon: Flame,          color: 'bg-red-200 text-red-700 dark:bg-red-600/30 dark:text-red-200' },
  PRODUCT_RESTORED:          { de: 'Produkt wiederhergestellt',      en: 'Product restored',       ar: 'تم استعادة المنتج',         Icon: RotateCcw,      color: 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-300' },
  PRODUCT_DUPLICATED:        { de: 'Produkt dupliziert',             en: 'Product duplicated',     ar: 'تم نسخ المنتج',             Icon: Copy,           color: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300' },
  PRODUCTS_ACTIVATED:        { de: 'Produkte aktiviert',             en: 'Products activated',     ar: 'تم تفعيل المنتجات',         Icon: CheckCircle2,   color: 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-300' },
  PRODUCTS_DEACTIVATED:      { de: 'Produkte deaktiviert',           en: 'Products deactivated',   ar: 'تم إلغاء تفعيل المنتجات',   Icon: Pause,          color: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300' },
  PRODUCTS_CHANNEL_ENABLED:  { de: 'Kanal aktiviert',                en: 'Channel enabled',        ar: 'تم تفعيل القناة',           Icon: Radio,          color: 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-300' },
  PRODUCTS_CHANNEL_DISABLED: { de: 'Kanal deaktiviert',              en: 'Channel disabled',       ar: 'تم إلغاء تفعيل القناة',     Icon: Radio,          color: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300' },
  VARIANT_COLOR_ADDED:       { de: 'Neue Farbe hinzugefügt',         en: 'New color added',        ar: 'تم إضافة لون جديد',         Icon: Palette,        color: 'bg-pink-100 text-pink-600 dark:bg-pink-500/20 dark:text-pink-300' },
  VARIANT_SIZE_ADDED:        { de: 'Neue Größe hinzugefügt',         en: 'New size added',         ar: 'تم إضافة مقاس جديد',        Icon: Ruler,          color: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300' },
  VARIANT_UPDATED:           { de: 'Variante aktualisiert',          en: 'Variant updated',        ar: 'تم تحديث المتغير',          Icon: Pencil,         color: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300' },
  VARIANT_DELETED:           { de: 'Variante gelöscht',              en: 'Variant deleted',        ar: 'تم حذف المتغير',            Icon: Trash2,         color: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300' },
  INVENTORY_ADJUSTED:        { de: 'Bestand angepasst',              en: 'Stock adjusted',         ar: 'تم تعديل المخزون',          Icon: BarChart3,      color: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-300' },
  INVENTORY_INTAKE:          { de: 'Wareneingang',                   en: 'Stock received',         ar: 'استلام بضاعة',              Icon: PackagePlus,    color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  INVENTORY_TRANSFER:        { de: 'Lager-Transfer',                 en: 'Stock transfer',         ar: 'نقل مخزون',                  Icon: ArrowRightLeft, color: 'bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300' },
  INVENTORY_TRANSFERRED:     { de: 'Bestand transferiert',           en: 'Stock transferred',      ar: 'تم نقل المخزون',             Icon: ArrowRightLeft, color: 'bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300' },
  INVENTORY_CSV_INTAKE:      { de: 'CSV-Wareneingang',               en: 'CSV stock intake',       ar: 'استلام بضاعة عبر CSV',      Icon: PackagePlus,    color: 'bg-teal-100 text-teal-600 dark:bg-teal-500/20 dark:text-teal-300' },
  PRODUCTS_CATEGORY_CHANGED: { de: 'Kategorie geändert',             en: 'Category changed',       ar: 'تغيير فئة المنتجات',        Icon: Tag,            color: 'bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-300' },
  RETURN_APPROVED:           { de: 'Retoure genehmigt',              en: 'Return approved',        ar: 'تمت الموافقة على المرتجع',  Icon: CheckCircle2,   color: 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-300' },
  RETURN_REJECTED:           { de: 'Retoure abgelehnt',              en: 'Return rejected',        ar: 'تم رفض المرتجع',            Icon: XCircle,        color: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300' },
  RETURN_SCANNED:            { de: 'Retoure gescannt',               en: 'Return scanned',         ar: 'مسح المرتجع',                Icon: ScanLine,       color: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-300' },
  RETURN_RECEIVED:           { de: 'Retoure eingetroffen',           en: 'Return received',        ar: 'استلام المرتجع',             Icon: Inbox,          color: 'bg-teal-100 text-teal-600 dark:bg-teal-500/20 dark:text-teal-300' },
  RETURN_INSPECTED:          { de: 'Retoure geprüft',                en: 'Return inspected',       ar: 'فحص المرتجع',                Icon: Search,         color: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300' },
  RETURN_INSPECTED_NO_DOUBLE_RESTOCK: { de: 'Doppelbuchung verhindert',  en: 'Double-restock prevented', ar: 'منع الازدواج',     Icon: ShieldCheck,    color: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300' },
  RETURN_DAMAGED_REMOVED_FROM_STOCK: { de: 'Beschädigt aus Bestand',    en: 'Damaged removed',          ar: 'إزالة التالف',       Icon: PackageX,       color: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300' },
  RETURN_REFUNDED:           { de: 'Erstattung verarbeitet',         en: 'Refund processed',       ar: 'تم الاسترداد',              Icon: Undo2,          color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  RETURN_REFUND_FAILED:      { de: 'Erstattung fehlgeschlagen',      en: 'Refund failed',          ar: 'فشل الاسترداد',            Icon: AlertTriangle,  color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  VORKASSE_REFUND_CONFIRMED: { de: 'Vorkasse-Überweisung bestätigt', en: 'Vorkasse transfer confirmed', ar: 'تأكيد التحويل المصرفي', Icon: BadgeEuro,      color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  STAFF_INVITED:             { de: 'Mitarbeiter eingeladen',         en: 'Staff invited',          ar: 'تمت دعوة موظف',              Icon: UserPlus,       color: 'bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300' },
  STAFF_CREATED:             { de: 'Mitarbeiter erstellt',           en: 'Staff created',          ar: 'تم إنشاء موظف',              Icon: UserPlus,       color: 'bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300' },
  STAFF_ROLE_CHANGED:        { de: 'Rolle geändert',                 en: 'Role changed',           ar: 'تم تغيير الدور',             Icon: UserCog,        color: 'bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-300' },
  STAFF_ACTIVATED:           { de: 'Mitarbeiter aktiviert',          en: 'Staff activated',        ar: 'تم تفعيل الموظف',            Icon: UserCheck,      color: 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-300' },
  STAFF_DEACTIVATED:         { de: 'Mitarbeiter deaktiviert',        en: 'Staff deactivated',      ar: 'تم تعطيل الموظف',            Icon: UserMinus,      color: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300' },
  STAFF_DELETED:             { de: 'Mitarbeiter gelöscht',           en: 'Staff deleted',          ar: 'تم حذف الموظف',              Icon: UserX,          color: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300' },
  STAFF_PASSWORD_RESET:      { de: 'Passwort zurückgesetzt',         en: 'Password reset',         ar: 'إعادة تعيين كلمة المرور',    Icon: KeyRound,       color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300' },
  COUPON_CREATED:            { de: 'Gutschein erstellt',             en: 'Coupon created',         ar: 'تم إنشاء قسيمة',             Icon: Ticket,         color: 'bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' },
  SUPPLIER_CREATED:          { de: 'Lieferant erstellt',             en: 'Supplier created',       ar: 'تم إنشاء مورد',              Icon: Factory,        color: 'bg-lime-100 text-lime-700 dark:bg-lime-500/20 dark:text-lime-300' },
  SUPPLIER_DELIVERY_RECEIVED:{ de: 'Wareneingang vom Lieferant',     en: 'Delivery received',      ar: 'استلام بضاعة من مورد',      Icon: PackageCheck,   color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  SUPPLIER_DELIVERY_CANCELLED:{ de: 'Lieferung storniert',           en: 'Delivery cancelled',     ar: 'إلغاء التوريد',              Icon: XCircle,        color: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300' },
  DELIVERY_CREATED:          { de: 'Lieferung erstellt',             en: 'Delivery created',       ar: 'تم إنشاء توصيل',             Icon: Truck,          color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  DELIVERY_CANCELLED:        { de: 'Lieferung storniert',            en: 'Delivery cancelled',     ar: 'تم إلغاء التوصيل',          Icon: XCircle,        color: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300' },
  PAYMENT_CREATED:           { de: 'Zahlung erstellt',               en: 'Payment created',        ar: 'تم إنشاء الدفع',             Icon: CreditCard,     color: 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-300' },
  MAINTENANCE_AUTO_DISABLED: { de: 'Wartungsmodus beendet',          en: 'Maintenance ended',      ar: 'إيقاف وضع الصيانة تلقائياً', Icon: Wrench,         color: 'bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-300' },
  EMERGENCY_RECOVERY:        { de: 'Notfall-Wiederherstellung',      en: 'Emergency recovery',     ar: 'استعادة طوارئ',              Icon: Siren,          color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
}

const DEFAULT_CONFIG: ActionConfig = {
  de: 'Aktivität',
  en: 'Activity',
  ar: 'نشاط',
  Icon: Activity,
  color: 'bg-slate-100 text-slate-500 dark:bg-slate-500/20 dark:text-slate-400',
}

function formatRelativeTime(date: Date, locale: string): string {
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (diff < 60) return locale === 'ar' ? 'الآن' : locale === 'en' ? 'just now' : 'gerade eben'
  if (diff < 3600) {
    const m = Math.floor(diff / 60)
    return locale === 'ar' ? `منذ ${m} دقيقة` : locale === 'en' ? `${m}m ago` : `vor ${m} Min.`
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600)
    return locale === 'ar' ? `منذ ${h} ساعة` : locale === 'en' ? `${h}h ago` : `vor ${h} Std.`
  }
  const d = Math.floor(diff / 86400)
  return locale === 'ar' ? `منذ ${d} يوم` : locale === 'en' ? `${d}d ago` : `vor ${d} Tagen`
}

export function ActivityTimeline({ actions, locale }: { actions: any[]; locale: string }) {
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  return (
    <div className="bg-background border border-border/60 rounded-2xl p-5 h-full shadow-sm">
      {/* Header with subtle gold accent bar */}
      <div className="flex items-center gap-2.5 mb-5">
        <span className="h-4 w-1 rounded-full bg-[#d4a853]" aria-hidden="true" />
        <h3 className="font-semibold text-[15px] tracking-tight">
          {t3('Letzte Aktivität', 'Recent Activity', 'آخر الأنشطة')}
        </h3>
      </div>
      {(!actions || actions.length === 0) ? (
        <p className="text-sm text-muted-foreground py-10 text-center">{t3('Keine Aktivitäten', 'No activity', 'لا توجد أنشطة')}</p>
      ) : (
        <div className="-mx-2">
          {actions.slice(0, 8).map((a: any, i: number) => {
            const cfg = ACTION_LABELS[a.action] ?? DEFAULT_CONFIG
            const label = locale === 'ar' ? cfg.ar : locale === 'en' ? cfg.en : cfg.de
            const time = formatRelativeTime(new Date(a.createdAt), locale)
            const Icon = cfg.Icon

            return (
              <div
                key={a.id ?? i}
                className="group flex items-center gap-3 px-2 py-3 rounded-xl transition-colors duration-150 hover:bg-muted/40"
              >
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ring-1 ring-border/30 ${cfg.color}`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium leading-snug text-foreground/90 truncate">{label}</p>
                </div>
                <span className="text-[11px] text-muted-foreground/70 flex-shrink-0 whitespace-nowrap tabular-nums">
                  {time}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
