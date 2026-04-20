import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CartItem {
  variantId: string
  productId: string
  slug?: string
  name: string
  names?: Record<string, string> // {de: 'Jacke', en: 'Jacket', ar: 'جاكيت'}
  sku: string
  color?: string
  colors?: Record<string, string> // {de: 'Schwarz', en: 'Black', ar: 'أسود'}
  size?: string
  imageUrl?: string
  unitPrice: number
  quantity: number
}

interface CartState {
  items: CartItem[]
  isDrawerOpen: boolean
  openDrawer: () => void
  closeDrawer: () => void
  addItem: (item: CartItem) => void
  removeItem: (variantId: string) => void
  updateQuantity: (variantId: string, quantity: number) => void
  clearCart: () => void
  itemCount: () => number
  subtotal: () => number
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isDrawerOpen: false,

      openDrawer: () => set({ isDrawerOpen: true }),
      closeDrawer: () => set({ isDrawerOpen: false }),

      addItem: (item) =>
        set((state) => {
          // Defense-in-depth: reject zero/negative-qty adds. The reorder
          // path upstream already filters cancelled (qty=0) items, but
          // any future caller that forgets this guard should not be able
          // to pollute the cart with ghost lines (ORD-20260420-000001
          // regression: 12 cancelled items slipped through as qty=0).
          if (item.quantity <= 0) return state
          const existing = state.items.find((i) => i.variantId === item.variantId)
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.variantId === item.variantId
                  ? { ...i, quantity: i.quantity + item.quantity }
                  : i,
              ),
              isDrawerOpen: true,
            }
          }
          return { items: [...state.items, item], isDrawerOpen: true }
        }),

      removeItem: (variantId) =>
        set((state) => ({
          items: state.items.filter((i) => i.variantId !== variantId),
        })),

      updateQuantity: (variantId, quantity) =>
        set((state) => ({
          items:
            quantity <= 0
              ? state.items.filter((i) => i.variantId !== variantId)
              : state.items.map((i) =>
                  i.variantId === variantId ? { ...i, quantity } : i,
                ),
        })),

      clearCart: () => set({ items: [] }),

      itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),

      subtotal: () =>
        get().items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
    }),
    {
      name: 'malak-cart',
      // Rehydrate-time cleanup for ghost items written before the
      // reorder / addItem guards shipped. Any customer whose cart
      // sessionStorage still carries qty=0 entries gets them silently
      // dropped on the next page load. No-op for healthy carts.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const clean = state.items.filter((i) => i.quantity > 0)
        if (clean.length !== state.items.length) {
          state.items = clean
        }
      },
    },
  ),
)
