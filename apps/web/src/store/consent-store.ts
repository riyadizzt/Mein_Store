import { create } from 'zustand'

export interface ConsentState {
  /** null = not yet decided, user must see banner */
  essential: boolean
  analytics: boolean
  marketing: boolean
  decided: boolean
}

interface ConsentStore extends ConsentState {
  acceptAll: () => void
  acceptEssentialOnly: () => void
  saveCustom: (analytics: boolean, marketing: boolean) => void
  reset: () => void
  /** Open the settings modal */
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
}

const STORAGE_KEY = 'malak-cookie-consent'

function loadFromStorage(): ConsentState {
  if (typeof window === 'undefined') return { essential: true, analytics: false, marketing: false, decided: false }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { essential: true, analytics: false, marketing: false, decided: false }
    const parsed = JSON.parse(raw)
    return {
      essential: true,
      analytics: !!parsed.analytics,
      marketing: !!parsed.marketing,
      decided: true,
    }
  } catch {
    return { essential: true, analytics: false, marketing: false, decided: false }
  }
}

function persist(state: ConsentState) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    essential: true,
    analytics: state.analytics,
    marketing: state.marketing,
    date: new Date().toISOString(),
  }))
}

export const useConsentStore = create<ConsentStore>((set) => ({
  ...loadFromStorage(),
  settingsOpen: false,

  acceptAll: () => {
    const state = { essential: true, analytics: true, marketing: true, decided: true }
    persist(state)
    set(state)
  },

  acceptEssentialOnly: () => {
    const state = { essential: true, analytics: false, marketing: false, decided: true }
    persist(state)
    set(state)
  },

  saveCustom: (analytics, marketing) => {
    const state = { essential: true, analytics, marketing, decided: true }
    persist(state)
    set(state)
  },

  reset: () => {
    if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY)
    set({ essential: true, analytics: false, marketing: false, decided: false, settingsOpen: false })
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}))

/** Hydrate from localStorage on client — call once on mount */
export function hydrateConsent() {
  if (typeof window === 'undefined') return
  const stored = loadFromStorage()
  if (stored.decided) {
    useConsentStore.setState(stored)
  }
}

/** Check if a specific consent category is granted */
export function hasConsent(category: 'analytics' | 'marketing'): boolean {
  return useConsentStore.getState()[category]
}
