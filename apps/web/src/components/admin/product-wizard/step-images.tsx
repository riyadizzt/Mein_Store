'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { ArrowLeft, ArrowRight, Upload, Star, X, GripVertical, ImageIcon } from 'lucide-react'
import { useProductWizardStore } from '@/store/product-wizard-store'
import { Button } from '@/components/ui/button'

export function StepImages() {
  const t = useTranslations('admin')
  const { images, colors, addImage, removeImage, setImagePrimary, setImageColor, reorderImages, setStep } = useProductWizardStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return
      const url = URL.createObjectURL(file)
      addImage({
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        url,
        isPrimary: false,
        sortOrder: images.length,
      })
    })
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    handleFileSelect(e.dataTransfer.files)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  // Reorder via drag
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold mb-1">{t('wizard.images')}</h2>
        <p className="text-sm text-muted-foreground">{t('wizard.imagesDesc')}</p>
      </div>

      {/* Upload Zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="border-2 border-dashed rounded-xl p-12 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
      >
        <Upload className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
        <p className="text-sm font-medium">{t('wizard.uploadZone')}</p>
        <p className="text-xs text-muted-foreground mt-1">{t('wizard.uploadHint')}</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => handleFileSelect(e.target.files)}
          className="hidden"
        />
      </div>

      {/* Image Grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {images
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((img, index) => (
              <div
                key={img.id}
                draggable
                onDragStart={() => setDragFrom(index)}
                onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index) }}
                onDragLeave={() => setDragOverIndex(null)}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragFrom !== null && dragFrom !== index) reorderImages(dragFrom, index)
                  setDragFrom(null)
                  setDragOverIndex(null)
                }}
                className={`relative group border rounded-lg overflow-hidden ${
                  dragOverIndex === index ? 'ring-2 ring-primary' : ''
                } ${img.isPrimary ? 'ring-2 ring-yellow-500' : ''}`}
              >
                {/* Image */}
                <div
                  className="aspect-square bg-muted relative cursor-pointer"
                  onClick={() => setPreviewUrl(img.url)}
                >
                  <Image src={img.url} alt="" fill className="object-cover" sizes="200px" />

                  {/* Drag Handle */}
                  <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="h-6 w-6 rounded bg-black/50 flex items-center justify-center">
                      <GripVertical className="h-3.5 w-3.5 text-white" />
                    </div>
                  </div>

                  {/* Primary Badge */}
                  {img.isPrimary && (
                    <div className="absolute top-1 right-1">
                      <div className="h-6 w-6 rounded bg-yellow-500 flex items-center justify-center">
                        <Star className="h-3.5 w-3.5 text-white fill-white" />
                      </div>
                    </div>
                  )}

                  {/* Delete */}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeImage(img.id) }}
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 rounded bg-destructive/80 flex items-center justify-center hover:bg-destructive"
                    style={img.isPrimary ? { right: '2rem' } : {}}
                  >
                    <X className="h-3.5 w-3.5 text-white" />
                  </button>
                </div>

                {/* Controls */}
                <div className="p-2 space-y-1.5">
                  {/* Set Primary */}
                  {!img.isPrimary && (
                    <button
                      onClick={() => setImagePrimary(img.id)}
                      className="text-[10px] text-muted-foreground hover:text-yellow-600 flex items-center gap-1"
                    >
                      <Star className="h-3 w-3" /> {t('wizard.primaryImage')}
                    </button>
                  )}

                  {/* Color Assignment */}
                  {colors.length > 0 && (
                    <select
                      value={img.colorId ?? ''}
                      onChange={(e) => setImageColor(img.id, e.target.value || undefined)}
                      className="w-full h-7 px-2 rounded border bg-background text-[10px]"
                    >
                      <option value="">{t('wizard.allColors')}</option>
                      {colors.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}

      {images.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{t('wizard.noImages')}</p>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewUrl && (
        <>
          <div className="fixed inset-0 z-50 bg-black/80" onClick={() => setPreviewUrl(null)} />
          <div className="fixed inset-4 z-50 flex items-center justify-center" onClick={() => setPreviewUrl(null)}>
            <Image src={previewUrl} alt="" fill className="object-contain" sizes="90vw" />
            <button className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20">
              <X className="h-5 w-5 text-white" />
            </button>
          </div>
        </>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep('variants')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> {t('wizard.back')}
        </Button>
        <Button onClick={() => setStep('preview')} size="lg" className="gap-2">
          {t('wizard.nextPreview')} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
