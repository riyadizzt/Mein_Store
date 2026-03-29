import { useAuthStore } from '@/store/auth-store'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
const BASE = `${API_URL}/api/v1`

let isRefreshing = false

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // Read access token from Zustand store (memory only)
  const token = useAuthStore.getState().accessToken
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function handleResponse(res: Response) {
  if (res.status === 401 && !isRefreshing && typeof window !== 'undefined') {
    isRefreshing = true
    try {
      // Refresh via HttpOnly cookie (no token in body needed)
      const refreshRes = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (refreshRes.ok) {
        const data = await refreshRes.json()
        const newToken = data?.data?.accessToken
        if (newToken) {
          useAuthStore.getState().setAccessToken(newToken)
          isRefreshing = false
          return null // signal retry
        }
      }
    } catch { /* ignore */ }
    isRefreshing = false
    useAuthStore.getState().logout()
    return { _authFailed: true }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const error: any = new Error(body.message ?? `HTTP ${res.status}`)
    error.response = { status: res.status, data: body }
    throw error
  }
  // 204 No Content — no body to parse (DELETE endpoints)
  if (res.status === 204 || res.headers.get('content-length') === '0') return {}
  return res.json().catch(() => ({}))
}

async function request(method: string, path: string, body?: any, opts?: { headers?: Record<string, string> }) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const res = await fetch(url, {
    method,
    headers: { ...getHeaders(), ...opts?.headers },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include', // always send cookies
  })
  const data = await handleResponse(res)
  if (data === null) {
    // Retry after token refresh
    const retryRes = await fetch(url, {
      method,
      headers: { ...getHeaders(), ...opts?.headers },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    })
    return handleResponse(retryRes)
  }
  if (data?._authFailed) {
    throw new Error('Unauthorized')
  }
  return data
}

export const api = {
  get: (path: string, opts?: { params?: Record<string, any>; headers?: Record<string, string> }) => {
    let url = path
    if (opts?.params) {
      const params = new URLSearchParams()
      Object.entries(opts.params).forEach(([k, v]) => { if (v !== undefined && v !== null) params.set(k, String(v)) })
      const qs = params.toString()
      if (qs) url += `?${qs}`
    }
    return request('GET', url, undefined, opts).then((data) => ({ data }))
  },
  post: (path: string, body?: any, opts?: { headers?: Record<string, string> }) =>
    request('POST', path, body, opts).then((data) => ({ data })),
  patch: (path: string, body?: any, opts?: { headers?: Record<string, string> }) =>
    request('PATCH', path, body, opts).then((data) => ({ data })),
  put: (path: string, body?: any, opts?: { headers?: Record<string, string> }) =>
    request('PUT', path, body, opts).then((data) => ({ data })),
  delete: (path: string, opts?: { data?: any; headers?: Record<string, string> }) =>
    request('DELETE', path, opts?.data, opts).then((data) => ({ data })),
}
