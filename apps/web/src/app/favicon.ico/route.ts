import { NextResponse, type NextRequest } from 'next/server'

// Browsers auto-request /favicon.ico at the site root. We don't ship a
// real .ico file (the app uses favicon.svg + the generated icon.tsx PNG),
// so redirect here instead of serving a 404 in the console.
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/favicon.svg', request.url), 308)
}
