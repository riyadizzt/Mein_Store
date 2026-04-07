'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import Image from 'next/image'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, Check, Loader2, Package, Tag, Palette, Image as ImageIcon } from 'lucide-react'
import { useProductWizardStore } from '@/store/product-wizard-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

export function StepPreview() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const router = useRouter()
  const store = useProductWizardStore()
  const [saveAs, setSaveAs] = useState<'active' | 'draft'>('active')

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Build product payload
      const payload = {
        slug: store.slug,
        categoryId: store.categoryId,
        basePrice: store.basePrice,
        salePrice: store.salePrice,
        taxRate: store.taxRate,
        isActive: saveAs === 'active',
        translations: Object.entries(store.translations)
          .filter(([, t]) => t.name)
          .map(([lang, t]) => ({
            language: lang,
            name: t.name,
            description: t.description || undefined,
            metaTitle: t.metaTitle || undefined,
            metaDesc: t.metaDesc || undefined,
          })),
        variants: store.variants.map((v) => ({
          sku: v.sku,
          color: v.colorName,
          colorHex: v.colorHex,
          size: v.size,
          priceModifier: v.price - store.basePrice,
          weightGrams: v.weight,
          initialStock: v.stock.default ?? 0,
        })),
      }

      const { data } = await api.post('/products', payload)
      return data
    },
    onSuccess: () => {
      store.reset()
      router.push(`/${locale}/admin/products`)
    },
  })

  const totalVariants = store.variants.length
  const totalStock = store.variants.reduce((s, v) => s + (v.stock.default ?? 0), 0)
  const primaryImage = store.images.find((i) => i.isPrimary)

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold mb-1">{t('wizard.saveAndPublish')}</h2>
        <p className="text-sm text-muted-foreground">{t('wizard.previewDesc')}</p>
      </div>

      {/* Preview Card */}
      <div className="border rounded-xl overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
          {/* Image */}
          <div className="aspect-square bg-muted relative">
            {primaryImage ? (
              <Image src={primaryImage.url} alt="" fill className="object-cover" sizes="400px" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="h-16 w-16 text-muted-foreground/20" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-6 space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                {store.categoryId ? t('wizard.category') : t('wizard.noCategory')}
              </p>
              <h3 className="text-2xl font-bold">{store.translations.de.name || t('wizard.noName')}</h3>
              {store.translations.en.name && (
                <p className="text-sm text-muted-foreground mt-0.5">EN: {store.translations.en.name}</p>
              )}
              {store.translations.ar.name && (
                <p className="text-sm text-muted-foreground mt-0.5" dir="rtl">AR: {store.translations.ar.name}</p>
              )}
            </div>

            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-bold">&euro;{store.basePrice.toFixed(2)}</span>
              {store.salePrice && (
                <span className="text-lg text-muted-foreground line-through">&euro;{store.salePrice.toFixed(2)}</span>
              )}
            </div>

            <div className="text-sm text-muted-foreground">
              inkl. {store.taxRate}% MwSt.
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t">
              <div className="text-center">
                <Palette className="h-5 w-5 mx-auto mb-1 text-primary" />
                <p className="text-lg font-bold">{store.colors.length}</p>
                <p className="text-xs text-muted-foreground">{t('wizard.colorsCount')}</p>
              </div>
              <div className="text-center">
                <Tag className="h-5 w-5 mx-auto mb-1 text-primary" />
                <p className="text-lg font-bold">{totalVariants}</p>
                <p className="text-xs text-muted-foreground">{t('wizard.variantsCount')}</p>
              </div>
              <div className="text-center">
                <Package className="h-5 w-5 mx-auto mb-1 text-primary" />
                <p className="text-lg font-bold">{totalStock}</p>
                <p className="text-xs text-muted-foreground">{t('wizard.stockCount')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Table */}
      <div className="border rounded-xl p-5">
        <h3 className="font-semibold mb-3">{t('wizard.summaryTitle')}</h3>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-muted-foreground">{t('wizard.slug')}</span>
          <span className="font-mono">{store.slug || '—'}</span>
          <span className="text-muted-foreground">{t('wizard.images')}</span>
          <span>{store.images.length}</span>
          <span className="text-muted-foreground">{t('wizard.description')} (DE)</span>
          <span>{store.translations.de.description ? `${store.translations.de.description.slice(0, 50)}...` : '—'}</span>
        </div>
      </div>

      {/* Variant Preview */}
      {store.variants.length > 0 && (
        <div className="border rounded-xl p-5">
          <h3 className="font-semibold mb-3">{t('wizard.variantsCount')}</h3>
          <div className="flex flex-wrap gap-2">
            {store.colors.map((c) => (
              <div key={c.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-xs">
                <div className="h-3 w-3 rounded-full border" style={{ backgroundColor: c.hex }} />
                {c.name}: {c.sizes.join(', ')}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save Options */}
      <div className="border rounded-xl p-5 space-y-4">
        <h3 className="font-semibold">{t('wizard.saveAs')}</h3>
        <div className="flex gap-3">
          <button
            onClick={() => setSaveAs('active')}
            className={`flex-1 p-4 rounded-lg border-2 text-start transition-colors ${
              saveAs === 'active' ? 'border-primary bg-primary/5' : 'border-border'
            }`}
          >
            <p className="font-medium text-sm">{t('wizard.saveAsActive')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t('wizard.saveAsActiveDesc')}</p>
          </button>
          <button
            onClick={() => setSaveAs('draft')}
            className={`flex-1 p-4 rounded-lg border-2 text-start transition-colors ${
              saveAs === 'draft' ? 'border-primary bg-primary/5' : 'border-border'
            }`}
          >
            <p className="font-medium text-sm">{t('wizard.saveAsDraft')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t('wizard.saveAsDraftDesc')}</p>
          </button>
        </div>
      </div>

      {/* Error */}
      {saveMutation.isError && (
        <div className="p-4 rounded-lg bg-destructive/10 text-sm text-destructive">
          {t('wizard.saveError')}: {(saveMutation.error as any)?.response?.data?.message ?? ''}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => store.setStep('images')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> {t('wizard.back')}
        </Button>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          size="lg"
          className="gap-2"
        >
          {saveMutation.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> {t('wizard.saving')}</>
          ) : (
            <><Check className="h-4 w-4" /> {t('wizard.saveProduct')}</>
          )}
        </Button>
      </div>
    </div>
  )
}
