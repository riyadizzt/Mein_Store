import { Test, TestingModule } from '@nestjs/testing'
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcrypt'
import { ProfileService } from '../profile.service'
import { AddressService } from '../address.service'
import { WishlistService } from '../wishlist.service'
import { SessionService } from '../session.service'
import { GdprService } from '../gdpr.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { StorageService } from '../../../common/services/storage.service'
import { EmailService } from '../../email/email.service'
import { AddressNotFoundException } from '../exceptions/address-not-found.exception'
import { AddressLimitException } from '../exceptions/address-limit.exception'
import { InvalidPasswordException } from '../exceptions/invalid-password.exception'
import { UserNotFoundException } from '../exceptions/user-not-found.exception'

const mockStorage = { uploadAvatar: jest.fn().mockResolvedValue('https://cdn.example/avatar.webp') }
const mockEmailService = { enqueue: jest.fn().mockResolvedValue(undefined) }
const mockConfig = { get: jest.fn().mockReturnValue('http://localhost:3000') }

// ── Mock Factories ────────────────────────────────────────────

const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  address: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  order: { findFirst: jest.fn() },
  refreshToken: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  wishlistItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  },
  product: { findFirst: jest.fn() },
  gdprConsent: { findMany: jest.fn(), create: jest.fn() },
  dataExportRequest: { findFirst: jest.fn(), create: jest.fn() },
  emailChangeRequest: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  $transaction: jest.fn().mockImplementation((fnOrArray: any) =>
    typeof fnOrArray === 'function' ? fnOrArray(mockPrisma) : Promise.all(fnOrArray),
  ),
}

const mockGdprQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job1' }),
  getJob: jest.fn().mockResolvedValue(null),
}

// ── Helpers ───────────────────────────────────────────────────

const makeUser = (overrides = {}) => ({
  id: 'user1',
  email: 'test@malak-bekleidung.com',
  firstName: 'Anna',
  lastName: 'Müller',
  phone: null,
  preferredLang: 'de',
  role: 'customer',
  profileImageUrl: null,
  isVerified: true,
  twoFactorEnabled: false,
  lastLoginAt: null,
  scheduledDeletionAt: null,
  anonymizedAt: null,
  isActive: true,
  deletedAt: null,
  createdAt: new Date(),
  ...overrides,
})

const makeAddress = (overrides = {}) => ({
  id: 'addr1',
  userId: 'user1',
  firstName: 'Anna',
  lastName: 'Müller',
  street: 'Hauptstraße',
  houseNumber: '1',
  city: 'Berlin',
  postalCode: '10115',
  country: 'DE',
  isDefaultShipping: false,
  isDefaultBilling: false,
  deletedAt: null,
  ...overrides,
})

// ── Test Suite ────────────────────────────────────────────────

describe('Users — ProfileService', () => {
  let profileService: ProfileService

  beforeEach(async () => {
    jest.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fnOrArray: any) =>
      typeof fnOrArray === 'function' ? fnOrArray(mockPrisma) : Promise.all(fnOrArray),
    )

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile()

    profileService = module.get<ProfileService>(ProfileService)
  })

  describe('findMe', () => {
    it('gibt Benutzerprofil zurück', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeUser())
      const result = await profileService.findMe('user1')
      expect(result.id).toBe('user1')
    })

    it('wirft UserNotFoundException wenn nicht gefunden', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      await expect(profileService.findMe('ghost')).rejects.toThrow(UserNotFoundException)
    })
  })

  describe('changePassword', () => {
    it('ändert Passwort und widerruft alle Sessions', async () => {
      const passwordHash = await bcrypt.hash('OldPassword123!', 12)
      mockPrisma.user.findFirst.mockResolvedValue(makeUser({ passwordHash }))
      mockPrisma.user.update.mockResolvedValue({})
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 })

      await profileService.changePassword('user1', {
        currentPassword: 'OldPassword123!',
        newPassword: 'NewPassword456!',
      })

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isRevoked: true } }),
      )
    })

    it('wirft InvalidPasswordException bei falschem Passwort', async () => {
      const passwordHash = await bcrypt.hash('CorrectPassword', 12)
      mockPrisma.user.findFirst.mockResolvedValue(makeUser({ passwordHash }))

      await expect(
        profileService.changePassword('user1', {
          currentPassword: 'WrongPassword',
          newPassword: 'NewPass123!',
        }),
      ).rejects.toThrow(InvalidPasswordException)
    })
  })

  describe('requestEmailChange', () => {
    it('wirft ConflictException wenn E-Mail bereits vergeben', async () => {
      const passwordHash = await bcrypt.hash('Pass123!', 12)
      mockPrisma.user.findFirst.mockResolvedValue(makeUser({ passwordHash }))
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'otherUser' })

      await expect(
        profileService.requestEmailChange('user1', {
          newEmail: 'taken@malak-bekleidung.com',
          currentPassword: 'Pass123!',
        }),
      ).rejects.toThrow(ConflictException)
    })

    it('erstellt EmailChangeRequest bei gültigem Request', async () => {
      const passwordHash = await bcrypt.hash('Pass123!', 12)
      mockPrisma.user.findFirst.mockResolvedValue(makeUser({ passwordHash }))
      mockPrisma.user.findUnique.mockResolvedValue(null)
      mockPrisma.emailChangeRequest.create.mockResolvedValue({ id: 'ecr1' })

      await profileService.requestEmailChange('user1', {
        newEmail: 'new@malak-bekleidung.com',
        currentPassword: 'Pass123!',
      })

      expect(mockPrisma.emailChangeRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ newEmail: 'new@malak-bekleidung.com', userId: 'user1' }),
        }),
      )
    })
  })
})

// ── AddressService ────────────────────────────────────────────

describe('Users — AddressService', () => {
  let addressService: AddressService

  beforeEach(async () => {
    jest.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((fnOrArray: any) =>
      typeof fnOrArray === 'function' ? fnOrArray(mockPrisma) : Promise.all(fnOrArray),
    )

    const module: TestingModule = await Test.createTestingModule({
      providers: [AddressService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile()

    addressService = module.get<AddressService>(AddressService)
  })

  describe('create', () => {
    it('wirft AddressLimitException wenn 10 Adressen vorhanden', async () => {
      mockPrisma.address.count.mockResolvedValue(10)
      await expect(
        addressService.create('user1', {
          firstName: 'Anna',
          lastName: 'Müller',
          street: 'Hauptstraße',
          houseNumber: '1',
          city: 'Berlin',
          postalCode: '10115',
          country: 'DE',
        }),
      ).rejects.toThrow(AddressLimitException)
    })

    it('wirft BadRequestException bei ungültiger PLZ', async () => {
      mockPrisma.address.count.mockResolvedValue(0)
      await expect(
        addressService.create('user1', {
          firstName: 'Anna',
          lastName: 'Müller',
          street: 'Hauptstraße',
          houseNumber: '1',
          city: 'Berlin',
          postalCode: 'WRONG',
          country: 'DE',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('erstellt Adresse und setzt isDefaultShipping korrekt', async () => {
      mockPrisma.address.count.mockResolvedValue(0)
      mockPrisma.address.updateMany.mockResolvedValue({ count: 1 })
      mockPrisma.address.create.mockResolvedValue(makeAddress({ isDefaultShipping: true }))

      const result = await addressService.create('user1', {
        firstName: 'Anna',
        lastName: 'Müller',
        street: 'Hauptstraße',
        houseNumber: '1',
        city: 'Berlin',
        postalCode: '10115',
        country: 'DE',
        isDefaultShipping: true,
      })

      // Existing defaults cleared first
      expect(mockPrisma.address.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isDefaultShipping: false } }),
      )
      expect(result.isDefaultShipping).toBe(true)
    })
  })

  describe('softDelete', () => {
    it('soft-deleted Adresse auch wenn aktive Bestellung existiert (Order hat Adress-Snapshot)', async () => {
      mockPrisma.address.findFirst.mockResolvedValue(makeAddress())
      mockPrisma.order.findFirst.mockResolvedValue({ id: 'order1', status: 'confirmed' })
      mockPrisma.address.update.mockResolvedValue({})

      await expect(addressService.softDelete('user1', 'addr1')).resolves.toBeUndefined()
      expect(mockPrisma.address.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      )
    })

    it('soft-deleted Adresse wenn keine aktive Bestellung', async () => {
      mockPrisma.address.findFirst.mockResolvedValue(makeAddress())
      mockPrisma.order.findFirst.mockResolvedValue(null)
      mockPrisma.address.update.mockResolvedValue({})

      await addressService.softDelete('user1', 'addr1')

      expect(mockPrisma.address.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      )
    })

    it('wirft AddressNotFoundException bei fremder Adresse', async () => {
      mockPrisma.address.findFirst.mockResolvedValue(null)
      await expect(addressService.softDelete('user1', 'foreign-addr')).rejects.toThrow(
        AddressNotFoundException,
      )
    })
  })
})

// ── WishlistService ───────────────────────────────────────────

describe('Users — WishlistService', () => {
  let wishlistService: WishlistService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [WishlistService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile()

    wishlistService = module.get<WishlistService>(WishlistService)
  })

  it('fügt Produkt zur Wunschliste hinzu', async () => {
    mockPrisma.product.findFirst.mockResolvedValue({ id: 'prod1' })
    mockPrisma.wishlistItem.create.mockResolvedValue({ id: 'wi1', userId: 'user1', productId: 'prod1' })

    const result = await wishlistService.add('user1', 'prod1')
    expect(result.productId).toBe('prod1')
  })

  it('wirft ConflictException bei doppeltem Eintrag', async () => {
    mockPrisma.product.findFirst.mockResolvedValue({ id: 'prod1' })
    mockPrisma.wishlistItem.create.mockRejectedValue(new Error('Unique constraint'))

    await expect(wishlistService.add('user1', 'prod1')).rejects.toThrow(ConflictException)
  })

  it('wirft NotFoundException wenn Produkt nicht existiert', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(null)
    await expect(wishlistService.add('user1', 'ghost-prod')).rejects.toThrow(NotFoundException)
  })

  it('entfernt Produkt von Wunschliste', async () => {
    mockPrisma.wishlistItem.findFirst.mockResolvedValue({ id: 'wi1' })
    mockPrisma.wishlistItem.delete.mockResolvedValue({})

    await wishlistService.remove('user1', 'prod1')
    expect(mockPrisma.wishlistItem.delete).toHaveBeenCalledWith({ where: { id: 'wi1' } })
  })
})

// ── SessionService ────────────────────────────────────────────

describe('Users — SessionService', () => {
  let sessionService: SessionService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [SessionService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile()

    sessionService = module.get<SessionService>(SessionService)
  })

  it('listet aktive Sessions auf', async () => {
    mockPrisma.refreshToken.findMany.mockResolvedValue([
      { id: 's1', deviceName: 'Chrome/Mac', ipAddress: '127.0.0.1' },
    ])

    const sessions = await sessionService.listSessions('user1')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].deviceName).toBe('Chrome/Mac')
  })

  it('widerruft einzelne Session', async () => {
    mockPrisma.refreshToken.findFirst.mockResolvedValue({ id: 's1', userId: 'user1' })
    mockPrisma.refreshToken.update.mockResolvedValue({})

    await sessionService.revokeSession('user1', 's1')
    expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isRevoked: true } }),
    )
  })

  it('widerruft alle Sessions', async () => {
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 })
    const count = await sessionService.revokeAllSessions('user1')
    expect(count).toBe(3)
  })
})

// ── GdprService ───────────────────────────────────────────────

describe('Users — GdprService', () => {
  let gdprService: GdprService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GdprService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: 'GDPR_QUEUE', useValue: mockGdprQueue },
      ],
    }).compile()

    gdprService = module.get<GdprService>(GdprService)
  })

  describe('scheduleAccountDeletion', () => {
    it('plant Kontolöschung und enqueued BullMQ Job', async () => {
      const passwordHash = await bcrypt.hash('Pass123!', 12)
      mockPrisma.user.findFirst.mockResolvedValue(makeUser({ passwordHash }))
      mockPrisma.user.update.mockResolvedValue({})

      const result = await gdprService.scheduleAccountDeletion('user1', 'Pass123!')
      expect(result.scheduledAt).toBeInstanceOf(Date)
      expect(mockGdprQueue.add).toHaveBeenCalledWith(
        'anonymize-user',
        { userId: 'user1' },
        expect.objectContaining({ delay: expect.any(Number) }),
      )
    })

    it('wirft BadRequestException wenn Löschung bereits geplant', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(
        makeUser({ scheduledDeletionAt: new Date(Date.now() + 86400000) }),
      )
      await expect(gdprService.scheduleAccountDeletion('user1', 'Pass123!')).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('anonymizeUser', () => {
    it('anonymisiert Benutzerdaten korrekt', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeUser())
      mockPrisma.user.update.mockResolvedValue({})
      mockPrisma.address.updateMany.mockResolvedValue({ count: 1 })
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 })

      await gdprService.anonymizeUser('user1')

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: expect.stringContaining('anonymized-user1@deleted.malak-bekleidung.com'),
            anonymizedAt: expect.any(Date),
          }),
        }),
      )
    })

    it('überspringt bereits anonymisierte Benutzer', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      await gdprService.anonymizeUser('ghost')
      expect(mockPrisma.user.update).not.toHaveBeenCalled()
    })
  })

  describe('requestDataExport', () => {
    it('wirft BadRequestException wenn Export bereits läuft', async () => {
      mockPrisma.dataExportRequest.findFirst.mockResolvedValue({ id: 'exp1', status: 'pending' })
      await expect(gdprService.requestDataExport('user1')).rejects.toThrow(BadRequestException)
    })

    it('enqueued Datenexport-Job', async () => {
      mockPrisma.dataExportRequest.findFirst.mockResolvedValue(null)
      mockPrisma.dataExportRequest.create.mockResolvedValue({ id: 'exp1' })

      const result = await gdprService.requestDataExport('user1')
      expect(result.requestId).toBe('exp1')
      expect(mockGdprQueue.add).toHaveBeenCalledWith('data-export', {
        userId: 'user1',
        requestId: 'exp1',
      })
    })
  })
})
