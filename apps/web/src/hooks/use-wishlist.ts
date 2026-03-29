import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'

export function useWishlist() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const queryClient = useQueryClient()

  const { data: wishlistItems } = useQuery({
    queryKey: ['my-wishlist'],
    queryFn: async () => {
      const { data } = await api.get('/users/me/wishlist')
      const items = Array.isArray(data) ? data : data?.data ?? data?.items ?? []
      return items as Array<{ productId: string }>
    },
    enabled: isAuthenticated,
    staleTime: 60000,
  })

  const isInWishlist = (productId: string) => {
    return wishlistItems?.some((item) => item.productId === productId) ?? false
  }

  const toggleMutation = useMutation({
    mutationFn: async (productId: string) => {
      const inList = isInWishlist(productId)
      if (inList) {
        await api.delete(`/users/me/wishlist/${productId}`)
      } else {
        await api.post(`/users/me/wishlist/${productId}`)
      }
      return !inList // new state
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-wishlist'] })
    },
  })

  return { isInWishlist, toggle: toggleMutation.mutate, isPending: toggleMutation.isPending, isAuthenticated }
}
