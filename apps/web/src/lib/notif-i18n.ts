/**
 * Single source of truth for notification title/body localization.
 *
 * Previously, the switch that maps notification.type → localized {title, body}
 * lived inline in *two* places: the bell dropdown (admin/layout.tsx) and the
 * full notifications list page (admin/notifications/page.tsx). They drifted
 * over time — new cases added to the bell (return_received, contact_message,
 * maintenance_auto_ended, admin_password_reset, account_deletion_requested)
 * never made it into the list page, so Arabic admins saw the raw persisted
 * German text for exactly those notifications on the /admin/notifications
 * screen while the bell showed them correctly.
 *
 * Both surfaces now call translateNotification() from this file. Add a new
 * notification type in ONE place and both views pick it up.
 */

type Locale = 'de' | 'en' | 'ar' | string

export interface NotificationLike {
  type?: string | null
  title?: string | null
  body?: string | null
  data?: Record<string, any> | null
}

export interface LocalizedNotification {
  title: string
  body: string
}

export function translateNotification(
  n: NotificationLike,
  locale: Locale,
): LocalizedNotification {
  const d = n.data ?? {}
  const l = locale
  const t = (de: string, en: string, ar: string) =>
    l === 'ar' ? ar : l === 'en' ? en : de
  const on = d.orderNumber ?? ''

  switch (n.type) {
    case 'new_order':
      return {
        title: t(`Neue Bestellung #${on}`, `New Order #${on}`, `طلب جديد #${on}`),
        body: d.amount ? `€${d.amount} ${t('von', 'from', 'من')} ${d.customerName ?? ''}` : '',
      }
    case 'order_cancelled':
      return {
        title: t(
          `Bestellung storniert ${on ? '#' + on : ''}`,
          `Order cancelled ${on ? '#' + on : ''}`,
          `طلب ملغى ${on ? '#' + on : ''}`,
        ),
        body: d.reason ?? '',
      }
    case 'low_stock':
      return {
        title: t(
          `Mindestbestand: ${d.sku ?? ''}`,
          `Low stock: ${d.sku ?? ''}`,
          `مخزون منخفض: ${d.sku ?? ''}`,
        ),
        body: t(
          `Noch ${d.available ?? 0} Stück`,
          `${d.available ?? 0} left`,
          `${d.available ?? 0} متبقي`,
        ),
      }
    case 'customer_registered':
      return {
        title: t('Neuer Kunde', 'New customer', 'عميل جديد'),
        body: d.name ?? d.email ?? '',
      }
    case 'return_submitted':
      return {
        title: t(
          `Neue Retoure ${on ? '#' + on : ''}`,
          `New return ${on ? '#' + on : ''}`,
          `إرجاع جديد ${on ? '#' + on : ''}`,
        ),
        body: d.reason ?? '',
      }
    case 'return_approved':
      return {
        title: t('Retoure genehmigt', 'Return approved', 'تمت الموافقة على الإرجاع'),
        body: on ? t(`Bestellung #${on}`, `Order #${on}`, `طلب #${on}`) : '',
      }
    case 'return_received': {
      const orderLine = on ? t(`Bestellung #${on}`, `Order #${on}`, `طلب #${on}`) : ''
      const amount = d.refundAmount != null ? `${Number(d.refundAmount).toFixed(2)} EUR` : ''
      return {
        title: t(
          `Retoure eingegangen ${on ? '#' + on : ''}`,
          `Return received ${on ? '#' + on : ''}`,
          `تم استلام الإرجاع ${on ? '#' + on : ''}`,
        ),
        body: amount && orderLine ? `${orderLine} — ${amount}` : orderLine,
      }
    }
    case 'return_refunded':
      return {
        title: t('Erstattung verarbeitet', 'Refund processed', 'تم معالجة الاسترداد'),
        body: d.refundAmount ? `€${Number(d.refundAmount).toFixed(2)}` : '',
      }
    case 'payment_failed':
      return {
        title: t(
          `Zahlung fehlgeschlagen ${on ? '#' + on : ''}`,
          `Payment failed ${on ? '#' + on : ''}`,
          `فشل الدفع ${on ? '#' + on : ''}`,
        ),
        body: d.provider ?? '',
      }
    case 'coupon_expiring':
      return {
        title: t('Gutschein läuft ab', 'Coupon expiring', 'قسيمة على وشك الانتهاء'),
        body: d.code ?? '',
      }
    case 'promotion_expiring':
      return {
        title: t('Aktion endet bald', 'Promotion ending', 'عرض على وشك الانتهاء'),
        body: d.name ?? '',
      }
    case 'contact_message': {
      const subject = d.subject ?? ''
      const senderName = d.name ?? d.email ?? ''
      return {
        title: t(
          `Neue Kontaktanfrage: ${subject}`,
          `New contact request: ${subject}`,
          `طلب تواصل جديد: ${subject}`,
        ),
        body: senderName ? t(`Von ${senderName}`, `From ${senderName}`, `من ${senderName}`) : '',
      }
    }
    case 'account_deletion_requested': {
      return {
        title: t(
          'Kontolöschung beantragt',
          'Account deletion requested',
          'طلب حذف الحساب',
        ),
        body: t(
          'Ein Kunde hat die Löschung seines Kontos beantragt',
          'A customer has requested deletion of their account',
          'طلب أحد العملاء حذف حسابه',
        ),
      }
    }
    case 'maintenance_auto_ended': {
      return {
        title: t(
          'Wartungsmodus automatisch beendet',
          'Maintenance mode auto-ended',
          'تم إنهاء وضع الصيانة تلقائياً',
        ),
        body: t(
          'Der Shop ist wieder online — Countdown ist abgelaufen.',
          'The shop is back online — countdown has expired.',
          'المتجر متاح مجدداً — انتهى العد التنازلي.',
        ),
      }
    }
    case 'admin_password_reset': {
      const who = d.email ?? d.name ?? ''
      const whoName = d.name ?? d.email ?? ''
      return {
        title: t(
          `Admin-Passwort zurückgesetzt${who ? ': ' + who : ''}`,
          `Admin password reset${who ? ': ' + who : ''}`,
          `تم إعادة تعيين كلمة مرور المشرف${who ? ': ' + who : ''}`,
        ),
        body: t(
          `${whoName} hat das Passwort per E-Mail-Link zurückgesetzt.`,
          `${whoName} reset their password via the email link.`,
          `${whoName} أعاد تعيين كلمة المرور عبر رابط البريد الإلكتروني.`,
        ),
      }
    }
    default:
      return { title: n.title ?? '', body: n.body ?? '' }
  }
}
