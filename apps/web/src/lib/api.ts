import { useAuthStore } from '@/store/auth-store'
import { API_BASE_URL } from '@/lib/env'

const API_URL = API_BASE_URL
const BASE = `${API_URL}/api/v1`

export { API_BASE_URL }

// Shared refresh promise — all concurrent 401s wait on the same refresh
// call instead of racing or skipping. Keyed by token type so admin and
// customer refreshes don't collide.
let refreshPromise: Record<string, Promise<boolean>> = {}

function isAdminPath(path: string): boolean {
  return path.includes('/admin/') || (typeof window !== 'undefined' && window.location.pathname.includes('/admin'))
}

function getHeaders(path: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const store = useAuthStore.getState()
  const token = isAdminPath(path) ? store.adminAccessToken : store.accessToken
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function doRefresh(admin: boolean): Promise<boolean> {
  try {
    const refreshRes = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenType: admin ? 'admin' : 'customer' }),
    })
    if (refreshRes.ok) {
      const data = await refreshRes.json()
      const newToken = data?.data?.accessToken
      if (newToken) {
        if (admin) useAuthStore.getState().setAdminAccessToken(newToken)
        else useAuthStore.getState().setAccessToken(newToken)
        return true
      }
    }
  } catch { /* network error — treat as refresh failed */ }
  return false
}

async function handleResponse(res: Response, path: string, skipAuthRetry = false) {
  if (res.status === 401 && !skipAuthRetry && typeof window !== 'undefined') {
    const admin = isAdminPath(path)
    const key = admin ? 'admin' : 'customer'

    // If a refresh is already in progress for this token type, wait on
    // the same promise. Otherwise start one. This prevents the thundering
    // herd: 5 simultaneous 401s all wait on 1 refresh, then all retry.
    if (!refreshPromise[key]) {
      refreshPromise[key] = doRefresh(admin).finally(() => { delete refreshPromise[key] })
    }
    const ok = await refreshPromise[key]

    if (ok) return null // signal retry — the caller re-fires the request

    // Refresh failed — session is truly dead
    if (admin) useAuthStore.getState().adminLogout()
    else useAuthStore.getState().logout()
    return { _authFailed: true }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const error: any = new Error(body.message ?? `HTTP ${res.status}`)
    error.response = { status: res.status, data: body }
    throw error
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return {}
  return res.json().catch(() => ({}))
}

async function request(method: string, path: string, body?: any, opts?: { headers?: Record<string, string> }) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const isAuthEndpoint = path.includes('/auth/login') || path.includes('/auth/register') || path.includes('/auth/refresh')
  const res = await fetch(url, {
    method,
    headers: { ...getHeaders(path), ...opts?.headers },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  })
  const data = await handleResponse(res, path, isAuthEndpoint)
  if (data === null) {
    // Retry after token refresh
    const retryRes = await fetch(url, {
      method,
      headers: { ...getHeaders(path), ...opts?.headers },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    })
    return handleResponse(retryRes, path)
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
