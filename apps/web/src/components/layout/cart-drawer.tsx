'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import Image from 'next/image'
import { X, Minus, Plus, ShoppingBag } from 'lucide-react'
import { useCartStore } from '@/store/cart-store'
import { Button } from '@/components/ui/button'

export function CartDrawer({ locale }: { locale: string }) {
  const t = useTranslations('cart')
  const { items, isDrawerOpen, closeDrawer, removeItem, updateQuantity } = useCartStore()
  const subtotal = useCartStore((s) => s.subtotal())

  // Stock check
  const [stockMap, setStockMap] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!isDrawerOpen || items.length === 0) return
    const variantIds = items.map((i) => i.variantId)
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/products/stock-check`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantIds }),
    }).then((r) => r.ok ? r.json() : {}).then(setStockMap).catch(() => {})
  }, [isDrawerOpen, items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isDrawerOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={closeDrawer} />

      {/* Drawer */}
      <div className="fixed top-0 right-0 rtl:right-auto rtl:left-0 z-50 h-full w-full max-w-md bg-background shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <button onClick={closeDrawer} className="p-1 hover:bg-muted rounded-lg transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Items */}
        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
            <ShoppingBag className="h-20 w-20 text-muted-foreground/20" />
            <p className="text-muted-foreground">{t('empty')}</p>
            <Button variant="outline" onClick={closeDrawer}>
              {t('continueShopping')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {items.map((item) => (
                <div key={item.variantId} className="flex gap-4">
                  {/* Image */}
                  <div className="w-20 h-20 bg-muted rounded-xl overflow-hidden flex-shrink-0">
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={item.name}
                        width={80}
                        height={80}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                        {item.sku}
                      </div>
                    )}
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.names?.[locale] ?? item.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.color && `${item.color}`}
                      {item.color && item.size && ' / '}
                      {item.size && `${item.size}`}
                    </p>
                    <p className="text-sm font-semibold mt-1">&euro;{item.unitPrice.toFixed(2)}</p>

                    {/* Quantity */}
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => updateQuantity(item.variantId, Math.max(1, item.quantity - 1))}
                        disabled={item.quantity <= 1}
                        className="h-7 w-7 rounded border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-30"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="text-sm font-medium w-6 text-center">{item.quantity}</span>
                      <button
                        onClick={() => {
                          const max = Math.min(10, stockMap[item.variantId] ?? 10)
                          if (item.quantity < max) updateQuantity(item.variantId, item.quantity + 1)
                        }}
                        disabled={stockMap[item.variantId] !== undefined ? item.quantity >= Math.min(10, stockMap[item.variantId]) : false}
                        className="h-7 w-7 rounded border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-30"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => removeItem(item.variantId)}
                        className="ml-auto text-xs text-destructive hover:underline"
                      >
                        {t('remove')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="border-t px-6 py-4 space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('subtotal')}</span>
                <span className="text-lg font-bold">&euro;{subtotal.toFixed(2)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t('shipping')} &amp; {t('tax')} werden an der Kasse berechnet.</p>
              <Link
                href={`/${locale}/checkout`}
                onClick={closeDrawer}
                className="block"
              >
                <Button className="w-full h-12" size="lg">
                  {t('checkout')}
                </Button>
              </Link>
            </div>
          </>
        )}
      </div>
    </>
  )
}
