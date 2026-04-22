/**
 * C10 — EbayAuthService tests.
 *
 * Covers Meta-Verify targets:
 *   MV-1  OAuth callback with missing/invalid state → BadRequestException
 *         with 3-lang message (tested at controller layer; here we
 *         cover the service-level "missing code" branch for symmetry)
 *   MV-2  Token refresh with 401/invalid_grant → flips isActive=false,
 *         clears access token, surfaces EbayRefreshRevokedError
 *
 * FakeFetch + in-memory prisma-mock. No NestJS DI, no DB.
 */

import {
  EbayAuthService,
  EbayNotConnectedError,
  EbayRefreshRevokedError,
  EBAY_OAUTH_SCOPES,
} from '../ebay-auth.service'
import type { FetchLike } from '../ebay-api.client'
import { __resetMasterKeyCache } from '../../../../common/helpers/channel-token-encryption'

// The envelope-encryption helper caches the master key at module
// level. Each test sets/clears CHANNEL_TOKEN_MASTER_KEY — without
// a cache-reset, a later test keeps the earlier key alive and
// bypasses our "no key" probes.
beforeEach(() => {
  __resetMasterKeyCache()
})

// ──────────────────────────────────────────────────────────────
// Minimal prisma mock exposing only what EbayAuthService uses
// ──────────────────────────────────────────────────────────────

interface FakeRow {
  channel: 'ebay'
  isActive: boolean
  accessToken: string | null
  refreshToken: string | null
  tokenExpiresAt: Date | null
  refreshTokenExpiresAt: Date | null
  externalId: string | null
  settings: any
}

function mkPrisma(initial?: Partial<FakeRow>) {
  let row: FakeRow | null = initial
    ? {
        channel: 'ebay',
        isActive: true,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        externalId: null,
        settings: null,
        ...initial,
      }
    : null

  return {
    _row: () => row,
    salesChannelConfig: {
      findUnique: async () => row,
      upsert: async ({ create, update }: any) => {
        if (row) row = { ...row, ...update }
        else row = { channel: 'ebay', isActive: true, settings: null, externalId: null, ...create }
        return row
      },
      update: async ({ data }: any) => {
        if (!row) throw new Error('no row')
        row = { ...row, ...data }
        return row
      },
      updateMany: async ({ data }: any) => {
        if (row) row = { ...row, ...data }
        return { count: row ? 1 : 0 }
      },
    },
  }
}

async function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T> | T): Promise<T> {
  const saved = { ...process.env }
  Object.assign(process.env, env)
  try {
    return await fn()
  } finally {
    for (const k of Object.keys(env)) delete process.env[k]
    Object.assign(process.env, saved)
  }
}

const EBAY_ENV_VARS = {
  EBAY_ENV: 'sandbox',
  EBAY_SANDBOX_APP_ID: 'app',
  EBAY_SANDBOX_DEV_ID: 'dev',
  EBAY_SANDBOX_CERT_ID: 'cert',
  EBAY_SANDBOX_RUNAME: 'RUNAME',
  CHANNEL_TOKEN_MASTER_KEY: Buffer.from('01234567890123456789012345678901', 'utf8').toString('base64'),
}

describe('buildAuthorizeUrl', () => {
  it('includes every required OAuth scope and the RuName', () => {
    withEnv(EBAY_ENV_VARS, () => {
      const svc = new EbayAuthService(mkPrisma() as any)
      const url = svc.buildAuthorizeUrl('STATE123')
      expect(url).toContain('auth.sandbox.ebay.com')
      expect(url).toContain('client_id=app')
      // redirect_uri carries the RuName, NOT an actual URL
      expect(url).toContain('redirect_uri=RUNAME')
      expect(url).toContain('state=STATE123')
      for (const scope of EBAY_OAUTH_SCOPES) {
        expect(url).toContain(encodeURIComponent(scope))
      }
    })
  })
})

describe('handleCallback', () => {
  it('rejects when authorization code is empty', async () => {
    await withEnv(EBAY_ENV_VARS, async () => {
      const svc = new EbayAuthService(mkPrisma() as any)
      await expect(svc.handleCallback('', 'state')).rejects.toMatchObject({
        response: {
          code: 'EBAY_OAUTH_MISSING_CODE',
        },
      })
    })
  })

  it('rejects when state token is empty', async () => {
    await withEnv(EBAY_ENV_VARS, async () => {
      const svc = new EbayAuthService(mkPrisma() as any)
      await expect(svc.handleCallback('code', '')).rejects.toMatchObject({
        response: {
          code: 'EBAY_OAUTH_STATE_MISMATCH',
        },
      })
    })
  })

  it('exchanges code and persists encrypted tokens on success', async () => {
    await withEnv(EBAY_ENV_VARS, async () => {
      const prisma = mkPrisma()
      const svc = new EbayAuthService(prisma as any)
      const fakeFetch: FetchLike = async () => ({
        status: 200,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            access_token: 'live-access-token',
            token_type: 'User Access Token',
            expires_in: 7200,
            refresh_token: 'live-refresh-token',
            refresh_token_expires_in: 47304000, // 18 months
          }),
        json: async () => ({}),
      })
      svc.__setFetchForTests(fakeFetch)

      const result = await svc.handleCallback('auth-code', 'state')
      expect(result.accessToken).toBe('live-access-token')
      expect(result.tokenExpiresAt).toBeInstanceOf(Date)

      const row = prisma._row()
      expect(row).not.toBeNull()
      expect(row!.isActive).toBe(true)
      // Envelope-encrypted — NOT equal to plaintext
      expect(row!.accessToken).not.toBe('live-access-token')
      expect(row!.refreshToken).not.toBe('live-refresh-token')
      // Envelope format starts with 'v1:'
      expect(row!.accessToken!.startsWith('v1:')).toBe(true)
      expect(row!.refreshToken!.startsWith('v1:')).toBe(true)
    })
  })
})

describe('getAccessTokenOrRefresh — MV-2 refresh-revoke branch', () => {
  it('returns cached token while still well-within validity', async () => {
    await withEnv(EBAY_ENV_VARS, async () => {
      // Prepare a row with a plaintext-encrypted token
      const { encryptChannelToken } = require('../../../../common/helpers/channel-token-encryption')
      const prisma = mkPrisma({
        isActive: true,
        accessToken: encryptChannelToken('still-fresh'),
        refreshToken: encryptChannelToken('refresh-1'),
        tokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min ahead
        refreshTokenExpiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      })
      const svc = new EbayAuthService(prisma as any)
      // No fetch — no refresh call expected
      const token = await svc.getAccessTokenOrRefresh()
      expect(token).toBe('still-fresh')
    })
  })

  it('refreshes transparently when inside the 2-minute safety window', async () => {
    await withEnv(EBAY_ENV_VARS, async () => {
      const { encryptChannelToken } = require('../../../../common/helpers/channel-token-encryption')
      const prisma = mkPrisma({
        isActive: true,
        accessToken: encryptChannelToken('expiring-soon'),
        refreshToken: encryptChannelToken('refresh-1'),
        tokenExpiresAt: new Date(Date.now() + 30_000), // 30s away
        refreshTokenExpiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      })
      const svc = new EbayAuthService(prisma as any)
      const fakeFetch: FetchLike = async () => ({
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ access_token: 'fresh-token', token_type: 'X', expires_in: 7200 }),
        json: async () => ({}),
      })
      svc.__setFetchForTests(fakeFetch)

      const token = await svc.getAccessTokenOrRefresh()
      expect(token).toBe('fresh-token')
    })
  })

  it('MV-2: 401 from eBay → marks inactive AND throws EbayRefreshRevokedError', async () => {
    await withEnv(EBAY_ENV_VARS, async () => {
      const { encryptChannelToken } = require('../../../../common/helpers/channel-token-encryption')
      const prisma = mkPrisma({
        isActive: true,
        accessToken: encryptChannelToken('expiring-soon'),
        refreshToken: encryptChannelToken('refresh-that-is-revoked'),
        tokenExpiresAt: new Date(Date.now() + 30_000),
        refreshTokenExpiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      })
      const svc = new EbayAuthService(prisma as any)
      const fakeFetch: FetchLike = async () => ({
        status: 401,
        headers: { get: () => null },
        text: async () => JSON.stringify({ errors: [{ errorId: 1, message: 'invalid_grant' }] }),
        json: async () => ({}),
      })
      svc.__setFetchForTests(fakeFetch)

      await expect(svc.getAccessTokenOrRefresh()).rejects.toBeInstanceOf(EbayRefreshRevokedError)

      // Side-effect: row flipped inactive, access token cleared
      const row = prisma._row()
      expect(row!.isActive).toBe(false)
      expect(row!.accessToken).toBeNull()
    })
  })

  it('raises EbayNotConnectedError when no row exists yet', async () => {
    await withEnv(EBAY_ENV_VARS, async () => {
      const prisma = mkPrisma() // null row
      const svc = new EbayAuthService(prisma as any)
      await expect(svc.getAccessTokenOrRefresh()).rejects.toBeInstanceOf(EbayNotConnectedError)
    })
  })

  it('raises EbayNotConnectedError when row has no refresh token', async () => {
    await withEnv(EBAY_ENV_VARS, async () => {
      const { encryptChannelToken } = require('../../../../common/helpers/channel-token-encryption')
      const prisma = mkPrisma({
        isActive: true,
        accessToken: encryptChannelToken('any'),
        refreshToken: null,
        tokenExpiresAt: new Date(Date.now() + 30_000),
      })
      const svc = new EbayAuthService(prisma as any)
      await expect(svc.getAccessTokenOrRefresh()).rejects.toBeInstanceOf(EbayNotConnectedError)
    })
  })
})

describe('getStatus — admin UI probe', () => {
  it('reports masterKeyMissing=true when env lacks the key', async () => {
    // Intentionally DO NOT set CHANNEL_TOKEN_MASTER_KEY. We also
    // have to remove it from process.env (which may already have
    // it loaded from apps/api/.env) before running the probe.
    const env = { ...EBAY_ENV_VARS } as any
    delete env.CHANNEL_TOKEN_MASTER_KEY
    const savedKey = process.env.CHANNEL_TOKEN_MASTER_KEY
    delete process.env.CHANNEL_TOKEN_MASTER_KEY
    try {
      await withEnv(env, async () => {
        __resetMasterKeyCache()
        const prisma = mkPrisma()
        const svc = new EbayAuthService(prisma as any)
        const status = await svc.getStatus()
        expect(status.masterKeyMissing).toBe(true)
        expect(status.connected).toBe(false)
      })
    } finally {
      if (savedKey !== undefined) process.env.CHANNEL_TOKEN_MASTER_KEY = savedKey
    }
  })

  it('reports missingEnvVars when EBAY_SANDBOX_* are blank', async () => {
    const env = {
      EBAY_ENV: 'sandbox',
      CHANNEL_TOKEN_MASTER_KEY: EBAY_ENV_VARS.CHANNEL_TOKEN_MASTER_KEY,
    }
    await withEnv(env, async () => {
      const prisma = mkPrisma()
      const svc = new EbayAuthService(prisma as any)
      const status = await svc.getStatus()
      expect(status.missingEnvVars.length).toBeGreaterThan(0)
    })
  })
})

describe('disconnect', () => {
  it('clears all token fields + flips isActive=false', async () => {
    await withEnv(EBAY_ENV_VARS, async () => {
      const { encryptChannelToken } = require('../../../../common/helpers/channel-token-encryption')
      const prisma = mkPrisma({
        isActive: true,
        accessToken: encryptChannelToken('a'),
        refreshToken: encryptChannelToken('r'),
        tokenExpiresAt: new Date(),
        refreshTokenExpiresAt: new Date(),
      })
      const svc = new EbayAuthService(prisma as any)
      await svc.disconnect()
      const row = prisma._row()
      expect(row!.isActive).toBe(false)
      expect(row!.accessToken).toBeNull()
      expect(row!.refreshToken).toBeNull()
    })
  })

  it('is a no-op when no row exists', async () => {
    await withEnv(EBAY_ENV_VARS, async () => {
      const prisma = mkPrisma() // null
      const svc = new EbayAuthService(prisma as any)
      await expect(svc.disconnect()).resolves.toBeUndefined()
    })
  })
})
