import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { EmailService } from '../email.service'
import { EmailRateLimiter } from '../rate-limit/email-rate-limiter'

// ── Mocks ────────────────────────────────────────────────────

const mockEmailQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job1' }),
}

const mockRateLimiter = {
  check: jest.fn().mockResolvedValue(true),
}

const mockConfig = {
  get: jest.fn((key: string, fallback?: string) => {
    const map: Record<string, string> = {
      EMAIL_FROM_NOREPLY: 'noreply@malak-bekleidung.com',
      EMAIL_FROM_ORDERS: 'bestellungen@malak-bekleidung.com',
      EMAIL_FROM_SUPPORT: 'support@malak-bekleidung.com',
      EMAIL_DISPLAY_NAME: 'Malak Shop',
      APP_URL: 'https://malak-bekleidung.com',
      COMPANY_NAME: 'Malak Test GmbH',
      COMPANY_ADDRESS: 'Teststr. 1, 10115 Berlin',
      COMPANY_VAT_ID: 'DE123456789',
      COMPANY_CEO: 'Test CEO',
      COMPANY_REGISTER: 'AG Berlin HRB 12345',
      COMPANY_PHONE: '+49 30 12345678',
      COMPANY_CONTACT_EMAIL: 'info@malak-bekleidung.com',
      COMPANY_LOGO_URL: 'https://placehold.co/200x60',
    }
    return map[key] ?? fallback ?? ''
  }),
  getOrThrow: jest.fn((key: string): string => {
    if (key === 'RESEND_API_KEY') return 're_test123'
    const map: Record<string, string> = {
      UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'test-token',
    }
    return map[key] ?? ''
  }),
}

// ── Tests ────────────────────────────────────────────────────

describe('EmailService', () => {
  let service: EmailService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: 'EMAIL_QUEUE', useValue: mockEmailQueue },
        { provide: EmailRateLimiter, useValue: mockRateLimiter },
      ],
    }).compile()

    service = module.get<EmailService>(EmailService)
  })

  // ── Enqueue Tests ──────────────────────────────────────────

  describe('enqueue', () => {
    it('fügt Email-Job zur Queue hinzu', async () => {
      await service.enqueue({
        to: 'test@malak-bekleidung.com',
        type: 'welcome',
        lang: 'de',
        data: { firstName: 'Anna' },
      })

      expect(mockEmailQueue.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining({ to: 'test@malak-bekleidung.com', type: 'welcome' }),
        expect.objectContaining({ attempts: 3 }),
      )
    })
  })

  describe('queueWelcome', () => {
    it('enqueued Willkommens-E-Mail', async () => {
      await service.queueWelcome('anna@malak-bekleidung.com', 'de', 'Anna')

      expect(mockEmailQueue.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining({
          to: 'anna@malak-bekleidung.com',
          type: 'welcome',
          lang: 'de',
          data: expect.objectContaining({ firstName: 'Anna' }),
        }),
        expect.any(Object),
      )
    })
  })

  describe('queuePasswordReset', () => {
    it('enqueued Passwort-Reset wenn Rate Limit erlaubt', async () => {
      mockRateLimiter.check.mockResolvedValue(true)

      const result = await service.queuePasswordReset(
        'anna@malak-bekleidung.com', 'de', 'Anna', 'user1', 'token123',
      )

      expect(result).toBe(true)
      expect(mockRateLimiter.check).toHaveBeenCalledWith('pwd-reset:user1', 3, 3600)
      expect(mockEmailQueue.add).toHaveBeenCalled()
    })

    it('blockiert wenn Rate Limit überschritten', async () => {
      mockRateLimiter.check.mockResolvedValue(false)

      const result = await service.queuePasswordReset(
        'anna@malak-bekleidung.com', 'de', 'Anna', 'user1', 'token123',
      )

      expect(result).toBe(false)
      expect(mockEmailQueue.add).not.toHaveBeenCalled()
    })
  })

  describe('queueOrderConfirmation', () => {
    it('enqueued Bestellbestätigung', async () => {
      await service.queueOrderConfirmation('anna@malak-bekleidung.com', 'de', {
        firstName: 'Anna',
        orderNumber: 'ORD-20260326-000001',
        items: [],
      })

      expect(mockEmailQueue.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining({
          type: 'order-confirmation',
          data: expect.objectContaining({ orderNumber: 'ORD-20260326-000001' }),
        }),
        expect.any(Object),
      )
    })
  })

  // ── Template Rendering ────────────────────────────────────

  describe('renderEmail', () => {
    it('rendert DE Welcome-Template mit Layout', () => {
      const { html, subject, from } = service.renderEmail('welcome', 'de', {
        firstName: 'Anna',
        loginUrl: 'https://malak-bekleidung.com/login',
      })

      expect(html).toContain('Willkommen bei Malak')
      expect(html).toContain('Anna')
      expect(html).toContain('Malak Test GmbH') // footer
      expect(html).toContain('DE123456789') // VAT ID in footer
      expect(subject).toBe('Willkommen bei Malak!')
      expect(from).toBe('Malak Shop <noreply@malak-bekleidung.com>')
    })

    it('rendert EN Welcome-Template', () => {
      const { html, subject } = service.renderEmail('welcome', 'en', {
        firstName: 'John',
        loginUrl: 'https://malak-bekleidung.com/login',
      })

      expect(html).toContain('Welcome to Malak')
      expect(html).toContain('John')
      expect(subject).toBe('Welcome to Malak!')
    })

    it('fällt auf DE zurück wenn Sprache nicht existiert', () => {
      const { html } = service.renderEmail('welcome', 'ar', {
        firstName: 'أحمد',
        loginUrl: 'https://malak-bekleidung.com/login',
      })

      // AR template doesn't exist → falls back to DE
      expect(html).toContain('Willkommen bei Malak')
    })

    it('rendert Order-Confirmation mit Artikeln', () => {
      const { html, subject, from } = service.renderEmail('order-confirmation', 'de', {
        firstName: 'Anna',
        orderNumber: 'ORD-20260326-000001',
        orderDate: '26.03.2026',
        items: [
          { name: 'Testjacke', sku: 'TEST-BLK-M', color: 'Schwarz', size: 'M', quantity: 2, unitPrice: '99.99', totalPrice: '199.98' },
        ],
        subtotal: '199.98',
        shippingCost: '8.00',
        taxAmount: '31.92',
        total: '239.90',
        currency: 'EUR',
        shippingAddress: {
          firstName: 'Anna', lastName: 'Müller',
          street: 'Hauptstraße', houseNumber: '1',
          postalCode: '10115', city: 'Berlin', country: 'DE',
        },
      })

      expect(html).toContain('Bestellbestätigung')
      expect(html).toContain('ORD-20260326-000001')
      expect(html).toContain('Testjacke')
      expect(html).toContain('199.98')
      expect(html).toContain('Widerrufsrecht')
      expect(subject).toContain('ORD-20260326-000001')
      expect(from).toBe('Malak Shop <bestellungen@malak-bekleidung.com>')
    })

    it('rendert Password-Reset Template', () => {
      const { html, from } = service.renderEmail('password-reset', 'de', {
        firstName: 'Anna',
        resetUrl: 'https://malak-bekleidung.com/reset?token=abc',
        expiresIn: '15 Minuten',
      })

      expect(html).toContain('Passwort zurücksetzen')
      expect(html).toContain('15 Minuten')
      expect(from).toContain('noreply@malak-bekleidung.com')
    })

    it('rendert Order-Status Template mit Tracking', () => {
      const { html } = service.renderEmail('order-status', 'de', {
        firstName: 'Anna',
        orderNumber: 'ORD-001',
        statusLabel: 'Versendet',
        trackingNumber: 'DHL-123456',
        trackingUrl: 'https://dhl.de/track/DHL-123456',
      })

      expect(html).toContain('Versendet')
      expect(html).toContain('DHL-123456')
      expect(html).toContain('Sendung verfolgen')
    })
  })
})
