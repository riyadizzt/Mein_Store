'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import Image from 'next/image'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Loader2, Clock, AlertTriangle, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

// Customer-facing return reasons.
//
// "damaged" is intentionally omitted — we inspect every item before shipping,
// so a customer-reported defect is statistically a mismatched expectation,
// not a real defect. Letting the customer pick "damaged" would invite a
// reason the admin is systematically going to override during inspection.
// The admin retains the "damaged" option during inspection for the rare
// real-defect case (transport damage, customer-caused damage).
const REASONS = [
  { value: 'wrong_size', de: 'Passt nicht (Größe)', en: 'Doesn\'t fit (size)', ar: 'لا يناسب (المقاس)' },
  { value: 'changed_mind', de: 'Gefällt nicht', en: 'Changed my mind', ar: 'غيرت رأيي' },
  { value: 'wrong_product', de: 'Falscher Artikel', en: 'Wrong item', ar: 'منتج خاطئ' },
  { value: 'quality_issue', de: 'Qualitätsmangel', en: 'Quality issue', ar: 'مشكلة في الجودة' },
  { value: 'other', de: 'Sonstiges', en: 'Other', ar: 'أخرى' },
]

interface ReturnItem {
  id: string
  variantId: string
  name: string
  color?: string
  size?: string
  quantity: number
  imageUrl?: string
  unitPrice: number
  excludeFromReturns?: boolean
  returnExclusionReason?: string
}

interface Props {
  open: boolean
  onClose: () => void
  orderId: string
  orderNumber: string
  items: ReturnItem[]
  daysLeft: number
  deliveryDeadline: string
}

export function ReturnRequestModal({ open, onClose, orderId, orderNumber, items, daysLeft, deliveryDeadline }: Props) {
  const locale = useLocale()
  const qc = useQueryClient()
  const t = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [returnQty, setReturnQty] = useState<Record<string, number>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})

  const toggleItem = (id: string, maxQty: number) => {
    setSelected((s) => ({ ...s, [id]: !s[id] }))
    if (!reasons[id]) setReasons((r) => ({ ...r, [id]: 'wrong_size' }))
    if (!returnQty[id]) setReturnQty((q) => ({ ...q, [id]: maxQty }))
  }

  const selectedItems = items.filter((i) => selected[i.id])
  const selectedCount = selectedItems.reduce((sum, i) => sum + (returnQty[i.id] ?? i.quantity), 0)

  const returnMut = useMutation({
    mutationFn: async () => {
      const returnItems = items
        .filter((item) => selected[item.id])
        .map((item) => ({
          variantId: item.variantId,
          quantity: returnQty[item.id] ?? item.quantity,
          reason: reasons[item.id] || 'wrong_size',
          notes: notes[item.id] || undefined,
        }))

      // Lesbaren Grund-Text senden statt Enum-Wert
      const reasonLabel = (reasonValue: string) => {
        const r = REASONS.find((r) => r.value === reasonValue)
        return r ? r[locale as 'de' | 'en' | 'ar'] ?? r.de : reasonValue
      }

      await api.post(`/orders/${orderId}/return-request`, {
        reason: returnItems[0]?.reason || 'wrong_size',
        notes: returnItems.map((i) => `${reasonLabel(i.reason)}${i.notes ? ': ' + i.notes : ''}`).join(' | '),
        items: returnItems,
      })
    },
    onSuccess: () => {
      onClose()
      qc.invalidateQueries({ queryKey: ['order'] })
    },
  })

  if (!open) return null

  const returnableItems = items.filter((i) => !i.excludeFromReturns)
  const excludedItems = items.filter((i) => i.excludeFromReturns)

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-lg mx-auto bg-background rounded-2xl shadow-elevated overflow-hidden max-h-[85vh] flex flex-col"
        style={{ animation: 'fadeSlideUp 300ms ease-out' }}>

        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center">
              <RotateCcw className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <h3 className="font-bold">{t('Retoure beantragen', 'Request Return', 'طلب إرجاع')}</h3>
              <p className="text-xs text-muted-foreground">{t('Bestellung', 'Order', 'طلب')} #{orderNumber}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Countdown Banner */}
        <div className={`px-6 py-2.5 flex items-center gap-2 text-sm font-medium ${
          daysLeft <= 3 ? 'bg-red-500/10 text-red-600' : 'bg-orange-500/10 text-orange-600'
        }`}>
          <Clock className="h-4 w-4" />
          {daysLeft <= 3
            ? t(`Nur noch ${daysLeft} Tag(e)!`, `Only ${daysLeft} day(s) left!`, `${daysLeft} يوم/أيام متبقية فقط!`)
            : t(`Noch ${daysLeft} Tage bis ${deliveryDeadline}`, `${daysLeft} days left until ${deliveryDeadline}`, `${daysLeft} يوم متبقي حتى ${deliveryDeadline}`)
          }
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          <p className="text-sm text-muted-foreground mb-2">
            {t('Wähle die Artikel aus, die du zurücksenden möchtest:', 'Select the items you want to return:', 'اختر المنتجات التي تريد إرجاعها:')}
          </p>

          {/* Returnable Items */}
          {returnableItems.map((item) => {
            const isSelected = selected[item.id]
            return (
              <div key={item.id} className={`border rounded-xl p-3 transition-all ${isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'hover:border-muted-foreground/20'}`}>
                {/* Item Row */}
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={!!isSelected} onChange={() => toggleItem(item.id, item.quantity)}
                    className="rounded mt-1 h-4 w-4 accent-primary" />
                  <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                    {item.imageUrl && <Image src={item.imageUrl} alt={item.name} width={48} height={48} className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.color}{item.size ? ` / ${item.size}` : ''} × {item.quantity}</p>
                  </div>
                  <span className="text-sm font-semibold flex-shrink-0">&euro;{(item.unitPrice * (returnQty[item.id] ?? item.quantity)).toFixed(2)}</span>
                </label>

                {/* Quantity selector — only when selected AND quantity > 1 */}
                {isSelected && item.quantity > 1 && (
                  <div className="mt-2 ltr:ml-7 rtl:mr-7 flex items-center gap-2" style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
                    <span className="text-xs text-muted-foreground">{t('Menge:', 'Qty:', 'الكمية:')}</span>
                    <button type="button" onClick={(e) => { e.preventDefault(); setReturnQty((q) => ({ ...q, [item.id]: Math.max(1, (q[item.id] ?? item.quantity) - 1) })) }}
                      className="h-7 w-7 rounded-lg border flex items-center justify-center text-sm hover:bg-muted transition-colors">-</button>
                    <span className="text-sm font-semibold w-8 text-center" dir="ltr">{returnQty[item.id] ?? item.quantity}</span>
                    <button type="button" onClick={(e) => { e.preventDefault(); setReturnQty((q) => ({ ...q, [item.id]: Math.min(item.quantity, (q[item.id] ?? item.quantity) + 1) })) }}
                      className="h-7 w-7 rounded-lg border flex items-center justify-center text-sm hover:bg-muted transition-colors">+</button>
                    <span className="text-xs text-muted-foreground">/ {item.quantity}</span>
                  </div>
                )}

                {/* Reason Picker — premium chip grid. Replaces the native
                    <select>, which on mobile could overflow the viewport
                    and render unpredictably across OS (iOS picker / Android
                    dropdown / desktop-emulator micro-popup). Chips wrap
                    cleanly at any width, are all visible without tapping,
                    and give the selection a calm gold-accent treatment. */}
                {isSelected && (
                  <div className="mt-4 ltr:ml-7 rtl:mr-7 space-y-3" style={{ animation: 'fadeSlideUp 200ms ease-out' }}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {t('Grund', 'Reason', 'السبب')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {REASONS.map((r) => {
                        const value = locale === 'ar' ? r.ar : locale === 'en' ? r.en : r.de
                        const active = (reasons[item.id] || 'wrong_size') === r.value
                        return (
                          <button
                            type="button"
                            key={r.value}
                            onClick={(e) => {
                              e.preventDefault()
                              setReasons((rr) => ({ ...rr, [item.id]: r.value }))
                            }}
                            className={`px-3.5 py-2 rounded-full text-sm font-medium border transition-all duration-200 min-h-[38px] ${
                              active
                                ? 'bg-[#d4a853] text-white border-[#d4a853] shadow-sm'
                                : 'bg-background text-foreground border-border hover:border-[#d4a853]/40 hover:bg-[#d4a853]/5'
                            }`}
                          >
                            {value}
                          </button>
                        )
                      })}
                    </div>
                    {reasons[item.id] === 'other' && (
                      <textarea value={notes[item.id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))}
                        placeholder={t('Bitte beschreibe das Problem...', 'Please describe the issue...', 'يرجى وصف المشكلة...')}
                        className="w-full h-20 px-3 py-2 rounded-xl border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#d4a853]/30 focus:border-[#d4a853] transition-colors"
                        style={{ animation: 'fadeSlideUp 200ms ease-out' }} />
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Excluded Items */}
          {excludedItems.length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('Nicht retournierbar:', 'Not eligible for return:', 'غير قابل للإرجاع:')}
              </p>
              {excludedItems.map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 opacity-60">
                  <div className="w-10 h-10 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                    {item.imageUrl && <Image src={item.imageUrl} alt={item.name} width={40} height={40} className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-[10px] text-orange-600">
                      {item.returnExclusionReason === 'hygiene' ? t('Hygieneartikel', 'Hygiene product', 'منتج صحي')
                        : item.returnExclusionReason === 'custom_made' ? t('Maßanfertigung', 'Custom made', 'مصنوع حسب الطلب')
                          : item.returnExclusionReason === 'sealed' ? t('Versiegelte Ware', 'Sealed product', 'بضاعة مختومة')
                            : t('Vom Umtausch ausgeschlossen', 'Excluded from returns', 'مستثنى من الإرجاع')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex gap-3 flex-shrink-0">
          <Button variant="outline" onClick={onClose} className="flex-1">
            {t('Abbrechen', 'Cancel', 'إلغاء')}
          </Button>
          <Button
            onClick={() => returnMut.mutate()}
            disabled={selectedCount === 0 || returnMut.isPending}
            className="flex-1 gap-2"
          >
            {returnMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {selectedCount > 0
              ? t(`${selectedCount} Artikel zurücksenden`, `Return ${selectedCount} item(s)`, `إرجاع ${selectedCount} منتج/منتجات`)
              : t('Artikel auswählen', 'Select items', 'اختر المنتجات')
            }
          </Button>
        </div>

        {returnMut.isError && (
          <div className="px-6 pb-3">
            <p className="text-xs text-destructive text-center">
              {t('Fehler beim Senden. Bitte versuche es erneut.', 'Error submitting. Please try again.', 'خطأ في الإرسال. يرجى المحاولة مرة أخرى.')}
            </p>
          </div>
        )}
      </div>
    </>
  )
}
