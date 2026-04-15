import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

export default createMiddleware(routing)

export const config = {
  // Alle Pfade matchen außer API, _next und statische Dateien.
  // favicon.svg + icon.png müssen explizit raus, sonst hängt next-intl
  // die Locale davor (`/ar/favicon.svg` → 404).
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|favicon.svg|icon|apple-icon|robots.txt|sitemap.xml).*)'],
}
