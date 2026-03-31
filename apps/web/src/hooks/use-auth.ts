import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'

interface LoginInput { email: string; password: string }
interface RegisterInput { firstName: string; lastName: string; email: string; password: string; gdprConsent: boolean }

// ── Customer Login (always sets customer cookie) ────────────
export function useLogin() {
  const setUser = useAuthStore((s) => s.setUser)
  const setAccessToken = useAuthStore((s) => s.setAccessToken)

  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const { data } = await api.post('/auth/login', { ...input, loginContext: 'shop' })
      const result = data?.data ?? data
      setAccessToken(result.accessToken)
      return result
    },
    onSuccess: async () => {
      const { data } = await api.get('/auth/me')
      setUser(data?.data ?? data)
    },
  })
}

// ── Admin Login (always sets admin cookie) ───────────────────
export function useAdminLogin() {
  const setAdminUser = useAuthStore((s) => s.setAdminUser)
  const setAdminAccessToken = useAuthStore((s) => s.setAdminAccessToken)

  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const { data } = await api.post('/auth/login', { ...input, loginContext: 'admin' })
      const result = data?.data ?? data
      // Check role — only admins can use admin login
      if (!result.role || !['admin', 'super_admin', 'warehouse_staff'].includes(result.role)) {
        throw { response: { status: 403, data: { message: 'NOT_ADMIN' } } }
      }
      setAdminAccessToken(result.accessToken)
      return result
    },
    onSuccess: async () => {
      try {
        const store = useAuthStore.getState()
        const { data } = await api.get('/auth/me', {
          headers: { Authorization: `Bearer ${store.adminAccessToken}` },
        })
        const user = data?.data ?? data
        setAdminUser(user)
      } catch (err) {
        console.error('Failed to load admin profile:', err)
      }
    },
  })
}

// ── Customer Register ───────────────────────────────────────
export function useRegister() {
  const setUser = useAuthStore((s) => s.setUser)
  const setAccessToken = useAuthStore((s) => s.setAccessToken)

  return useMutation({
    mutationFn: async (input: RegisterInput) => {
      const { data } = await api.post('/auth/register', input)
      const result = data?.data ?? data
      setAccessToken(result.accessToken)
      return result
    },
    onSuccess: async () => {
      const { data } = await api.get('/auth/me')
      setUser(data?.data ?? data)
    },
  })
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (email: string) => {
      await api.post('/auth/forgot-password', { email })
    },
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async ({ token, password }: { token: string; password: string }) => {
      await api.post('/auth/reset-password', { token, password })
    },
  })
}
