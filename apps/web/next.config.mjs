import createNextIntlPlugin from 'next-intl/plugin'
import { withSentryConfig } from '@sentry/nextjs'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// Next.js 14 only supports .js / .mjs / .cjs for the config file — .ts is
// not supported until Next.js 15. We stay on .mjs and rely on a JSDoc type
// annotation for editor hints. Since .mjs is excluded from the tsc
// `include` glob, the strict TypeScript check never runs here — Next.js
// validates the shape itself at startup.
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days CDN cache
    deviceSizes: [640, 750, 828, 1080, 1200, 1600, 1920],
    imageSizes: [32, 64, 96, 128, 256, 384],
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons', 'date-fns'],
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

// Wrap with Sentry AFTER next-intl. withSentryConfig adds webpack-plugin
// hooks for error-report routing + optional source-map upload.
//
// Graceful degradation:
//   - Without SENTRY_AUTH_TOKEN: source-maps are NOT uploaded (silent
//     no-op at build time). Sentry CLI is never invoked.
//   - Without NEXT_PUBLIC_SENTRY_DSN: the Sentry SDK itself never
//     initializes at runtime (see sentry.{client,server,edge}.config.ts).
//
// The shop builds + runs identically whether Sentry envs are set or not.
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Suppress Sentry-CLI logs unless we're actually uploading sourcemaps
  // (i.e. only in release builds with auth token).
  silent: !process.env.SENTRY_AUTH_TOKEN,
  disableLogger: true,

  // Skip source-map upload when no auth token — the critical
  // graceful-degradation switch for dev + CI without Sentry access.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },

  // We're not on Vercel.
  automaticVercelMonitors: false,

  // Opt-in; keep route table minimal.
  tunnelRoute: undefined,

  // Source-maps stay private via two existing switches:
  //   - productionBrowserSourceMaps: false (nextConfig, line ~26)
  //   - sourcemaps.disable when SENTRY_AUTH_TOKEN is absent (above)
  // The legacy top-level `hideSourceMaps` was removed from @sentry/nextjs
  // v10+, replaced by the `sourcemaps` block. Leaving it in would have been
  // silently ignored AND failed the strict TypeScript check.
})
