'use client'

import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Heart, X } from 'lucide-react'
import Image from 'next/image'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

export default function WishlistPage() {
  const t = useTranslations('account.wishlist')
  const tProduct = useTranslations('product')
  const locale = useLocale()
  const queryClient = useQueryClient()

  const { data: items, isLoading } = useQuery({
    queryKey: ['my-wishlist'],
    queryFn: async () => { const { data } = await api.get('/users/me/wishlist'); return data },
  })

  const removeMutation = useMutation({
    mutationFn: (productId: string) => api.delete(`/users/me/wishlist/${productId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-wishlist'] }),
  })

  if (isLoading) return <div className="grid grid-cols-2 gap-4">{[1, 2, 3, 4].map((i) => <div key={i} className="h-64 animate-pulse bg-muted rounded-lg" />)}</div>

  if (!items || items.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="h-20 w-20 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-5">
          <Heart className="h-9 w-9 text-red-300" />
        </div>
        <h2 className="text-lg font-semibold mb-2">{t('empty')}</h2>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-6">{t('emptyHint')}</p>
        <Link href={`/${locale}/products`}>
          <Button className="gap-2 btn-press">{t('discover')}</Button>
        </Link>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">{t('title')}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {items.map((item: any) => {
          const product = item.product
          const name = product.translations?.find((t: any) => t.language === locale)?.name ?? product.translations?.[0]?.name ?? ''
          const imageUrl = product.images?.[0]?.url
          const price = product.salePrice ?? product.basePrice

          return (
            <div key={item.id} className="group relative border rounded-lg overflow-hidden">
              <button
                onClick={() => removeMutation.mutate(product.id)}
                className="absolute top-2 right-2 z-10 h-7 w-7 rounded-full bg-background/80 flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>

              <Link href={`/${locale}/products/${product.slug}`}>
                <div className="aspect-square bg-muted">
                  {imageUrl && <Image src={imageUrl} alt={name} fill sizes="(max-width: 640px) 50vw, 33vw" className="object-cover" />}
                </div>
              </Link>

              <div className="p-3">
                <p className="text-sm font-medium truncate">{name}</p>
                <p className="text-sm font-bold mt-1">&euro;{Number(price).toFixed(2)}</p>
                {!product.isActive && (
                  <span className="text-xs text-destructive">{tProduct('outOfStock')}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
