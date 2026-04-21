'use client'

/**
 * WhatsApp Smart-Link admin tool (C7).
 *
 * Replaces the removed `/feeds/whatsapp` catalog feed with a
 * copy-paste workflow: admin clicks "Als DE kopieren" or "Als AR
 * kopieren", the message is built from the product's name +
 * description + price + shop link + variant info (colors/sizes
 * separately per user Q3b), and copied to the clipboard via
 * `navigator.clipboard.writeText`. Admin pastes it into WhatsApp
 * Business Catalog (or any chat) — no Meta Commerce API needed.
 *
 * Gating:
 *   Only rendered when product.channelWhatsapp === true AND the
 *   product has at least one active variant. The parent component
 *   is responsible for hiding / disabling based on those fields.
 */

import { useState } from 'react'
import { MessageCircle, Check } from 'lucide-react'

interface Variant {
  color: string | null
  size: string | null
  isActive?: boolean
}

interface Props {
  product: {
    id: string
    slug: string
    basePrice: number | string
    salePrice?: number | string | null
    variants?: Variant[]
    translations?: Array<{ language: string; name: string; description?: string | null }>
  }
  // App base URL — used to build the shop link inside the message.
  appUrl: string
}

type Lang = 'de' | 'en' | 'ar'

function pickTranslation(
  product: Props['product'],
  lang: Lang,
): { name: string; description: string } {
  const rows = product.translations ?? []
  const want = rows.find((r) => r.language === lang)
  const fallback = rows.find((r) => r.language === 'de') ?? rows[0]
  const tr = want ?? fallback
  return {
    name: tr?.name ?? product.slug,
    description: (tr?.description ?? '').trim(),
  }
}

function distinctColors(product: Props['product']): string[] {
  const set = new Set<string>()
  for (const v of product.variants ?? []) {
    if (v.isActive === false) continue
    if (v.color) set.add(v.color)
  }
  return Array.from(set)
}

function distinctSizes(product: Props['product']): string[] {
  const set = new Set<string>()
  for (const v of product.variants ?? []) {
    if (v.isActive === false) continue
    if (v.size) set.add(v.size)
  }
  return Array.from(set)
}

/**
 * Build the share message for a given locale. Kept as a pure function
 * so tests can lock its output exactly.
 *
 * Shape (per user Q2c — two explicit buttons, Q3b — colors + sizes
 * separate, NOT a full matrix):
 *
 *   {Product Name}
 *
 *   {Description (trimmed, ≤280 chars)}
 *
 *   Preis: {price} EUR
 *   Farben: {c1}, {c2}, …
 *   Größen: {s1}, {s2}, …
 *
 *   Jetzt ansehen: {shopUrl}
 */
export function buildWhatsAppMessage(
  product: Props['product'],
  lang: Lang,
  appUrl: string,
): string {
  const { name, description } = pickTranslation(product, lang)
  const colors = distinctColors(product)
  const sizes = distinctSizes(product)

  const finalPrice = product.salePrice != null
    ? Number(product.salePrice)
    : Number(product.basePrice)
  const priceStr = `${finalPrice.toFixed(2)} EUR`

  const shopUrl = `${appUrl.replace(/\/$/, '')}/${lang}/products/${product.slug}`

  const L = ({
    de: { price: 'Preis', colors: 'Farben', sizes: 'Größen', view: 'Jetzt ansehen' },
    en: { price: 'Price', colors: 'Colors', sizes: 'Sizes', view: 'View now' },
    ar: { price: 'السعر', colors: 'الألوان', sizes: 'المقاسات', view: 'عرض المنتج' },
  } as const)[lang]

  const lines: string[] = []
  lines.push(name)
  if (description) {
    // Trim to 280 chars to keep the WhatsApp chat preview readable.
    const trimmed = description.length > 280
      ? description.slice(0, 277).trimEnd() + '…'
      : description
    lines.push('')
    lines.push(trimmed)
  }
  lines.push('')
  lines.push(`${L.price}: ${priceStr}`)
  if (colors.length > 0) lines.push(`${L.colors}: ${colors.join(', ')}`)
  if (sizes.length > 0) lines.push(`${L.sizes}: ${sizes.join(', ')}`)
  lines.push('')
  lines.push(`${L.view}: ${shopUrl}`)
  return lines.join('\n')
}

export function WhatsAppShareButton({ product, appUrl }: Props) {
  const [copiedDe, setCopiedDe] = useState(false)
  const [copiedAr, setCopiedAr] = useState(false)

  const copy = async (lang: Lang) => {
    const msg = buildWhatsAppMessage(product, lang, appUrl)
    try {
      await navigator.clipboard.writeText(msg)
      if (lang === 'de') {
        setCopiedDe(true); setTimeout(() => setCopiedDe(false), 2500)
      } else {
        setCopiedAr(true); setTimeout(() => setCopiedAr(false), 2500)
      }
    } catch {
      // Fallback: show the message in a prompt the admin can select
      // from. Rare — modern browsers grant clipboard write to any
      // user-gesture on the admin origin.
      // eslint-disable-next-line no-alert
      window.prompt('Nachricht zum Kopieren:', msg)
    }
  }

  return (
    <div className="rounded-xl border border-[#25D366]/30 bg-[#25D366]/5 dark:bg-[#25D366]/10 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-5 w-5 text-[#25D366]" />
        <p className="text-sm font-semibold">WhatsApp-Freigabe</p>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Erzeuge eine fertige Produkt-Nachricht zum Einfügen in WhatsApp-
        Business-Katalog oder jede WhatsApp-Konversation. Bilder bitte
        separat aus dem Produkt-Galerie-Block kopieren.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => copy('de')}
          className="flex-1 h-9 px-3 rounded-lg border bg-background hover:bg-muted text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
        >
          {copiedDe ? (
            <><Check className="h-4 w-4 text-[#25D366]" /> Kopiert (DE)</>
          ) : (
            <>Als DE kopieren</>
          )}
        </button>
        <button
          type="button"
          onClick={() => copy('ar')}
          dir="rtl"
          className="flex-1 h-9 px-3 rounded-lg border bg-background hover:bg-muted text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
        >
          {copiedAr ? (
            <><Check className="h-4 w-4 text-[#25D366]" /> تم النسخ</>
          ) : (
            <>نسخ بالعربية</>
          )}
        </button>
      </div>
    </div>
  )
}
