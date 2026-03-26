import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['de', 'en', 'ar'],
  defaultLocale: 'de',
  localePrefix: 'always',
})
