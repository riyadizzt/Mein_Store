'use client'

/**
 * EbayRefundStatusBlock (C13.4).
 *
 * Renders the refund-state UI for an eBay-Managed-Payments refund on
 * the /admin/returns detail panel. Mirrors the existing Vorkasse-
 * pending-warning pattern but with 4 distinct states + age-aware
 * 48h-fallback Manual-Confirm button.
 *
 * States rendered:
 *   - PENDING <48h    → blue info-box: "eBay refund initiated, polling
 *                        status every 60min. Will auto-confirm."
 *                        (NO button — let the cron do its thing)
 *   - PENDING ≥48h    → amber warning-box + "Manually confirm" button
 *                        (button calls the C13.3 manual-confirm endpoint)
 *   - PROCESSED       → returns NULL (parent renders the existing
 *                        green "Erstattet am X" — ZERO TOUCH)
 *   - FAILED          → red error-box: "eBay refund FAILED. Verify in
 *                        eBay Seller Hub and contact support."
 *
 * Defensive on stale/missing data:
 *   - If refund.providerRefundId is empty (Defensive-Multi-Path
 *     fallback in EbayPaymentProvider couldn't extract it), the
 *     amber-block surfaces with "Refund-ID nicht erfasst" hint.
 *
 * The C13.3 backend pipeline (EbayRefundPollService @SafeCron 60min)
 * automatically transitions PENDING → PROCESSED/FAILED. This component
 * only surfaces the in-progress state; the ZERO-TOUCH parent renders
 * the success-case PROCESSED green-banner unchanged.
 */

import { AlertTriangle, Check, Clock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface EbayRefund {
  id: string
  status: 'PENDING' | 'PROCESSED' | 'FAILED'
  amount: string | number
  providerRefundId: string | null
  ebayRequestedAt: string | null
  createdAt: string
}

interface Props {
  refund: EbayRefund
  locale: string
  isPending: boolean             // mutation in-flight
  onConfirm: () => void          // calls confirmDialog → mutation
}

const FALLBACK_THRESHOLD_HOURS = 48

function t3(de: string, en: string, ar: string, locale: string): string {
  if (locale === 'en') return en
  if (locale === 'ar') return ar
  return de
}

function ageHours(refund: EbayRefund): number {
  const requestedAt = refund.ebayRequestedAt ?? refund.createdAt
  return (Date.now() - new Date(requestedAt).getTime()) / 3600000
}

export function EbayRefundStatusBlock({ refund, locale, isPending, onConfirm }: Props) {
  // PROCESSED is rendered by the parent's existing "Erstattet am" block.
  // Returning null here keeps the C13.3 ZERO-TOUCH guarantee on success
  // path — the existing green-banner rendering is untouched.
  if (refund.status === 'PROCESSED') return null

  if (refund.status === 'FAILED') {
    return (
      <div className="px-4 py-4 bg-red-50 border border-red-200 rounded-xl space-y-2">
        <div className="flex items-start gap-3">
          <X className="h-5 w-5 flex-shrink-0 text-red-700 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-red-900 text-sm">
              {t3('eBay-Erstattung fehlgeschlagen', 'eBay refund failed', 'فشل استرداد eBay', locale)}
            </p>
            <p className="text-sm text-red-800 mt-1">
              {t3(
                'eBay hat die Erstattung abgelehnt. Im eBay Seller Hub manuell prüfen und ggf. eBay-Support kontaktieren.',
                'eBay rejected the refund. Verify in eBay Seller Hub and contact eBay support if needed.',
                'رفض eBay الاسترداد. تحقق في Seller Hub واتصل بدعم eBay عند الحاجة.',
                locale,
              )}
            </p>
            {refund.providerRefundId && (
              <p className="text-xs text-red-600 mt-2 font-mono" dir="ltr">
                eBay Refund-ID: {refund.providerRefundId}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // status === 'PENDING' — branch on age
  const age = ageHours(refund)
  const isStale = age >= FALLBACK_THRESHOLD_HOURS

  if (!isStale) {
    // <48h — blue info, let the cron handle it. No button — interrupting
    // the auto-poll flow is the wrong instinct here; admin should wait.
    return (
      <div className="px-4 py-4 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
        <div className="flex items-start gap-3">
          <Clock className="h-5 w-5 flex-shrink-0 text-blue-700 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-blue-900 text-sm">
              {t3('eBay-Erstattung initiiert', 'eBay refund initiated', 'تم بدء استرداد eBay', locale)}
            </p>
            <p className="text-sm text-blue-800 mt-1">
              {t3(
                'eBay verarbeitet die Erstattung. Status wird automatisch alle 60 Minuten geprüft. Bestätigung in der Regel innerhalb weniger Stunden.',
                'eBay is processing the refund. Status auto-polls every 60 minutes. Typically confirmed within a few hours.',
                'يقوم eBay بمعالجة الاسترداد. يتم فحص الحالة تلقائياً كل 60 دقيقة. عادةً يتم التأكيد خلال ساعات قليلة.',
                locale,
              )}
            </p>
            {refund.providerRefundId && (
              <p className="text-xs text-blue-600 mt-2 font-mono" dir="ltr">
                eBay Refund-ID: {refund.providerRefundId}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ≥48h — amber warning + Manual-Confirm button. The 48h threshold
  // matches the EbayRefundPollService FALLBACK_THRESHOLD_HOURS, so
  // this UI surfaces exactly when the backend has also given up
  // auto-confirming. Admin can then verify in eBay Seller Hub and
  // flip the status manually.
  return (
    <div className="px-4 py-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-700 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-amber-900 text-sm">
            {t3(
              `eBay-Erstattung > ${Math.floor(age)}h pending`,
              `eBay refund pending > ${Math.floor(age)}h`,
              `استرداد eBay معلق > ${Math.floor(age)} ساعة`,
              locale,
            )}
          </p>
          <p className="text-sm text-amber-800 mt-1">
            {t3(
              'eBay hat die Erstattung noch nicht bestätigt. Im eBay Seller Hub prüfen — wenn die Erstattung dort als abgeschlossen erscheint, hier manuell bestätigen.',
              'eBay has not yet confirmed the refund. Check eBay Seller Hub — if the refund shows as completed there, manually confirm here.',
              'لم يؤكد eBay الاسترداد بعد. تحقق في Seller Hub — إذا ظهر الاسترداد كمكتمل هناك، أكد يدوياً هنا.',
              locale,
            )}
          </p>
          {refund.providerRefundId ? (
            <p className="text-xs text-amber-600 mt-2 font-mono" dir="ltr">
              eBay Refund-ID: {refund.providerRefundId}
            </p>
          ) : (
            <p className="text-xs text-amber-600 mt-2 italic">
              {t3('Refund-ID nicht erfasst', 'Refund-ID not captured', 'لم يتم تسجيل معرّف الاسترداد', locale)}
            </p>
          )}
        </div>
      </div>
      <Button
        className="w-full gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold"
        onClick={onConfirm}
        disabled={isPending}
      >
        <Check className="h-4 w-4" />
        {t3('Manuell bestätigen', 'Manually confirm', 'تأكيد يدوي', locale)}
      </Button>
    </div>
  )
}
