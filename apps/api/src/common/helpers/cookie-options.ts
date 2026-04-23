/**
 * Cookie options — admin vs customer refresh tokens.
 *
 * Two operating modes:
 *   LEGACY (default):  admin=strict, customer=lax, secure-if-prod.
 *   CROSS-SITE:        admin=none,   customer=none, secure ALWAYS.
 *
 * Cross-site mode is REQUIRED when the frontend and backend live on
 * different eTLD+1 domains (e.g. malak-bekleidung.vercel.app ↔
 * malak-bekleidung.up.railway.app). Without it, browsers refuse to
 * send the HttpOnly refresh cookie on cross-origin fetch(), which
 * breaks the /auth/refresh flow every 15 min.
 *
 * Set CROSS_SITE_COOKIES=true in the backend env after Vercel deploy.
 */

import type { CookieOptions } from 'express'

const ADMIN_MAX_AGE = 8 * 60 * 60 * 1000 // 8 hours (admin security)
const CUSTOMER_MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days (customer convenience)

export function adminCookieOptions(
  env: NodeJS.ProcessEnv = process.env,
): CookieOptions {
  const crossSite = env.CROSS_SITE_COOKIES === 'true'
  return {
    httpOnly: true,
    // 'none' REQUIRES secure=true — enforced by all modern browsers.
    // In legacy mode we keep the existing prod-only secure flag.
    secure: crossSite ? true : env.NODE_ENV === 'production',
    sameSite: crossSite ? 'none' : 'strict',
    maxAge: ADMIN_MAX_AGE,
    path: '/',
  }
}

export function customerCookieOptions(
  env: NodeJS.ProcessEnv = process.env,
): CookieOptions {
  const crossSite = env.CROSS_SITE_COOKIES === 'true'
  return {
    httpOnly: true,
    secure: crossSite ? true : env.NODE_ENV === 'production',
    sameSite: crossSite ? 'none' : 'lax',
    maxAge: CUSTOMER_MAX_AGE,
    path: '/',
  }
}
