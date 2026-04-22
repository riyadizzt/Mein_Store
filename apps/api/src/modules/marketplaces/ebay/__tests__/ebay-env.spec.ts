/**
 * C10 — ebay-env resolver tests.
 *
 * Verifies the lazy-probe behaviour: resolving succeeds with all
 * vars set, throws with listed missing ones, and surfaces mode
 * deterministically. No DI, no DB.
 */

import {
  resolveEbayEnv,
  resolveEbayMode,
  probeEbayEnv,
  EbayEnvConfigError,
  __resolveEbayEnvForTest,
} from '../ebay-env'

describe('resolveEbayMode', () => {
  const saved = process.env.EBAY_ENV

  afterEach(() => {
    if (saved === undefined) delete process.env.EBAY_ENV
    else process.env.EBAY_ENV = saved
  })

  it('returns sandbox when EBAY_ENV is missing', () => {
    delete process.env.EBAY_ENV
    expect(resolveEbayMode()).toBe('sandbox')
  })

  it('returns sandbox when EBAY_ENV is empty', () => {
    process.env.EBAY_ENV = ''
    expect(resolveEbayMode()).toBe('sandbox')
  })

  it('returns sandbox when EBAY_ENV is garbage', () => {
    process.env.EBAY_ENV = 'qa-staging-foo'
    expect(resolveEbayMode()).toBe('sandbox')
  })

  it('returns production only for the literal "production"', () => {
    process.env.EBAY_ENV = 'production'
    expect(resolveEbayMode()).toBe('production')
  })

  it('tolerates trailing whitespace and case variation', () => {
    process.env.EBAY_ENV = '  PRODUCTION  '
    expect(resolveEbayMode()).toBe('production')
  })
})

describe('resolveEbayEnv — sandbox happy path', () => {
  it('returns full env when all SANDBOX_* vars are set', () => {
    const env = __resolveEbayEnvForTest({
      EBAY_ENV: 'sandbox',
      EBAY_SANDBOX_APP_ID: 'app',
      EBAY_SANDBOX_DEV_ID: 'dev',
      EBAY_SANDBOX_CERT_ID: 'cert',
      EBAY_SANDBOX_RUNAME: 'run',
    })
    expect(env.mode).toBe('sandbox')
    expect(env.appId).toBe('app')
    expect(env.apiBaseUrl).toBe('https://api.sandbox.ebay.com')
    expect(env.oauthTokenUrl).toContain('sandbox.ebay.com')
    expect(env.marketplaceId).toBe('EBAY_DE')
  })

  it('returns production urls when EBAY_ENV=production and prod vars set', () => {
    const env = __resolveEbayEnvForTest({
      EBAY_ENV: 'production',
      EBAY_PRODUCTION_APP_ID: 'pa',
      EBAY_PRODUCTION_DEV_ID: 'pd',
      EBAY_PRODUCTION_CERT_ID: 'pc',
      EBAY_PRODUCTION_RUNAME: 'pr',
    })
    expect(env.mode).toBe('production')
    expect(env.apiBaseUrl).toBe('https://api.ebay.com')
    expect(env.oauthTokenUrl).not.toContain('sandbox')
  })
})

describe('resolveEbayEnv — failure modes', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Hard-reset all EBAY_* so one test's env cannot leak to the next.
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('EBAY_')) delete process.env[k]
    }
  })

  afterAll(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('EBAY_')) delete process.env[k]
    }
    Object.assign(process.env, originalEnv)
  })

  it('throws EbayEnvConfigError with all missing vars listed', () => {
    process.env.EBAY_ENV = 'sandbox'
    // None of the SANDBOX_* set
    expect(() => resolveEbayEnv()).toThrow(EbayEnvConfigError)
    try {
      resolveEbayEnv()
    } catch (e: any) {
      expect(e.message3).toBeDefined()
      expect(e.message3.de).toContain('unvollständig')
      expect(e.message).toMatch(/EBAY_SANDBOX_APP_ID/)
      expect(e.message).toMatch(/EBAY_SANDBOX_RUNAME/)
    }
  })

  it('throws when production is requested but prod vars blank', () => {
    process.env.EBAY_ENV = 'production'
    expect(() => resolveEbayEnv()).toThrow(EbayEnvConfigError)
  })

  it('rejects placeholder strings like replace-with-*', () => {
    process.env.EBAY_ENV = 'sandbox'
    process.env.EBAY_SANDBOX_APP_ID = 'replace-with-sandbox-app-id'
    process.env.EBAY_SANDBOX_DEV_ID = 'dev'
    process.env.EBAY_SANDBOX_CERT_ID = 'cert'
    process.env.EBAY_SANDBOX_RUNAME = 'run'
    expect(() => resolveEbayEnv()).toThrow(EbayEnvConfigError)
  })
})

describe('probeEbayEnv', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('EBAY_')) delete process.env[k]
    }
  })

  afterAll(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('EBAY_')) delete process.env[k]
    }
    Object.assign(process.env, originalEnv)
  })

  it('returns empty missing array when everything is configured', () => {
    process.env.EBAY_ENV = 'sandbox'
    process.env.EBAY_SANDBOX_APP_ID = 'app'
    process.env.EBAY_SANDBOX_DEV_ID = 'dev'
    process.env.EBAY_SANDBOX_CERT_ID = 'cert'
    process.env.EBAY_SANDBOX_RUNAME = 'run'
    const result = probeEbayEnv()
    expect(result.missing).toEqual([])
    expect(result.mode).toBe('sandbox')
  })

  it('returns non-empty missing list when vars are blank', () => {
    process.env.EBAY_ENV = 'sandbox'
    const result = probeEbayEnv()
    expect(result.missing.length).toBeGreaterThan(0)
    expect(result.mode).toBe('sandbox')
    // Specific entries format e.g. EBAY_SANDBOX_APP_ID
    expect(result.missing.some((v) => v.includes('APP_ID'))).toBe(true)
  })
})
