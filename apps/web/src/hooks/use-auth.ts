import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'

interface LoginInput { email: string; password: string }
interface RegisterInput { firstName: string; lastName: string; email: string; password: string; gdprConsent: boolean }

export function useLogin() {
  const setUser = useAuthStore((s) => s.setUser)
  const setAccessToken = useAuthStore((s) => s.setAccessToken)

  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const { data } = await api.post('/auth/login', input)
      const result = data?.data ?? data
      // Access token goes to memory, refresh token is in HttpOnly cookie
      setAccessToken(result.accessToken)
      return result
    },
    onSuccess: async () => {
      const { data } = await api.get('/auth/me')
      setUser(data?.data ?? data)
    },
  })
}

export function useRegister() {
  const setAccessToken = useAuthStore((s) => s.setAccessToken)

  return useMutation({
    mutationFn: async (input: RegisterInput) => {
      const { data } = await api.post('/auth/register', input)
      const result = data?.data ?? data
      setAccessToken(result.accessToken)
      return result
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
