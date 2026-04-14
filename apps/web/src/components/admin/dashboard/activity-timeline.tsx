'use client'

const ACTION_LABELS: Record<string, { de: string; en: string; ar: string; icon: string; color: string }> = {
  SETTINGS_UPDATED: { de: 'Einstellungen geändert', en: 'Settings updated', ar: 'تم تحديث الإعدادات', icon: '⚙', color: 'bg-gray-100 dark:bg-gray-800' },
  ADMIN_LOGIN: { de: 'Admin-Login', en: 'Admin login', ar: 'تسجيل دخول المشرف', icon: '🔑', color: 'bg-blue-100 dark:bg-blue-900/30' },
  ORDER_STATUS_CHANGED: { de: 'Bestellstatus geändert', en: 'Order status changed', ar: 'تم تغيير حالة الطلب', icon: '📦', color: 'bg-purple-100 dark:bg-purple-900/30' },
  PRODUCT_CREATED: { de: 'Neues Produkt erstellt', en: 'New product created', ar: 'تم إنشاء منتج جديد', icon: '✨', color: 'bg-green-100 dark:bg-green-900/30' },
  PRODUCT_PRICE_CHANGED: { de: 'Preis geändert', en: 'Price changed', ar: 'تم تغيير السعر', icon: '💰', color: 'bg-amber-100 dark:bg-amber-900/30' },
  PRODUCTS_ACTIVATED: { de: 'Produkte aktiviert', en: 'Products activated', ar: 'تم تفعيل المنتجات', icon: '✅', color: 'bg-green-100 dark:bg-green-900/30' },
  PRODUCTS_DEACTIVATED: { de: 'Produkte deaktiviert', en: 'Products deactivated', ar: 'تم إلغاء تفعيل المنتجات', icon: '⏸', color: 'bg-gray-100 dark:bg-gray-800' },
  PRODUCT_DELETED: { de: 'Produkt gelöscht', en: 'Product deleted', ar: 'تم حذف المنتج', icon: '🗑', color: 'bg-red-100 dark:bg-red-900/30' },
  PRODUCT_RESTORED: { de: 'Produkt wiederhergestellt', en: 'Product restored', ar: 'تم استعادة المنتج', icon: '♻', color: 'bg-green-100 dark:bg-green-900/30' },
  PRODUCT_DUPLICATED: { de: 'Produkt dupliziert', en: 'Product duplicated', ar: 'تم نسخ المنتج', icon: '📋', color: 'bg-blue-100 dark:bg-blue-900/30' },
  VARIANT_COLOR_ADDED: { de: 'Neue Farbe hinzugefügt', en: 'New color added', ar: 'تم إضافة لون جديد', icon: '🎨', color: 'bg-pink-100 dark:bg-pink-900/30' },
  VARIANT_SIZE_ADDED: { de: 'Neue Größe hinzugefügt', en: 'New size added', ar: 'تم إضافة مقاس جديد', icon: '📏', color: 'bg-indigo-100 dark:bg-indigo-900/30' },
  ORDER_CANCELLED: { de: 'Bestellung storniert', en: 'Order cancelled', ar: 'تم إلغاء الطلب', icon: '❌', color: 'bg-red-100 dark:bg-red-900/30' },
  ORDER_REFUNDED: { de: 'Erstattung durchgeführt', en: 'Refund processed', ar: 'تم الاسترداد', icon: '💸', color: 'bg-orange-100 dark:bg-orange-900/30' },
  RETURN_APPROVED: { de: 'Retoure genehmigt', en: 'Return approved', ar: 'تمت الموافقة على المرتجع', icon: '✅', color: 'bg-green-100 dark:bg-green-900/30' },
  RETURN_REJECTED: { de: 'Retoure abgelehnt', en: 'Return rejected', ar: 'تم رفض المرتجع', icon: '❌', color: 'bg-red-100 dark:bg-red-900/30' },
  STAFF_INVITED: { de: 'Mitarbeiter eingeladen', en: 'Staff invited', ar: 'تمت دعوة موظف', icon: '👤', color: 'bg-blue-100 dark:bg-blue-900/30' },
  COUPON_CREATED: { de: 'Gutschein erstellt', en: 'Coupon created', ar: 'تم إنشاء قسيمة', icon: '🎫', color: 'bg-amber-100 dark:bg-amber-900/30' },
  PRODUCTS_CHANNEL_ENABLED: { de: 'Kanal aktiviert', en: 'Channel enabled', ar: 'تم تفعيل القناة', icon: '📡', color: 'bg-green-100 dark:bg-green-900/30' },
  PRODUCTS_CHANNEL_DISABLED: { de: 'Kanal deaktiviert', en: 'Channel disabled', ar: 'تم إلغاء تفعيل القناة', icon: '📡', color: 'bg-gray-100 dark:bg-gray-800' },
  INVENTORY_ADJUSTED: { de: 'Bestand angepasst', en: 'Stock adjusted', ar: 'تم تعديل المخزون', icon: '📊', color: 'bg-cyan-100 dark:bg-cyan-900/30' },
  INVENTORY_INTAKE: { de: 'Wareneingang', en: 'Stock received', ar: 'استلام بضاعة', icon: '📦', color: 'bg-green-100 dark:bg-green-900/30' },
  INVENTORY_TRANSFER: { de: 'Lager-Transfer', en: 'Stock transfer', ar: 'نقل مخزون', icon: '🔄', color: 'bg-blue-100 dark:bg-blue-900/30' },
  VARIANT_UPDATED: { de: 'Variante aktualisiert', en: 'Variant updated', ar: 'تم تحديث المتغير', icon: '✏', color: 'bg-blue-100 dark:bg-blue-900/30' },
  VARIANT_DELETED: { de: 'Variante gelöscht', en: 'Variant deleted', ar: 'تم حذف المتغير', icon: '🗑', color: 'bg-red-100 dark:bg-red-900/30' },
  SUPPLIER_CREATED: { de: 'Lieferant erstellt', en: 'Supplier created', ar: 'تم إنشاء مورد', icon: '🏭', color: 'bg-blue-100 dark:bg-blue-900/30' },
  DELIVERY_CREATED: { de: 'Lieferung erstellt', en: 'Delivery created', ar: 'تم إنشاء توصيل', icon: '🚚', color: 'bg-green-100 dark:bg-green-900/30' },
  DELIVERY_CANCELLED: { de: 'Lieferung storniert', en: 'Delivery cancelled', ar: 'تم إلغاء التوصيل', icon: '❌', color: 'bg-red-100 dark:bg-red-900/30' },
  PAYMENT_CREATED: { de: 'Zahlung erstellt', en: 'Payment created', ar: 'تم إنشاء الدفع', icon: '💳', color: 'bg-green-100 dark:bg-green-900/30' },
  ORDER_AUTO_CANCELLED: { de: 'Automatisch storniert', en: 'Auto-cancelled', ar: 'إلغاء تلقائي', icon: '⏱', color: 'bg-red-100 dark:bg-red-900/30' },
  INVENTORY_TRANSFERRED: { de: 'Bestand transferiert', en: 'Stock transferred', ar: 'تم نقل المخزون', icon: '🔄', color: 'bg-blue-100 dark:bg-blue-900/30' },
  ORDER_FULFILLMENT_CHANGED: { de: 'Lager geändert', en: 'Warehouse changed', ar: 'تم تغيير المستودع', icon: '🏭', color: 'bg-purple-100 dark:bg-purple-900/30' },
  ADMIN_LOGIN_FAILED: { de: 'Login fehlgeschlagen', en: 'Login failed', ar: 'فشل تسجيل الدخول', icon: '⚠', color: 'bg-red-100 dark:bg-red-900/30' },
  ADMIN_PASSWORD_RESET: { de: 'Admin-Passwort zurückgesetzt', en: 'Admin password reset', ar: 'إعادة تعيين كلمة مرور المشرف', icon: '🔐', color: 'bg-yellow-100 dark:bg-yellow-900/30' },
  STAFF_PASSWORD_RESET: { de: 'Passwort zurückgesetzt', en: 'Password reset', ar: 'إعادة تعيين كلمة المرور', icon: '🔑', color: 'bg-yellow-100 dark:bg-yellow-900/30' },
  STAFF_CREATED: { de: 'Mitarbeiter erstellt', en: 'Staff created', ar: 'تم إنشاء موظف', icon: '👤', color: 'bg-blue-100 dark:bg-blue-900/30' },
  STAFF_ROLE_CHANGED: { de: 'Rolle geändert', en: 'Role changed', ar: 'تم تغيير الدور', icon: '👤', color: 'bg-purple-100 dark:bg-purple-900/30' },
  STAFF_ACTIVATED: { de: 'Mitarbeiter aktiviert', en: 'Staff activated', ar: 'تم تفعيل الموظف', icon: '✅', color: 'bg-green-100 dark:bg-green-900/30' },
  STAFF_DEACTIVATED: { de: 'Mitarbeiter deaktiviert', en: 'Staff deactivated', ar: 'تم تعطيل الموظف', icon: '⏸', color: 'bg-gray-100 dark:bg-gray-800' },
  STAFF_DELETED: { de: 'Mitarbeiter gelöscht', en: 'Staff deleted', ar: 'تم حذف الموظف', icon: '🗑', color: 'bg-red-100 dark:bg-red-900/30' },
  MAINTENANCE_AUTO_DISABLED: { de: 'Wartungsmodus beendet', en: 'Maintenance ended', ar: 'إيقاف وضع الصيانة تلقائياً', icon: '🔧', color: 'bg-orange-100 dark:bg-orange-900/30' },
  EMERGENCY_RECOVERY: { de: 'Notfall-Wiederherstellung', en: 'Emergency recovery', ar: 'استعادة طوارئ', icon: '🚨', color: 'bg-red-100 dark:bg-red-900/30' },
  RETURN_SCANNED: { de: 'Retoure gescannt', en: 'Return scanned', ar: 'مسح المرتجع', icon: '📱', color: 'bg-cyan-100 dark:bg-cyan-900/30' },
  RETURN_RECEIVED: { de: 'Retoure eingetroffen', en: 'Return received', ar: 'استلام المرتجع', icon: '📥', color: 'bg-teal-100 dark:bg-teal-900/30' },
  RETURN_INSPECTED: { de: 'Retoure geprüft', en: 'Return inspected', ar: 'فحص المرتجع', icon: '🔍', color: 'bg-blue-100 dark:bg-blue-900/30' },
  RETURN_REFUNDED: { de: 'Erstattung verarbeitet', en: 'Refund processed', ar: 'تم الاسترداد', icon: '💸', color: 'bg-amber-100 dark:bg-amber-900/30' },
  ORDER_PARTIAL_CANCEL: { de: 'Teilstornierung', en: 'Partial cancel', ar: 'إلغاء جزئي', icon: '✂', color: 'bg-orange-100 dark:bg-orange-900/30' },
  SUPPLIER_DELIVERY_RECEIVED: { de: 'Wareneingang vom Lieferant', en: 'Delivery received', ar: 'استلام بضاعة من مورد', icon: '📦', color: 'bg-emerald-100 dark:bg-emerald-900/30' },
  SUPPLIER_DELIVERY_CANCELLED: { de: 'Lieferung storniert', en: 'Delivery cancelled', ar: 'إلغاء التوريد', icon: '❌', color: 'bg-red-100 dark:bg-red-900/30' },
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
            const cfg = ACTION_LABELS[a.action] ?? { de: a.action, ar: a.action, icon: '•', color: 'bg-gray-100 dark:bg-gray-800' }
            const label = locale === 'ar' ? cfg.ar : locale === 'en' ? cfg.en : cfg.de
            const time = formatRelativeTime(new Date(a.createdAt), locale)

            return (
              <div
                key={a.id ?? i}
                className="group flex items-center gap-3 px-2 py-3 rounded-xl transition-colors duration-150 hover:bg-muted/40"
              >
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm ring-1 ring-border/30 ${cfg.color}`}
                >
                  {cfg.icon}
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
