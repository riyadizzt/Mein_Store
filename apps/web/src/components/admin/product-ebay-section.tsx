'use client'

/**
 * Product-Editor eBay Section (C11c).
 *
 * Distinct from the other channel toggles (facebook/tiktok/google/whatsapp)
 * because the eBay pathway does not use a Product.channelEbay boolean:
 * eBay is driven purely via ChannelProductListing rows, toggled through
 * a dedicated backend endpoint.
 *
 * Admin workflow:
 *   1. Flip the toggle ON (or OFF). The service fan-outs to every
 *      active variant and writes ChannelProductListing rows.
 *   2. Optionally set a per-product channelPrice (applied to every
 *      listing row of this product). If < 1.15x effective shop price
 *      a margin-warning banner surfaces.
 *   3. Click "Publish pending" in eBay Connection Card → backend
 *      pushes all pending listings (across ALL products) to eBay.
 *
 * Surfaces below the toggle: per-variant status grid with
 * externalListingId link when active, syncError when rejected.
 */

import { useState, useEffect, useMemo } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Loader2, AlertTriangle, CheckCircle2, Info, ExternalLink, ShoppingBag } from 'lucide-react'

const t3 = (l: string, d: string, e: string, a: string) =>
  l === 'ar' ? a : l === 'en' ? e : d

interface ListingRow {
  id: string
  variantId: string | null
  variantSku: string | null
  variantColor: string | null
  variantSize: string | null
  status: string
  externalListingId: string | null
  channelPrice: string | null
  safetyStock: number
  syncAttempts: number
  syncError: string | null
  lastSyncedAt: string | null
}

interface Props {
  productId: string
  productActive: boolean
  basePrice: number
  salePrice: number | null
}

export function ProductEbaySection({ productId, productActive, basePrice, salePrice }: Props) {
  const locale = useLocale()
  const qc = useQueryClient()
  const [priceDraft, setPriceDraft] = useState<string>('')
  const [priceEditing, setPriceEditing] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const { data, isLoading } = useQuery<{ rows: ListingRow[] }>({
    queryKey: ['ebay', 'listings', productId],
    queryFn: async () => (await api.get('/admin/marketplaces/ebay/listings', { params: { productId } })).data,
    enabled: Boolean(productId),
  })

  const rows = data?.rows ?? []
  const activeRows = rows.filter((r) => r.status !== 'deleted')
  // "Enabled" = at least one non-deleted row exists for this product.
  const isEnabled = activeRows.length > 0

  // Pick the first non-null channelPrice (we set the same price per
  // product across all variants, so any row carries it).
  const persistedChannelPrice = useMemo(() => {
    const first = activeRows.find((r) => r.channelPrice)
    return first?.channelPrice ?? null
  }, [activeRows])

  // Keep priceDraft in sync with persisted value when not editing.
  useEffect(() => {
    if (!priceEditing) setPriceDraft(persistedChannelPrice ?? '')
  }, [persistedChannelPrice, priceEditing])

  // Margin-warning check — mirror backend logic.
  const effectiveShopPrice = salePrice ?? basePrice
  const threshold = effectiveShopPrice * 1.15
  const channelPriceNum = priceDraft && !Number.isNaN(Number(priceDraft)) ? Number(priceDraft) : null
  const hasMarginWarning =
    channelPriceNum != null && channelPriceNum > 0 && channelPriceNum < threshold

  const toggleMut = useMutation({
    mutationFn: async (nextEnabled: boolean) => {
      return (await api.post('/admin/marketplaces/ebay/toggle-listing', {
        productId,
        enabled: nextEnabled,
        // Pass current priceDraft on ENABLE only; backend stores it
        // on every freshly-created listing row.
        channelPrice: nextEnabled && priceDraft ? priceDraft : null,
      })).data
    },
    onSuccess: (d: any) => {
      setBanner({
        kind: 'success',
        text: d.enabled
          ? t3(locale,
              `eBay aktiviert für ${d.affectedVariants} Variante(n). Klicke "Publish Pending" in der eBay-Karte um auf eBay zu pushen.`,
              `eBay enabled for ${d.affectedVariants} variant(s). Click "Publish Pending" in the eBay card to push to eBay.`,
              `تم تفعيل eBay لـ ${d.affectedVariants} متغير(ات). انقر "نشر المعلقة" في بطاقة eBay للنشر على eBay.`)
          : t3(locale,
              `eBay deaktiviert. Das Listing bleibt auf eBay aktiv bis zum nächsten Sync-Update (kommt in C11.5). Alternativ: Manuell im eBay Seller Hub delisten.`,
              `eBay disabled. The listing remains active on eBay until the next sync update (coming in C11.5). Alternative: Manually delist in eBay Seller Hub.`,
              `تم إلغاء تفعيل eBay. يظلّ المنتج نشطاً على eBay حتّى تحديث المزامنة التالي. الخيار البديل: حذفه يدوياً من eBay Seller Hub.`),
      })
      qc.invalidateQueries({ queryKey: ['ebay', 'listings', productId] })
      qc.invalidateQueries({ queryKey: ['ebay', 'pending-count'] })
    },
    onError: (e: any) => {
      const msg = e?.message
      setBanner({
        kind: 'error',
        text: (typeof msg === 'object' ? msg[locale] ?? msg.de : msg) ??
          t3(locale, 'Toggle fehlgeschlagen', 'Toggle failed', 'فشل التبديل'),
      })
    },
  })

  const statusChip = (status: string) => {
    const map: Record<string, { bg: string; text: string; label: { de: string; en: string; ar: string } }> = {
      pending: { bg: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', label: { de: 'Wartend', en: 'Pending', ar: 'قيد الانتظار' } },
      active: { bg: 'bg-green-500/10', text: 'text-green-700 dark:text-green-400', label: { de: 'Aktiv', en: 'Active', ar: 'نشط' } },
      paused: { bg: 'bg-slate-500/10', text: 'text-slate-700 dark:text-slate-400', label: { de: 'Pausiert', en: 'Paused', ar: 'متوقف' } },
      rejected: { bg: 'bg-red-500/10', text: 'text-red-700 dark:text-red-400', label: { de: 'Fehler', en: 'Error', ar: 'خطأ' } },
      deleted: { bg: 'bg-muted', text: 'text-muted-foreground', label: { de: 'Deaktiviert', en: 'Disabled', ar: 'معطل' } },
    }
    const s = map[status] ?? map.pending
    return (
      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${s.bg} ${s.text}`}>
        {t3(locale, s.label.de, s.label.en, s.label.ar)}
      </span>
    )
  }

  const ebayListingUrl = (externalListingId: string) => {
    // Sandbox vs production — for now we link to sandbox.
    return `https://www.sandbox.ebay.de/itm/${externalListingId}`
  }

  return (
    <div className="rounded-2xl border bg-background p-4 mb-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-yellow-500/10">
          <ShoppingBag className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-sm">eBay Marketplace</p>
          <p className="text-[11px] text-muted-foreground">
            {t3(locale,
              'Separates Push-System. Zuerst Toggle, dann "Publish Pending" in der eBay-Karte.',
              'Separate push system. Toggle first, then click "Publish Pending" in the eBay card.',
              'نظام نشر منفصل. قم بالتبديل أولاً، ثم انقر على "نشر المعلقة" في بطاقة eBay.')}
          </p>
        </div>
        {/* Toggle */}
        <button
          type="button"
          disabled={!productActive || toggleMut.isPending}
          onClick={() => toggleMut.mutate(!isEnabled)}
          className={`w-10 h-[22px] rounded-full flex-shrink-0 transition-colors duration-300 ${
            (!productActive || toggleMut.isPending) ? 'cursor-not-allowed opacity-50' : ''
          }`}
          style={{
            backgroundColor: isEnabled ? '#d4a853' : 'hsl(var(--muted))',
          }}
          title={!productActive ? t3(locale, 'Produkt inaktiv — zuerst aktivieren', 'Product inactive — activate first', 'المنتج غير نشط — يجب تفعيله أولاً') : ''}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 mt-[3px] ${
              isEnabled ? 'ltr:translate-x-[21px] rtl:-translate-x-[21px]' : 'ltr:translate-x-[3px] rtl:-translate-x-[3px]'
            }`}
          />
        </button>
      </div>

      {/* Transient success/error banner */}
      {banner && (
        <div
          className={
            'rounded-lg p-3 text-xs flex items-start gap-2 ' +
            (banner.kind === 'success'
              ? 'bg-green-500/10 text-green-800 dark:text-green-300'
              : 'bg-amber-500/10 text-amber-900 dark:text-amber-200')
          }
        >
          {banner.kind === 'success' ? <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
          <span>{banner.text}</span>
          <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => setBanner(null)}>×</button>
        </div>
      )}

      {/* Price input + margin warning (only when enabled) */}
      {isEnabled && (
        <div>
          <label className="block text-xs font-medium mb-1.5 uppercase tracking-wide text-muted-foreground">
            {t3(locale, 'eBay-Preis (optional)', 'eBay price (optional)', 'سعر eBay (اختياري)')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              min="0"
              value={priceDraft}
              onFocus={() => setPriceEditing(true)}
              onBlur={() => setPriceEditing(false)}
              onChange={(e) => setPriceDraft(e.target.value)}
              placeholder={`${effectiveShopPrice.toFixed(2)} (${t3(locale, 'Shop-Preis', 'shop price', 'سعر المتجر')})`}
              className="flex-1 h-9 px-3 rounded-lg border bg-background text-sm"
              dir="ltr"
            />
            <span className="text-xs text-muted-foreground">EUR</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                toggleMut.mutate(true)
              }}
              disabled={toggleMut.isPending}
            >
              {toggleMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              {t3(locale, 'Speichern', 'Save', 'حفظ')}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {t3(locale,
              `Leer = Shop-Preis ${effectiveShopPrice.toFixed(2)}€ auf eBay. Empfehlung: mindestens ${threshold.toFixed(2)}€ für 15% Margenpuffer gegen Provision.`,
              `Empty = shop price ${effectiveShopPrice.toFixed(2)}€ on eBay. Recommended: at least ${threshold.toFixed(2)}€ for 15% margin buffer against commission.`,
              `فارغ = سعر المتجر ${effectiveShopPrice.toFixed(2)}€ على eBay. الموصى به: ${threshold.toFixed(2)}€ على الأقل لهامش ربح 15% ضد العمولة.`)}
          </p>

          {hasMarginWarning && (
            <div className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-amber-600" />
              <div className="text-amber-900 dark:text-amber-200">
                {t3(locale,
                  `Margen-Warnung: eBay-Preis liegt unter dem empfohlenen Puffer (${threshold.toFixed(2)}€). Nach eBay-Provision (~11%) bleibt kaum Gewinn.`,
                  `Margin warning: eBay price is below the recommended buffer (${threshold.toFixed(2)}€). After eBay commission (~11%) profit margin is minimal.`,
                  `تحذير الهامش: سعر eBay أقل من الهامش الموصى به (${threshold.toFixed(2)}€). بعد عمولة eBay (~11%) هامش الربح ضئيل.`)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Per-variant status grid */}
      {isEnabled && (
        <div className="pt-2 border-t">
          <p className="text-xs font-medium mb-2 uppercase tracking-wide text-muted-foreground">
            {t3(locale, 'Varianten-Status', 'Variant status', 'حالة المتغيرات')}
          </p>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : activeRows.length === 0 ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" />
              {t3(locale, 'Keine aktiven Varianten', 'No active variants', 'لا توجد متغيرات نشطة')}
            </p>
          ) : (
            <div className="space-y-1.5">
              {activeRows.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-xs">
                  <code className="text-[10px] bg-muted rounded px-1.5 py-0.5 font-mono">
                    {r.variantSku ?? '—'}
                  </code>
                  {(r.variantColor || r.variantSize) && (
                    <span className="text-muted-foreground">
                      {[r.variantColor, r.variantSize].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1.5">
                    {statusChip(r.status)}
                    {r.externalListingId && r.status === 'active' && (
                      <a
                        href={ebayListingUrl(r.externalListingId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5"
                        title={r.externalListingId}
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        eBay
                      </a>
                    )}
                  </div>
                  {r.syncError && r.status === 'rejected' && (
                    <div className="w-full mt-1 text-[10px] text-red-700 dark:text-red-400 pl-2 border-l-2 border-red-500/30">
                      {r.syncError}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
