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
    case 'order_partial_cancelled': {
      const cancelled = d.itemsCancelled ?? 0
      const total = d.itemsTotal ?? 0
      const amt = d.refundAmount != null ? `€${Number(d.refundAmount).toFixed(2)}` : ''
      return {
        title: t(
          `Teilstornierung ${on ? '#' + on : ''}`,
          `Partial cancellation ${on ? '#' + on : ''}`,
          `إلغاء جزئي ${on ? '#' + on : ''}`,
        ),
        body: t(
          `${cancelled} von ${total} Artikel storniert${amt ? ' — ' + amt : ''}`,
          `${cancelled} of ${total} items cancelled${amt ? ' — ' + amt : ''}`,
          `${cancelled} من ${total} عناصر ملغاة${amt ? ' — ' + amt : ''}`,
        ),
      }
    }
    case 'orders_auto_cancelled': {
      const count = d.count ?? 0
      const orderNumbers = Array.isArray(d.orderNumbers) ? d.orderNumbers : []
      const preview = orderNumbers.slice(0, 3).join(', ')
      const suffix = orderNumbers.length > 3 ? '…' : ''
      return {
        title: t(
          `${count} Bestellung${count === 1 ? '' : 'en'} automatisch storniert`,
          `${count} order${count === 1 ? '' : 's'} auto-cancelled`,
          `تم إلغاء ${count} طلب تلقائياً`,
        ),
        body: t(
          `Zahlungstimeout${preview ? ': ' + preview + suffix : ''}`,
          `Payment timeout${preview ? ': ' + preview + suffix : ''}`,
          `انتهاء مهلة الدفع${preview ? ': ' + preview + suffix : ''}`,
        ),
      }
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
    case 'payment_disputed': {
      const amt = d.amount != null ? `€${Number(d.amount).toFixed(2)}` : ''
      const reason = d.reason ? ` — ${d.reason}` : ''
      return {
        title: t(
          `⚠ Zahlung bestritten ${on ? '#' + on : ''}`,
          `⚠ Payment disputed ${on ? '#' + on : ''}`,
          `⚠ نزاع على الدفع ${on ? '#' + on : ''}`,
        ),
        body: t(
          `${amt} bestritten${reason} — bitte umgehend prüfen.`,
          `${amt} disputed${reason} — please review immediately.`,
          `${amt} متنازع عليه${reason} — يرجى المراجعة فوراً.`,
        ),
      }
    }
    case 'refund_failed': {
      // kind: 'order_full' | 'order_partial' | 'return'
      const kind = d.kind ?? 'order_full'
      const amt = d.amount != null ? `€${Number(d.amount).toFixed(2)}` : ''
      const ref = kind === 'return'
        ? (d.returnNumber ?? '')
        : (on ?? '')
      const errSuffix = d.error ? ` — ${d.error}` : ''
      const titleDe =
        kind === 'order_partial'
          ? `⚠ Teilerstattung fehlgeschlagen${ref ? ': ' + ref : ''}`
          : kind === 'return'
          ? `⚠ Retoure-Erstattung fehlgeschlagen${ref ? ': ' + ref : ''}`
          : `⚠ Erstattung fehlgeschlagen${ref ? ': ' + ref : ''}`
      const titleEn =
        kind === 'order_partial'
          ? `⚠ Partial refund failed${ref ? ': ' + ref : ''}`
          : kind === 'return'
          ? `⚠ Return refund failed${ref ? ': ' + ref : ''}`
          : `⚠ Refund failed${ref ? ': ' + ref : ''}`
      const titleAr =
        kind === 'order_partial'
          ? `⚠ فشل الاسترداد الجزئي${ref ? ': ' + ref : ''}`
          : kind === 'return'
          ? `⚠ فشل استرداد الإرجاع${ref ? ': ' + ref : ''}`
          : `⚠ فشل الاسترداد${ref ? ': ' + ref : ''}`
      const bodyDe = `${amt} konnte nicht erstattet werden. Bitte manuell prüfen.${errSuffix}`
      const bodyEn = `${amt} could not be refunded. Please review manually.${errSuffix}`
      const bodyAr = `تعذّر استرداد ${amt}. يرجى المراجعة اليدوية.${errSuffix}`
      return {
        title: t(titleDe, titleEn, titleAr),
        body: t(bodyDe, bodyEn, bodyAr),
      }
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
