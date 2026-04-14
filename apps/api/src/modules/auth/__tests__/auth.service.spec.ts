/**
 * AuthService unit tests.
 *
 * Covers the security-critical paths:
 *   - register: bcrypt hashing, GDPR consent guard, duplicate email
 *   - login: success, wrong password (counter increments), account lock at 5 attempts,
 *            locked account rejection, deactivated account rejection,
 *            password validation timing (always equal-time error message)
 *   - refresh tokens: valid, expired, revoked + grace period
 */

import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { AuthService } from '../auth.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { EmailService } from '../../email/email.service'

function buildPrisma() {
  const mock: any = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
    gdprConsent: { create: jest.fn() },
  }
  mock.$transaction = jest.fn().mockImplementation((arg: any) =>
    typeof arg === 'function' ? arg(mock) : Promise.all(arg),
  )
  return mock
}

const mockJwt = {
  sign: jest.fn().mockReturnValue('signed.jwt.token'),
  verify: jest.fn(),
}

const mockEmailService = {
  queueEmailVerification: jest.fn().mockResolvedValue(undefined),
  queuePasswordReset: jest.fn().mockResolvedValue(true),
  queueAdminAlert: jest.fn().mockResolvedValue(undefined),
}

const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      JWT_REFRESH_EXPIRES_IN: '30d',
      FRONTEND_URL: 'http://localhost:3000',
    }
    return map[key]
  }),
}

async function makeService(prisma: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: PrismaService, useValue: prisma },
      { provide: JwtService, useValue: mockJwt },
      { provide: EmailService, useValue: mockEmailService },
      { provide: ConfigService, useValue: mockConfig },
    ],
  }).compile()
  return module.get<AuthService>(AuthService)
}

const baseUser = {
  id: 'user1',
  email: 'anna@malak-bekleidung.com',
  passwordHash: '', // will be set per test
  firstName: 'Anna',
  lastName: 'Müller',
  role: 'customer',
  preferredLang: 'de',
  isActive: true,
  loginAttempts: 0,
  lockedUntil: null as Date | null,
  deletedAt: null,
}

describe('AuthService', () => {
  let prisma: any

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = buildPrisma()
  })

  // ── register ───────────────────────────────────────────────

  describe('register', () => {
    it('hasht das Passwort mit bcrypt (cost ≥10)', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.user.create.mockImplementation(async ({ data }: any) => ({
        ...baseUser,
        passwordHash: data.passwordHash,
      }))
      prisma.user.update.mockResolvedValue(undefined)

      const service = await makeService(prisma)
      await service.register({
        email: 'neu@malak.com',
        password: 'SicheresPasswort123',
        firstName: 'Test',
        lastName: 'User',
        gdprConsent: true,
      } as any)

      const created = prisma.user.create.mock.calls[0][0].data
      expect(created.passwordHash).toMatch(/^\$2[aby]\$/) // bcrypt prefix
      // bcrypt cost factor 12
      expect(created.passwordHash).toMatch(/^\$2[aby]\$12\$/)
    })

    it('wirft BadRequestException wenn GDPR Consent fehlt', async () => {
      const service = await makeService(prisma)
      await expect(
        service.register({
          email: 'x@y.com',
          password: 'pwd123456',
          firstName: 'X',
          lastName: 'Y',
          gdprConsent: false,
        } as any),
      ).rejects.toThrow(BadRequestException)
    })

    it('wirft ConflictException bei doppelter E-Mail', async () => {
      prisma.user.findUnique.mockResolvedValue(baseUser)
      const service = await makeService(prisma)
      await expect(
        service.register({
          email: baseUser.email,
          password: 'pwd123456',
          firstName: 'A',
          lastName: 'M',
          gdprConsent: true,
        } as any),
      ).rejects.toThrow(ConflictException)
    })

    it('normalisiert E-Mail zu lowercase', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.user.create.mockImplementation(async ({ data }: any) => ({ ...baseUser, ...data }))
      prisma.user.update.mockResolvedValue(undefined)

      const service = await makeService(prisma)
      await service.register({
        email: 'MiXeD@CASE.com',
        password: 'pwd123456',
        firstName: 'A',
        lastName: 'B',
        gdprConsent: true,
      } as any)

      expect(prisma.user.create.mock.calls[0][0].data.email).toBe('mixed@case.com')
    })
  })

  // ── login ──────────────────────────────────────────────────

  describe('login', () => {
    it('akzeptiert korrektes Passwort und resettet loginAttempts', async () => {
      const hash = await bcrypt.hash('correctPassword', 12)
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, passwordHash: hash, loginAttempts: 2 })
      prisma.user.update.mockResolvedValue(undefined)
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt1' })

      const service = await makeService(prisma)
      const result = await service.login(
        { email: baseUser.email, password: 'correctPassword' } as any,
        '127.0.0.1',
        'jest',
      )

      expect(result.accessToken).toBeDefined()
      // loginAttempts wurde auf 0 zurückgesetzt
      const updateCall = prisma.user.update.mock.calls.find((c: any) =>
        c[0]?.data?.loginAttempts === 0,
      )
      expect(updateCall).toBeDefined()
    })

    it('wirft UnauthorizedException bei nicht existierender E-Mail', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      const service = await makeService(prisma)
      await expect(
        service.login({ email: 'ghost@x.com', password: 'pwd' } as any, 'ip', 'ua'),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('wirft UnauthorizedException bei falschem Passwort und erhöht loginAttempts', async () => {
      const hash = await bcrypt.hash('correct', 12)
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, passwordHash: hash, loginAttempts: 1 })
      prisma.user.update.mockResolvedValue(undefined)

      const service = await makeService(prisma)
      await expect(
        service.login({ email: baseUser.email, password: 'wrong' } as any, 'ip', 'ua'),
      ).rejects.toThrow(UnauthorizedException)

      // Counter wurde erhöht
      const incrementCall = prisma.user.update.mock.calls.find(
        (c: any) => c[0]?.data?.loginAttempts === 2,
      )
      expect(incrementCall).toBeDefined()
    })

    it('sperrt Account nach 5 fehlgeschlagenen Versuchen (ForbiddenException)', async () => {
      const hash = await bcrypt.hash('correct', 12)
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash: hash,
        loginAttempts: 4, // next failure → 5 → lock
      })
      prisma.user.update.mockResolvedValue(undefined)

      const service = await makeService(prisma)
      await expect(
        service.login({ email: baseUser.email, password: 'wrong' } as any, 'ip', 'ua'),
      ).rejects.toThrow(ForbiddenException)

      // lockedUntil wurde gesetzt
      const lockCall = prisma.user.update.mock.calls.find(
        (c: any) => c[0]?.data?.lockedUntil instanceof Date,
      )
      expect(lockCall).toBeDefined()
    })

    it('wirft ForbiddenException wenn Konto bereits gesperrt ist', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000)
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash: 'irrelevant',
        lockedUntil: future,
      })
      const service = await makeService(prisma)
      await expect(
        service.login({ email: baseUser.email, password: 'whatever' } as any, 'ip', 'ua'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('wirft ForbiddenException wenn Konto deaktiviert ist (isActive=false)', async () => {
      const hash = await bcrypt.hash('correct', 12)
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash: hash,
        isActive: false,
      })
      prisma.user.update.mockResolvedValue(undefined)

      const service = await makeService(prisma)
      await expect(
        service.login({ email: baseUser.email, password: 'correct' } as any, 'ip', 'ua'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('gleiche Fehlermeldung für falsches PW und nicht-existente E-Mail (no user enumeration)', async () => {
      // 1) E-Mail existiert nicht
      prisma.user.findUnique.mockResolvedValue(null)
      const service = await makeService(prisma)
      let errA: any
      try {
        await service.login({ email: 'ghost@x.com', password: 'p' } as any, 'ip', 'ua')
      } catch (e) {
        errA = e
      }

      // 2) E-Mail existiert, Passwort falsch
      const hash = await bcrypt.hash('correct', 12)
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, passwordHash: hash })
      prisma.user.update.mockResolvedValue(undefined)
      let errB: any
      try {
        await service.login({ email: baseUser.email, password: 'wrong' } as any, 'ip', 'ua')
      } catch (e) {
        errB = e
      }

      // Beide werfen UnauthorizedException mit der gleichen Message
      expect(errA).toBeInstanceOf(UnauthorizedException)
      expect(errB).toBeInstanceOf(UnauthorizedException)
      expect(errA.message).toBe(errB.message)
    })
  })

  // ── bcrypt sanity ──────────────────────────────────────────

  describe('bcrypt password verification', () => {
    it('verifiziert korrektes Passwort gegen Hash', async () => {
      const hash = await bcrypt.hash('mein-passwort', 12)
      const ok = await bcrypt.compare('mein-passwort', hash)
      expect(ok).toBe(true)
    })

    it('lehnt falsches Passwort ab', async () => {
      const hash = await bcrypt.hash('mein-passwort', 12)
      const ok = await bcrypt.compare('falsch', hash)
      expect(ok).toBe(false)
    })

    it('produziert unterschiedliche Hashes für gleiches Passwort (Salt)', async () => {
      const h1 = await bcrypt.hash('p', 12)
      const h2 = await bcrypt.hash('p', 12)
      expect(h1).not.toBe(h2)
      expect(await bcrypt.compare('p', h1)).toBe(true)
      expect(await bcrypt.compare('p', h2)).toBe(true)
    })
  })

  // ── refreshTokens ──────────────────────────────────────────

  describe('refreshTokens', () => {
    it('wirft UnauthorizedException bei unbekanntem Token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null)
      const service = await makeService(prisma)
      await expect(service.refreshTokens('unknown')).rejects.toThrow(UnauthorizedException)
    })

    it('wirft UnauthorizedException bei abgelaufenem Token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        expiresAt: new Date(Date.now() - 1000),
        isRevoked: false,
        user: { ...baseUser },
      })
      const service = await makeService(prisma)
      await expect(service.refreshTokens('expired')).rejects.toThrow(UnauthorizedException)
    })

    it('wirft UnauthorizedException bei längst widerrufenem Token (außerhalb Grace Period)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        expiresAt: new Date(Date.now() + 86400000),
        isRevoked: true,
        lastUsedAt: new Date(Date.now() - 60000), // 60s ago > 15s grace
        createdAt: new Date(),
        user: { ...baseUser },
      })
      const service = await makeService(prisma)
      await expect(service.refreshTokens('revoked')).rejects.toThrow(UnauthorizedException)
    })

    it('akzeptiert kürzlich widerrufenen Token innerhalb der Grace Period', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        expiresAt: new Date(Date.now() + 86400000),
        isRevoked: true,
        lastUsedAt: new Date(Date.now() - 5000), // 5s ago < 15s grace
        createdAt: new Date(),
        user: { ...baseUser },
      })
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-new' })
      prisma.user.update.mockResolvedValue(undefined)

      const service = await makeService(prisma)
      const result = await service.refreshTokens('grace-period')
      expect(result.accessToken).toBeDefined()
    })

    it('rotiert valide Tokens — alter Token wird widerrufen', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        expiresAt: new Date(Date.now() + 86400000),
        isRevoked: false,
        user: { ...baseUser },
      })
      prisma.refreshToken.update.mockResolvedValue(undefined)
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-new' })
      prisma.user.update.mockResolvedValue(undefined)

      const service = await makeService(prisma)
      await service.refreshTokens('valid-token')

      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isRevoked: true }),
        }),
      )
    })
  })
})
