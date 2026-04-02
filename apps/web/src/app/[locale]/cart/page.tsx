'use client'

import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import Image from 'next/image'
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight, Shield, Truck, RotateCcw } from 'lucide-react'
import { useCartStore } from '@/store/cart-store'
import { useCheckoutStore } from '@/store/checkout-store'
import { Button } from '@/components/ui/button'
import { CouponInput } from '@/components/coupon-input'

export default function CartPage() {
  const t = useTranslations('cart')
  const locale = useLocale()
  const { items, updateQuantity, removeItem, subtotal } = useCartStore()

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center animate-fade-up">
          <ShoppingBag className="h-20 w-20 mx-auto mb-6 text-muted-foreground/20" />
          <h1 className="text-2xl font-bold mb-3">{t('empty')}</h1>
          <p className="text-muted-foreground mb-8">{t('emptyHint')}</p>
          <Link href={`/${locale}/products`}>
            <Button size="lg" className="gap-2 btn-press">
              {t('continueShopping')} <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <h1 className="text-2xl sm:text-3xl font-bold mb-8 animate-fade-up">{t('title')}</h1>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Items */}
        <div className="flex-1 space-y-4">
          {items.map((item, i) => (
            <div
              key={item.variantId}
              className="flex gap-4 bg-background border rounded-2xl p-4 sm:p-5 transition-all duration-300 hover:shadow-md animate-fade-up"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              {/* Image */}
              <div className="w-24 h-28 sm:w-28 sm:h-32 bg-muted rounded-xl overflow-hidden flex-shrink-0">
                {item.imageUrl ? (
                  <Image src={item.imageUrl} alt={item.name} width={112} height={128} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground/30 text-2xl font-bold">
                    {item.name.charAt(0)}
                  </div>
                )}
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm sm:text-base line-clamp-2">{item.names?.[locale] ?? item.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {item.color && item.color}{item.size && ` / ${item.size}`}
                </p>
                <p className="text-xs text-muted-foreground font-mono">{item.sku}</p>

                {/* Price */}
                <p className="font-bold mt-2">&euro;{item.unitPrice.toFixed(2)}</p>

                {/* Quantity + Remove */}
                <div className="flex items-center gap-3 mt-3">
                  <div className="flex items-center border rounded-lg overflow-hidden">
                    <button
                      onClick={() => updateQuantity(item.variantId, Math.max(1, item.quantity - 1))}
                      className="h-8 w-8 flex items-center justify-center hover:bg-muted transition-colors btn-press"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="h-8 w-10 flex items-center justify-center text-sm font-medium border-x">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                      className="h-8 w-8 flex items-center justify-center hover:bg-muted transition-colors btn-press"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={() => removeItem(item.variantId)}
                    className="p-2 text-muted-foreground hover:text-destructive transition-colors duration-200 hover:bg-destructive/10 rounded-lg"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <span className="ml-auto font-bold text-sm">&euro;{(item.unitPrice * item.quantity).toFixed(2)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="lg:w-96 flex-shrink-0">
          <div className="bg-background border rounded-2xl p-6 lg:sticky lg:top-24 animate-fade-up delay-200">
            <h2 className="font-bold text-lg mb-5">{t('summary')}</h2>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('subtotal')} ({items.length} {t('items')})</span>
                <span className="font-medium">&euro;{subtotal().toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('shipping')}</span>
                <span className="text-green-600 font-medium">{subtotal() >= 100 ? t('free') : '€4.99'}</span>
              </div>
              {useCheckoutStore.getState().discountAmount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>{useCheckoutStore.getState().appliedCoupon?.description || 'Rabatt'}</span>
                  <span className="font-medium">-€{useCheckoutStore.getState().discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="h-px bg-border my-2" />
              <div className="flex justify-between text-lg font-bold">
                <span>{t('total')}</span>
                <span>&euro;{(subtotal() + (subtotal() >= 100 ? 0 : 4.99) - (useCheckoutStore.getState().discountAmount || 0)).toFixed(2)}</span>
              </div>
            </div>

            {/* Coupon Code Input */}
            <div className="mt-4">
              <CouponInput subtotal={subtotal()} />
            </div>

            <Link href={`/${locale}/checkout`} className="block mt-4">
              <Button size="lg" className="w-full gap-2 text-base btn-press">
                {t('checkout')} <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>

            <Link href={`/${locale}/products`} className="block text-center mt-3">
              <span className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                {t('continueShopping')}
              </span>
            </Link>

            {/* Trust badges */}
            <div className="mt-6 pt-5 border-t space-y-3">
              {[
                { Icon: Truck, text: t('trustShipping') },
                { Icon: RotateCcw, text: t('trustReturns') },
                { Icon: Shield, text: t('trustSecure') },
              ].map(({ Icon, text }, i) => (
                <div key={i} className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
