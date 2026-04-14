// Centralized environment configuration.
// Keeps the localhost fallback in ONE place so production deployments can't silently
// fall back to localhost when NEXT_PUBLIC_API_URL is missing.

const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL

if (!RAW_API_URL && typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
  // Hard warning in production — the app will fall back to localhost otherwise
  // which yields cryptic CORS errors instead of a clear signal.
  // eslint-disable-next-line no-console
  console.error(
    '[env] NEXT_PUBLIC_API_URL is not set. Falling back to http://localhost:3001 — ' +
      'this will NOT work in production. Set NEXT_PUBLIC_API_URL in your environment.',
  )
}

export const API_BASE_URL = RAW_API_URL || 'http://localhost:3001'
