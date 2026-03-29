/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.SITE_URL || 'https://malak-bekleidung.com',
  generateRobotsTxt: true,
  exclude: [
    '/*/account*',
    '/*/checkout*',
    '/*/admin*',
    '/*/auth*',
    '/*/track*',
  ],
  alternateRefs: [
    { href: 'https://malak-bekleidung.com/de', hreflang: 'de' },
    { href: 'https://malak-bekleidung.com/en', hreflang: 'en' },
    { href: 'https://malak-bekleidung.com/ar', hreflang: 'ar' },
  ],
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: ['/', '/de/', '/en/', '/ar/', '/de/products', '/en/products', '/ar/products'],
        disallow: ['/account', '/checkout', '/admin', '/api', '/auth', '/track'],
      },
    ],
  },
}
