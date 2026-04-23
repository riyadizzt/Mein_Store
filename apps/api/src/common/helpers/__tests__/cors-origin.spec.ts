import { buildCorsAllowlist, makeCorsOriginFn } from '../cors-origin'

describe('cors-origin', () => {
  // Small helper: invoke the origin function and return the resolved decision.
  function decide(
    fn: ReturnType<typeof makeCorsOriginFn>,
    origin: string | undefined,
  ): { allowed: boolean; error?: string } {
    let decision: { allowed: boolean; error?: string } = { allowed: false }
    fn(origin, (err, allow) => {
      if (err) decision = { allowed: false, error: err.message }
      else decision = { allowed: !!allow }
    })
    return decision
  }

  describe('buildCorsAllowlist', () => {
    it('falls back to localhost:3000 when nothing configured', () => {
      const { exact, regexes } = buildCorsAllowlist({})
      expect(exact.has('http://localhost:3000')).toBe(true)
      expect(exact.size).toBe(1)
      expect(regexes).toHaveLength(0)
    })

    it('de-duplicates when CORS_ALLOWED_ORIGINS repeats NEXT_PUBLIC_APP_URL', () => {
      const { exact } = buildCorsAllowlist({
        NEXT_PUBLIC_APP_URL: 'https://malak.de',
        CORS_ALLOWED_ORIGINS: 'https://malak.de,https://staging.malak.de',
      })
      expect(exact.size).toBe(2)
      expect(exact.has('https://malak.de')).toBe(true)
      expect(exact.has('https://staging.malak.de')).toBe(true)
    })

    it('enables Vercel preview regex only when flag=true', () => {
      const off = buildCorsAllowlist({ NEXT_PUBLIC_APP_URL: 'https://x.com' })
      expect(off.regexes).toHaveLength(0)

      const on = buildCorsAllowlist({
        NEXT_PUBLIC_APP_URL: 'https://x.com',
        CORS_ALLOW_VERCEL_PREVIEWS: 'true',
      })
      expect(on.regexes).toHaveLength(1)
    })
  })

  describe('makeCorsOriginFn', () => {
    const baseEnv = {
      NEXT_PUBLIC_APP_URL: 'https://malak-bekleidung.vercel.app',
      CORS_ALLOWED_ORIGINS: 'https://malak-bekleidung.de',
      CORS_ALLOW_VERCEL_PREVIEWS: 'true',
    }

    it('allows no-origin (webhook/curl/server-to-server)', () => {
      const fn = makeCorsOriginFn(baseEnv)
      expect(decide(fn, undefined).allowed).toBe(true)
    })

    it('allows NEXT_PUBLIC_APP_URL exactly', () => {
      const fn = makeCorsOriginFn(baseEnv)
      expect(decide(fn, 'https://malak-bekleidung.vercel.app').allowed).toBe(true)
    })

    it('allows CORS_ALLOWED_ORIGINS entries', () => {
      const fn = makeCorsOriginFn(baseEnv)
      expect(decide(fn, 'https://malak-bekleidung.de').allowed).toBe(true)
    })

    it('allows a legit Vercel preview URL when flag enabled', () => {
      const fn = makeCorsOriginFn(baseEnv)
      expect(
        decide(fn, 'https://malak-bekleidung-git-feature-xyz-malakteam.vercel.app').allowed,
      ).toBe(true)
    })

    it('rejects a Vercel preview URL when flag disabled', () => {
      const fn = makeCorsOriginFn({ ...baseEnv, CORS_ALLOW_VERCEL_PREVIEWS: undefined })
      const d = decide(fn, 'https://malak-bekleidung-git-feature-xyz-team.vercel.app')
      expect(d.allowed).toBe(false)
      expect(d.error).toContain('Origin not allowed by CORS')
    })

    it('rejects a subdomain-spoof that appends .vercel.app suffix', () => {
      const fn = makeCorsOriginFn(baseEnv)
      // The $ anchor in the regex must prevent a match when the origin
      // continues past .vercel.app — the attacker-controlled domain.
      const d = decide(fn, 'https://malak-bekleidung-git-x-y.vercel.app.attacker.com')
      expect(d.allowed).toBe(false)
    })

    it('rejects http (non-https) preview URLs even when flag enabled', () => {
      const fn = makeCorsOriginFn(baseEnv)
      const d = decide(fn, 'http://malak-bekleidung-git-x-y.vercel.app')
      expect(d.allowed).toBe(false)
    })

    it('rejects unknown origins', () => {
      const fn = makeCorsOriginFn(baseEnv)
      expect(decide(fn, 'https://evil.com').allowed).toBe(false)
    })
  })
})
