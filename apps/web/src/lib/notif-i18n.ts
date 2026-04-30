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
    case 'credit_note_pdf_pending': {
      // Fires when the Supabase upload for a Gutschrift-PDF exhausts
      // its retries after a successful refund. The refund itself is
      // committed; only the PDF finalization is deferred. Admin can
      // re-trigger PDF generation manually from the invoices page.
      const gsNum = d.creditNoteNumber ?? ''
      const orderNum = d.orderNumber ?? on ?? ''
      const amt = d.refundAmount != null ? `€${Number(d.refundAmount).toFixed(2)}` : ''
      return {
        title: t(
          `Gutschrift-PDF ausstehend${gsNum ? ': ' + gsNum : ''}`,
          `Credit note PDF pending${gsNum ? ': ' + gsNum : ''}`,
          `فاتورة دائنة PDF معلّقة${gsNum ? ': ' + gsNum : ''}`,
        ),
        body: t(
          `${amt} Erstattung für ${orderNum} abgeschlossen, PDF muss manuell neu generiert werden.`,
          `${amt} refund for ${orderNum} completed, PDF needs manual regeneration.`,
          `تم إكمال استرداد ${amt} للطلب ${orderNum}، يتعيّن إعادة توليد ملف PDF يدوياً.`,
        ),
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
    case 'channel_auto_paused': {
      // Persisted by propagateChannelSafety (C5) when a ChannelProduct-
      // Listing drops to/below its safetyStock threshold. data.channel
      // identifies which marketplace (facebook/tiktok/google/whatsapp/
      // ebay/…); data.safetyStock + data.available give the admin the
      // numbers to reason about whether to raise the threshold, ship
      // in restock, or manually override.
      const ch = (d.channel ?? '').toString()
      const thr = d.safetyStock
      const avail = d.available
      return {
        title: t(
          `Channel-Listing pausiert${ch ? ` (${ch})` : ''}`,
          `Channel listing paused${ch ? ` (${ch})` : ''}`,
          `تم إيقاف عرض القناة${ch ? ` (${ch})` : ''}`,
        ),
        body: t(
          `Bestand unter Safety-Stock (verfügbar: ${avail}, Schwelle: ${thr}). Automatisch pausiert — manuell prüfen oder nach Restock wieder aktivieren.`,
          `Stock below safety threshold (available: ${avail}, threshold: ${thr}). Auto-paused — review manually or resume after restock.`,
          `المخزون أقل من الحد الآمن (متاح: ${avail}, الحد: ${thr}). تم الإيقاف تلقائياً — راجع يدوياً أو أعد التشغيل بعد إعادة التخزين.`,
        ),
      }
    }
    case 'cron_crashed': {
      // Persisted by CronCrashAlertService when @SafeCron catches an
      // exception. data.cronClass + data.method identify the failing
      // method; data.errorMessage holds the short error string. The full
      // 8-line stack snippet lives in data.stackSnippet (visible only via
      // the notifications detail view, not rendered here).
      const cls = d.cronClass ?? ''
      const method = d.method ?? ''
      const id = cls && method ? `${cls}.${method}` : (cls || method || '')
      const errMsg = d.errorMessage ?? ''
      return {
        title: t(
          `Cron-Job abgestürzt${id ? ': ' + id : ''}`,
          `Cron job crashed${id ? ': ' + id : ''}`,
          `توقف مهمة Cron${id ? ': ' + id : ''}`,
        ),
        body: errMsg,
      }
    }
    case 'channel_stock_push_failed': {
      // Persisted by EbayStockPushService (C15) when a per-listing
      // quantity-push fails MAX_PUSH_ATTEMPTS times. data.attempts
      // is the cumulative count, data.error the last short message.
      // Surfaces only on exhaustion to avoid notification-spam during
      // transient cron-retries.
      const attempts = d.attempts ?? '?'
      const errMsg = d.error ?? ''
      return {
        title: t(
          'eBay Bestand-Sync fehlgeschlagen',
          'eBay stock sync failed',
          'فشل مزامنة مخزون eBay',
        ),
        body: t(
          `Nach ${attempts} Versuchen konnte der Bestand nicht aktualisiert werden. ${errMsg}`,
          `Stock could not be updated after ${attempts} attempts. ${errMsg}`,
          `تعذر تحديث المخزون بعد ${attempts} محاولات. ${errMsg}`,
        ),
      }
    }
    case 'audit_archive_failed': {
      // Persisted by AuditArchiveService (C15.1) when the daily 03:00
      // archive-tick fails to upload to R2 (network / credential /
      // bucket-config issue). data.rowsAttempted shows how many
      // operational audit-rows are still in Supabase pending archive;
      // data.error is the short failure-reason. The cron retries
      // automatically the next night at 03:00 — no admin action
      // required unless the failure persists multiple days (then
      // verify R2 credentials in env).
      const rows = d.rowsAttempted ?? '?'
      const errMsg = d.error ?? ''
      return {
        title: t(
          'Audit-Archivierung fehlgeschlagen',
          'Audit archive failed',
          'فشل أرشفة سجل التدقيق',
        ),
        body: t(
          `R2-Upload fehlgeschlagen (${rows} Zeilen ausstehend). ${errMsg} — automatischer Retry morgen um 03:00.`,
          `R2 upload failed (${rows} rows pending). ${errMsg} — auto-retry tomorrow at 03:00.`,
          `فشل تحميل R2 (${rows} صف معلق). ${errMsg} — إعادة المحاولة تلقائياً غداً الساعة 03:00.`,
        ),
      }
    }
    default:
      return { title: n.title ?? '', body: n.body ?? '' }
  }
}
