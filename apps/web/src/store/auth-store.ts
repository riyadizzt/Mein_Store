import { create } from 'zustand'

interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  preferredLang: string
  profileImageUrl?: string
  isVerified?: boolean
  staffRole?: string
  permissions?: string[]
}

interface AuthState {
  // Customer session
  user: User | null
  accessToken: string | null
  isAuthenticated: boolean
  setUser: (user: User | null) => void
  setAccessToken: (token: string | null) => void
  logout: () => void

  // Admin session (separate)
  adminUser: User | null
  adminAccessToken: string | null
  isAdminAuthenticated: boolean
  setAdminUser: (user: User | null) => void
  setAdminAccessToken: (token: string | null) => void
  adminLogout: () => void
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export const useAuthStore = create<AuthState>()((set) => ({
  // ── Customer ──
  user: null,
  accessToken: null,
  isAuthenticated: false,

  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setAccessToken: (token) => set({ accessToken: token }),

  logout: () => {
    fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenType: 'customer' }),
    }).catch(() => {})
    set({ user: null, accessToken: null, isAuthenticated: false })
  },

  // ── Admin ──
  adminUser: null,
  adminAccessToken: null,
  isAdminAuthenticated: false,

  setAdminUser: (user) => set({ adminUser: user, isAdminAuthenticated: !!user }),
  setAdminAccessToken: (token) => set({ adminAccessToken: token }),

  adminLogout: () => {
    fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenType: 'admin' }),
    }).catch(() => {})
    set({ adminUser: null, adminAccessToken: null, isAdminAuthenticated: false })
  },
}))
