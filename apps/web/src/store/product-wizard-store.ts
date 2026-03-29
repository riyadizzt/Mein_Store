import { create } from 'zustand'

export interface ProductTranslation {
  name: string
  description: string
  metaTitle: string
  metaDesc: string
}

export interface ProductColor {
  id: string
  name: string
  hex: string
  sizes: string[]
}

export interface ProductVariant {
  colorId: string
  colorName: string
  colorHex: string
  size: string
  sku: string
  price: number
  weight: number
  stock: Record<string, number> // warehouseId → quantity
}

export interface ProductImage {
  id: string
  file?: File
  url: string
  colorId?: string
  isPrimary: boolean
  sortOrder: number
}

type WizardStep = 'basics' | 'variants' | 'images' | 'preview'

interface ProductWizardState {
  step: WizardStep
  // Step 1: Basics
  translations: Record<string, ProductTranslation>
  categoryId: string
  slug: string
  basePrice: number
  salePrice: number | null
  taxRate: number
  // Step 2: Variants
  colors: ProductColor[]
  variants: ProductVariant[]
  // Step 3: Images
  images: ProductImage[]
  // Actions
  setStep: (step: WizardStep) => void
  setTranslation: (lang: string, data: Partial<ProductTranslation>) => void
  setCategoryId: (id: string) => void
  setSlug: (slug: string) => void
  setBasePrice: (price: number) => void
  setSalePrice: (price: number | null) => void
  addColor: (color: Omit<ProductColor, 'id'>) => void
  removeColor: (id: string) => void
  updateColorSizes: (colorId: string, sizes: string[]) => void
  generateVariants: () => void
  updateVariant: (colorId: string, size: string, data: Partial<ProductVariant>) => void
  bulkSetPrice: (price: number) => void
  bulkSetStock: (warehouseId: string, qty: number) => void
  addImage: (image: ProductImage) => void
  removeImage: (id: string) => void
  setImagePrimary: (id: string) => void
  setImageColor: (imageId: string, colorId: string | undefined) => void
  reorderImages: (fromIndex: number, toIndex: number) => void
  reset: () => void
}

const emptyTranslation: ProductTranslation = { name: '', description: '', metaTitle: '', metaDesc: '' }

const initialState = {
  step: 'basics' as WizardStep,
  translations: { de: { ...emptyTranslation }, en: { ...emptyTranslation }, ar: { ...emptyTranslation } },
  categoryId: '',
  slug: '',
  basePrice: 0,
  salePrice: null as number | null,
  taxRate: 19,
  colors: [] as ProductColor[],
  variants: [] as ProductVariant[],
  images: [] as ProductImage[],
}

export const useProductWizardStore = create<ProductWizardState>()((set, get) => ({
  ...initialState,

  setStep: (step) => set({ step }),

  setTranslation: (lang, data) => set((s) => ({
    translations: { ...s.translations, [lang]: { ...s.translations[lang], ...data } },
    // Auto-generate slug from DE name
    ...(lang === 'de' && data.name ? { slug: data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') } : {}),
  })),

  setCategoryId: (id) => set({ categoryId: id }),
  setSlug: (slug) => set({ slug }),
  setBasePrice: (price) => set({ basePrice: price }),
  setSalePrice: (price) => set({ salePrice: price }),

  addColor: (color) => set((s) => ({
    colors: [...s.colors, { ...color, id: `color-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }],
  })),

  removeColor: (id) => set((s) => ({
    colors: s.colors.filter((c) => c.id !== id),
    variants: s.variants.filter((v) => v.colorId !== id),
  })),

  updateColorSizes: (colorId, sizes) => set((s) => ({
    colors: s.colors.map((c) => c.id === colorId ? { ...c, sizes } : c),
  })),

  generateVariants: () => {
    const { colors, basePrice, slug } = get()
    const variants: ProductVariant[] = []
    for (const color of colors) {
      for (const size of color.sizes) {
        const existing = get().variants.find((v) => v.colorId === color.id && v.size === size)
        variants.push({
          colorId: color.id,
          colorName: color.name,
          colorHex: color.hex,
          size,
          sku: existing?.sku ?? `${slug ? slug.slice(0, 8).toUpperCase() : 'PROD'}-${color.name.slice(0, 3).toUpperCase()}-${size}`,
          price: existing?.price ?? basePrice,
          weight: existing?.weight ?? 500,
          stock: existing?.stock ?? {},
        })
      }
    }
    set({ variants })
  },

  updateVariant: (colorId, size, data) => set((s) => ({
    variants: s.variants.map((v) =>
      v.colorId === colorId && v.size === size ? { ...v, ...data } : v,
    ),
  })),

  bulkSetPrice: (price) => set((s) => ({
    variants: s.variants.map((v) => ({ ...v, price })),
  })),

  bulkSetStock: (warehouseId, qty) => set((s) => ({
    variants: s.variants.map((v) => ({ ...v, stock: { ...v.stock, [warehouseId]: qty } })),
  })),

  addImage: (image) => set((s) => ({
    images: [...s.images, { ...image, sortOrder: s.images.length, isPrimary: s.images.length === 0 }],
  })),

  removeImage: (id) => set((s) => {
    const filtered = s.images.filter((i) => i.id !== id)
    // If removed was primary, make first remaining primary
    if (filtered.length > 0 && !filtered.some((i) => i.isPrimary)) {
      filtered[0].isPrimary = true
    }
    return { images: filtered }
  }),

  setImagePrimary: (id) => set((s) => ({
    images: s.images.map((i) => ({ ...i, isPrimary: i.id === id })),
  })),

  setImageColor: (imageId, colorId) => set((s) => ({
    images: s.images.map((i) => i.id === imageId ? { ...i, colorId } : i),
  })),

  reorderImages: (fromIndex, toIndex) => set((s) => {
    const imgs = [...s.images]
    const [moved] = imgs.splice(fromIndex, 1)
    imgs.splice(toIndex, 0, moved)
    return { images: imgs.map((img, i) => ({ ...img, sortOrder: i })) }
  }),

  reset: () => set(initialState),
}))
