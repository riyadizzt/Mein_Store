import { adminCookieOptions, customerCookieOptions } from '../cookie-options'

describe('cookie-options', () => {
  describe('admin (legacy mode — CROSS_SITE_COOKIES unset)', () => {
    it('uses sameSite=strict, secure only in production, 8h maxAge', () => {
      const prod = adminCookieOptions({ NODE_ENV: 'production' })
      expect(prod.sameSite).toBe('strict')
      expect(prod.secure).toBe(true)
      expect(prod.httpOnly).toBe(true)
      expect(prod.maxAge).toBe(8 * 60 * 60 * 1000)
      expect(prod.path).toBe('/')

      const dev = adminCookieOptions({ NODE_ENV: 'development' })
      expect(dev.sameSite).toBe('strict')
      expect(dev.secure).toBe(false)
    })
  })

  describe('customer (legacy mode — CROSS_SITE_COOKIES unset)', () => {
    it('uses sameSite=lax, secure only in production, 30d maxAge', () => {
      const prod = customerCookieOptions({ NODE_ENV: 'production' })
      expect(prod.sameSite).toBe('lax')
      expect(prod.secure).toBe(true)
      expect(prod.httpOnly).toBe(true)
      expect(prod.maxAge).toBe(30 * 24 * 60 * 60 * 1000)
      expect(prod.path).toBe('/')

      const dev = customerCookieOptions({ NODE_ENV: 'development' })
      expect(dev.sameSite).toBe('lax')
      expect(dev.secure).toBe(false)
    })
  })

  describe('cross-site mode (CROSS_SITE_COOKIES=true)', () => {
    it('admin: sameSite=none, secure=true regardless of NODE_ENV', () => {
      const prod = adminCookieOptions({
        NODE_ENV: 'production',
        CROSS_SITE_COOKIES: 'true',
      })
      expect(prod.sameSite).toBe('none')
      expect(prod.secure).toBe(true)

      // Dev + cross-site: secure MUST remain true, browsers reject
      // sameSite=none without secure.
      const dev = adminCookieOptions({
        NODE_ENV: 'development',
        CROSS_SITE_COOKIES: 'true',
      })
      expect(dev.sameSite).toBe('none')
      expect(dev.secure).toBe(true)
    })

    it('customer: sameSite=none, secure=true regardless of NODE_ENV', () => {
      const prod = customerCookieOptions({
        NODE_ENV: 'production',
        CROSS_SITE_COOKIES: 'true',
      })
      expect(prod.sameSite).toBe('none')
      expect(prod.secure).toBe(true)

      const dev = customerCookieOptions({
        NODE_ENV: 'development',
        CROSS_SITE_COOKIES: 'true',
      })
      expect(dev.sameSite).toBe('none')
      expect(dev.secure).toBe(true)
    })

    it('ignores malformed flag values — only exact "true" activates', () => {
      // Defensive: any typo falls back to legacy behaviour. Ops must
      // set exactly 'true' to opt in.
      const typo = adminCookieOptions({
        NODE_ENV: 'production',
        CROSS_SITE_COOKIES: 'TRUE', // wrong case
      })
      expect(typo.sameSite).toBe('strict')

      const truthy = customerCookieOptions({
        NODE_ENV: 'production',
        CROSS_SITE_COOKIES: '1', // not the exact string
      })
      expect(truthy.sameSite).toBe('lax')
    })
  })
})
