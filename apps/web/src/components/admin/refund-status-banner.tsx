'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Loader2, RefreshCw, CreditCard } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

const t3 = (l: string, d: string, a: string) => l === 'ar' ? a : d  // Admin dashboard is DE/AR only

export function RefundStatusBanner({ order, locale }: { order: any; locale: string }) {
  const qc = useQueryClient()
  const [toast, setToast] = useState<string | null>(null)

  const retryMut = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/admin/orders/${order.id}/retry-refund`); return data },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin-order', order.id] })
      setToast(data.success
        ? t3(locale, `Erstattung erfolgreich: €${data.amount?.toFixed(2)}`, `تم الاسترداد: €${data.amount?.toFixed(2)}`)
        : t3(locale, `Fehlgeschlagen: ${data.error}`, `فشل: ${data.error}`))
      setTimeout(() => setToast(null), 5000)
    },
    onError: () => {
      setToast(t3(locale, 'Fehler beim Erstattungsversuch', 'خطأ في محاولة الاسترداد'))
      setTimeout(() => setToast(null), 4000)
    },
  })

  const manualMut = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/admin/orders/${order.id}/mark-refund-manual`); return data },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-order', order.id] })
      setToast(t3(locale, 'Als manuell erstattet markiert', 'تم وضع علامة "مسترد يدوياً"'))
      setTimeout(() => setToast(null), 3000)
    },
    onError: () => {
      setToast(t3(locale, 'Fehler beim Markieren', 'خطأ في وضع العلامة'))
      setTimeout(() => setToast(null), 4000)
    },
  })

  // Only show for cancelled orders
  if (order.status !== 'cancelled') return null

  // Refund succeeded — show green
  if (order.refundStatus === 'succeeded') {
    return (
      <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-2xl p-4 flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-green-100 dark:bg-green-500/20 flex items-center justify-center flex-shrink-0">
          <Check className="h-4 w-4 text-green-600" />
        </div>
        <p className="text-sm text-green-800 dark:text-green-300 font-medium">{t3(locale, 'Erstattung erfolgreich durchgeführt', 'تم الاسترداد بنجاح')}</p>
      </div>
    )
  }

  // No refund needed
  if (order.refundStatus === 'not_needed' || (!order.payment && !order.refundStatus)) {
    return null
  }

  // Refund pending
  if (order.refundStatus === 'pending') {
    return (
      <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl p-4 flex items-center gap-3">
        <Loader2 className="h-5 w-5 text-amber-600 animate-spin flex-shrink-0" />
        <p className="text-sm text-amber-800 dark:text-amber-300 font-medium">{t3(locale, 'Erstattung wird verarbeitet...', 'جاري معالجة الاسترداد...')}</p>
      </div>
    )
  }

  // Refund FAILED — show red with retry buttons
  if (order.refundStatus === 'failed') {
    return (
      <div className="bg-red-50 dark:bg-red-500/10 border border-red-300 dark:border-red-500/20 rounded-2xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-full bg-red-100 dark:bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">
              {t3(locale, '⚠ Erstattung fehlgeschlagen — Kunde hat sein Geld noch NICHT zurückbekommen', '⚠ فشل الاسترداد — العميل لم يستلم أمواله بعد')}
            </p>
            {order.refundError && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-mono bg-red-100 dark:bg-red-500/10 px-2 py-1 rounded">{order.refundError}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2 ltr:ml-11 rtl:mr-11">
          <Button size="sm" className="gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white" onClick={() => retryMut.mutate()} disabled={retryMut.isPending}>
            {retryMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t3(locale, 'Erstattung erneut versuchen', 'إعادة محاولة الاسترداد')}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 rounded-xl" onClick={() => {
            if (confirm(t3(locale, 'Hast du den Betrag manuell erstattet (z.B. per Überweisung)?', 'هل قمت باسترداد المبلغ يدوياً؟'))) manualMut.mutate()
          }} disabled={manualMut.isPending}>
            <CreditCard className="h-3.5 w-3.5" />
            {t3(locale, 'Manuell erstattet', 'استرداد يدوي')}
          </Button>
        </div>
        {toast && <p className="text-xs ltr:ml-11 rtl:mr-11 font-medium text-red-700 dark:text-red-400">{toast}</p>}
      </div>
    )
  }

  // Old orders without refundStatus — check if payment was captured
  if (order.payment?.status === 'captured' && !order.refundStatus) {
    return (
      <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl p-4 flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-amber-800 dark:text-amber-300 font-medium">{t3(locale, 'Erstattungsstatus unbekannt — bitte prüfen', 'حالة الاسترداد غير معروفة — يرجى التحقق')}</p>
        </div>
        <Button size="sm" className="gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white" onClick={() => retryMut.mutate()} disabled={retryMut.isPending}>
          {retryMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t3(locale, 'Erstatten', 'استرداد')}
        </Button>
      </div>
    )
  }

  return null
}
