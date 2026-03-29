import { useEffect, useState } from 'react'

const STORAGE_KEY = 'malak-recently-viewed'
const MAX_ITEMS = 10

interface RecentProduct {
  id: string
  slug: string
  name: string
  price: number
  imageUrl?: string
}

export function useRecentlyViewed() {
  const [items, setItems] = useState<RecentProduct[]>([])

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try { setItems(JSON.parse(stored)) } catch { /* ignore */ }
    }
  }, [])

  const addItem = (product: RecentProduct) => {
    const updated = [product, ...items.filter((p) => p.id !== product.id)].slice(0, MAX_ITEMS)
    setItems(updated)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  }

  return { items, addItem }
}
