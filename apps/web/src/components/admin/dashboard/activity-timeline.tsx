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
  RefreshCw,
  // C15.1 i18n bug-fix icons
  Archive,
  ShoppingBag,
  PlugZap,
  Plug,
  FolderTree,
  CloudOff,
  Cloud,
  Send,
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
  PHANTOM_RESERVATION_CLEANED:      { de: 'Phantom-Reservierung bereinigt', en: 'Phantom reservation cleaned', ar: 'تنظيف حجز وهمي',         Icon: Wrench,         color: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300' },
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
  MARKETPLACE_PULL_TICK_COMPLETED: { de: 'eBay Pull-Cron — Tick abgeschlossen', en: 'eBay pull-cron — tick completed', ar: 'مزامنة eBay الدورية — انتهى التحديث', Icon: RefreshCw, color: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300' },
  EBAY_REFUND_COMPLETED:        { de: 'eBay-Erstattung abgeschlossen',     en: 'eBay refund completed',          ar: 'تم اكتمال استرداد eBay',     Icon: BadgeEuro,     color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  EBAY_REFUND_FAILED:           { de: 'eBay-Erstattung fehlgeschlagen',    en: 'eBay refund failed',             ar: 'فشل استرداد eBay',           Icon: AlertTriangle, color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  EBAY_REFUND_PENDING_48H:      { de: 'eBay-Erstattung > 48h pending',     en: 'eBay refund > 48h pending',      ar: 'استرداد eBay معلق > 48 ساعة', Icon: Clock,         color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  EBAY_REFUND_MANUALLY_CONFIRMED: { de: 'eBay-Erstattung manuell bestätigt', en: 'eBay refund manually confirmed', ar: 'تم تأكيد استرداد eBay يدوياً', Icon: CheckCircle2, color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  EBAY_SHIPPING_PUSHED:         { de: 'eBay Tracking übertragen',         en: 'eBay tracking pushed',           ar: 'تم إرسال تتبع eBay',         Icon: Truck,         color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  EBAY_SHIPPING_PUSH_FAILED:    { de: 'eBay Tracking-Push fehlgeschlagen', en: 'eBay tracking push failed',      ar: 'فشل إرسال تتبع eBay',        Icon: AlertTriangle, color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  CHANNEL_STOCK_PUSH_FAILED:    { de: 'eBay Bestand-Sync fehlgeschlagen',  en: 'eBay stock sync failed',         ar: 'فشل مزامنة مخزون eBay',     Icon: AlertTriangle, color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  EBAY_STOCK_RATE_LIMITED:      { de: 'eBay Rate-Limit (Bestand)',         en: 'eBay rate-limit (stock)',        ar: 'حد معدل eBay (المخزون)',     Icon: Pause,         color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  CHANNEL_STOCK_RECONCILE_TICK: { de: 'eBay Bestand-Reconcile Tick',       en: 'eBay stock reconcile tick',      ar: 'تشغيل مزامنة مخزون eBay',   Icon: Activity,      color: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300' },
  // ── C15.1 audit-archive cron + webhook idempotency ──────────────
  AUDIT_ARCHIVE_COMPLETED:      { de: 'Audit-Archivierung abgeschlossen',  en: 'Audit archive completed',        ar: 'تم اكتمال أرشفة السجل',     Icon: Archive,       color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  AUDIT_ARCHIVE_FAILED:         { de: 'Audit-Archivierung fehlgeschlagen', en: 'Audit archive failed',           ar: 'فشل أرشفة السجل',           Icon: CloudOff,      color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  EBAY_WEBHOOK_DUPLICATE:       { de: 'eBay Webhook-Duplikat',             en: 'eBay webhook duplicate',         ar: 'إشعار eBay مكرر',           Icon: Copy,          color: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300' },
  // ── C15.1 i18n bug-fix — eBay Listing/OAuth/Category labels ─────
  // Previously fell back to English-prettified text on AR-dashboard.
  EBAY_ACCOUNT_DELETION_RECEIVED: { de: 'eBay Account-Löschung empfangen', en: 'eBay account deletion received', ar: 'تم استلام إشعار حذف حساب eBay', Icon: Inbox,    color: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300' },
  CATEGORY_UPDATED:             { de: 'Kategorie bearbeitet',              en: 'Category updated',               ar: 'تعديل الفئة',                Icon: FolderTree,    color: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300' },
  CATEGORY_ARCHIVED:            { de: 'Kategorie archiviert',              en: 'Category archived',              ar: 'أرشفة الفئة',                Icon: Archive,       color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  CATEGORY_ARCHIVED_WITH_MOVE:  { de: 'Kategorie archiviert (mit Verschiebung)', en: 'Category archived with move', ar: 'أرشفة الفئة مع النقل',     Icon: Archive,       color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  CATEGORY_REACTIVATED:         { de: 'Kategorie reaktiviert',             en: 'Category reactivated',           ar: 'إعادة تفعيل الفئة',          Icon: RotateCcw,     color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  CHANNEL_LISTING_ENABLED:      { de: 'Channel-Listing aktiviert',         en: 'Channel listing enabled',        ar: 'تفعيل عرض القناة',           Icon: ShoppingBag,   color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  EBAY_LISTING_CLEANUP_FOR_REGROUP: { de: 'eBay-Listing für Neugruppierung bereinigt', en: 'eBay listing cleaned up for regroup', ar: 'تنظيف عرض eBay لإعادة التجميع', Icon: RefreshCw, color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  EBAY_LISTING_DISABLED:        { de: 'eBay-Listing deaktiviert',          en: 'eBay listing disabled',          ar: 'إلغاء تفعيل عرض eBay',       Icon: Pause,         color: 'bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-300' },
  EBAY_LISTING_ENABLED:         { de: 'eBay-Listing aktiviert',            en: 'eBay listing enabled',           ar: 'تفعيل عرض eBay',             Icon: ShoppingBag,   color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  EBAY_LISTING_PUBLISHED:       { de: 'eBay-Listing veröffentlicht',       en: 'eBay listing published',         ar: 'نشر عرض eBay',               Icon: Send,          color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  EBAY_LISTING_REJECTED:        { de: 'eBay-Listing abgelehnt',            en: 'eBay listing rejected',          ar: 'رفض عرض eBay',               Icon: XCircle,       color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  EBAY_MERCHANT_LOCATION_ENSURED: { de: 'eBay Lager-Location verifiziert', en: 'eBay merchant location ensured', ar: 'تأكيد موقع تاجر eBay',       Icon: Warehouse,     color: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300' },
  EBAY_OAUTH_CONNECT_INITIATED: { de: 'eBay OAuth-Verbindung gestartet',   en: 'eBay OAuth connect initiated',   ar: 'بدء ربط OAuth مع eBay',       Icon: Plug,          color: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300' },
  EBAY_OAUTH_CONNECTED:         { de: 'eBay OAuth verbunden',              en: 'eBay OAuth connected',           ar: 'تم الربط مع eBay عبر OAuth', Icon: PlugZap,       color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  EBAY_OAUTH_DISCONNECTED:      { de: 'eBay OAuth getrennt',               en: 'eBay OAuth disconnected',        ar: 'فصل OAuth عن eBay',          Icon: Plug,          color: 'bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-300' },
  EBAY_OAUTH_REVOKED:           { de: 'eBay OAuth widerrufen',             en: 'eBay OAuth revoked',             ar: 'تم إبطال OAuth مع eBay',     Icon: ShieldAlert,   color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  EBAY_POLICY_IDS_UPDATED:      { de: 'eBay Policy-IDs aktualisiert',      en: 'eBay policy IDs updated',        ar: 'تحديث معرفات سياسات eBay',    Icon: Settings,      color: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300' },
  EBAY_PRODUCT_GROUP_PUBLISHED: { de: 'eBay Produkt-Gruppe veröffentlicht', en: 'eBay product group published',  ar: 'نشر مجموعة منتجات eBay',     Icon: Send,          color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' },
  EBAY_PUBLISH_PENDING_BATCH:   { de: 'eBay Veröffentlichungs-Batch ausstehend', en: 'eBay publish-pending batch', ar: 'دفعة نشر eBay قيد الانتظار', Icon: Cloud,      color: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300' },
  PRODUCTS_DELETED:             { de: 'Produkte gelöscht',                 en: 'Products deleted',               ar: 'حذف منتجات',                 Icon: Trash2,        color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
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
