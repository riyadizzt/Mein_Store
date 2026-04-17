import { WebhookService } from '../webhook.service'
import { WEBHOOK_EVENT_TYPES } from '../events'

// Minimal prisma mock — only the methods WebhookService calls.
function mkPrisma() {
  const subs: any[] = []
  const logs: any[] = []
  return {
    __subs: subs,
    __logs: logs,
    webhookSubscription: {
      findMany: jest.fn(async ({ where }: any = {}) => {
        return subs.filter((s) => {
          if (where?.isActive !== undefined && s.isActive !== where.isActive) return false
          if (where?.events?.has !== undefined && !s.events.includes(where.events.has)) return false
          return true
        })
      }),
      findUnique: jest.fn(async ({ where }: any) => subs.find((s) => s.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `sub-${subs.length + 1}`, createdAt: new Date(), updatedAt: new Date(), totalDeliveries: 0, totalSuccesses: 0, totalFailures: 0, consecutiveFailures: 0, ...data }
        subs.push(row)
        return row
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const i = subs.findIndex((s) => s.id === where.id)
        if (i < 0) throw new Error('not found')
        subs[i] = { ...subs[i], ...data, updatedAt: new Date() }
        return subs[i]
      }),
      delete: jest.fn(async ({ where }: any) => {
        const i = subs.findIndex((s) => s.id === where.id)
        if (i < 0) throw new Error('not found')
        const [row] = subs.splice(i, 1)
        return row
      }),
    },
    webhookDeliveryLog: {
      findMany: jest.fn(async () => logs),
      count: jest.fn(async () => logs.length),
      findUnique: jest.fn(async ({ where }: any) => logs.find((l) => l.id === where.id) ?? null),
    },
  } as any
}

describe('WebhookService', () => {
  describe('getAvailableEvents', () => {
    it('returns the full 20-event whitelist', () => {
      const svc = new WebhookService(mkPrisma())
      const events = svc.getAvailableEvents()
      expect(events).toHaveLength(20)
      expect(events).toEqual(WEBHOOK_EVENT_TYPES)
    })
  })

  describe('create', () => {
    it('creates a subscription with generated 64-char secret', async () => {
      const prisma = mkPrisma()
      const svc = new WebhookService(prisma)
      const sub = await svc.create({
        url: 'https://n8n.example.com/webhook/abc',
        events: ['order.created', 'order.confirmed'],
        description: 'test',
      })
      expect(sub.url).toBe('https://n8n.example.com/webhook/abc')
      expect(sub.events).toEqual(['order.created', 'order.confirmed'])
      expect(sub.secret).toMatch(/^[a-f0-9]{64}$/)
      expect(sub.isActive).toBe(true)
    })

    it('rejects non-http(s) URL', async () => {
      const svc = new WebhookService(mkPrisma())
      await expect(
        svc.create({ url: 'ftp://bad.example.com', events: ['order.created'] }),
      ).rejects.toMatchObject({ response: { error: 'InvalidWebhookUrl' } })
    })

    it('rejects malformed URL', async () => {
      const svc = new WebhookService(mkPrisma())
      await expect(
        svc.create({ url: 'not a url', events: ['order.created'] }),
      ).rejects.toMatchObject({ response: { error: 'InvalidWebhookUrl' } })
    })

    it('rejects empty events array', async () => {
      const svc = new WebhookService(mkPrisma())
      await expect(
        svc.create({ url: 'https://example.com', events: [] }),
      ).rejects.toMatchObject({ response: { error: 'NoEventsSelected' } })
    })

    it('rejects unknown event types', async () => {
      const svc = new WebhookService(mkPrisma())
      await expect(
        svc.create({ url: 'https://example.com', events: ['order.created', 'fake.event'] }),
      ).rejects.toMatchObject({ response: { error: 'UnknownEventTypes' } })
    })

    it('allows localhost URLs in non-production', async () => {
      const orig = process.env.NODE_ENV
      process.env.NODE_ENV = 'test'
      try {
        const svc = new WebhookService(mkPrisma())
        const sub = await svc.create({
          url: 'http://localhost:3000/wh',
          events: ['order.created'],
        })
        expect(sub.url).toBe('http://localhost:3000/wh')
      } finally {
        process.env.NODE_ENV = orig
      }
    })

    it('blocks internal URLs in production', async () => {
      const orig = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      try {
        const svc = new WebhookService(mkPrisma())
        await expect(
          svc.create({ url: 'http://localhost:3000/wh', events: ['order.created'] }),
        ).rejects.toMatchObject({ response: { error: 'InternalUrlBlocked' } })
        await expect(
          svc.create({ url: 'http://192.168.1.100/wh', events: ['order.created'] }),
        ).rejects.toMatchObject({ response: { error: 'InternalUrlBlocked' } })
        await expect(
          svc.create({ url: 'http://10.0.0.1/wh', events: ['order.created'] }),
        ).rejects.toMatchObject({ response: { error: 'InternalUrlBlocked' } })
      } finally {
        process.env.NODE_ENV = orig
      }
    })
  })

  describe('findActiveForEvent', () => {
    it('returns only active subscriptions that subscribed to the event', async () => {
      const prisma = mkPrisma()
      const svc = new WebhookService(prisma)
      await svc.create({ url: 'https://a.example.com', events: ['order.created'] })
      await svc.create({ url: 'https://b.example.com', events: ['order.confirmed', 'order.cancelled'] })
      const sub3 = await svc.create({ url: 'https://c.example.com', events: ['order.created'] })
      // Deactivate one
      await svc.update(sub3.id, { isActive: false })

      const matches = await svc.findActiveForEvent('order.created')
      expect(matches.map((s: any) => s.url)).toEqual(['https://a.example.com'])
    })

    it('returns empty array for unknown event type (defensive)', async () => {
      const svc = new WebhookService(mkPrisma())
      const matches = await svc.findActiveForEvent('fake.event')
      expect(matches).toEqual([])
    })
  })

  describe('rotateSecret', () => {
    it('generates a new 64-char secret', async () => {
      const prisma = mkPrisma()
      const svc = new WebhookService(prisma)
      const sub = await svc.create({ url: 'https://a.example.com', events: ['order.created'] })
      const before = sub.secret
      const after = await svc.rotateSecret(sub.id)
      expect(after.secret).not.toBe(before)
      expect(after.secret).toMatch(/^[a-f0-9]{64}$/)
    })

    it('throws NotFound for unknown id', async () => {
      const svc = new WebhookService(mkPrisma())
      await expect(svc.rotateSecret('does-not-exist')).rejects.toMatchObject({
        response: { error: 'SubscriptionNotFound' },
      })
    })
  })

  describe('update', () => {
    it('patches url/events/description/isActive individually', async () => {
      const prisma = mkPrisma()
      const svc = new WebhookService(prisma)
      const sub = await svc.create({ url: 'https://a.example.com', events: ['order.created'] })
      const after = await svc.update(sub.id, { isActive: false, description: 'paused' })
      expect(after.isActive).toBe(false)
      expect(after.description).toBe('paused')
      expect(after.url).toBe('https://a.example.com') // unchanged
      expect(after.events).toEqual(['order.created']) // unchanged
    })

    it('revalidates url when updating it', async () => {
      const prisma = mkPrisma()
      const svc = new WebhookService(prisma)
      const sub = await svc.create({ url: 'https://a.example.com', events: ['order.created'] })
      await expect(svc.update(sub.id, { url: 'ftp://bad' })).rejects.toMatchObject({
        response: { error: 'InvalidWebhookUrl' },
      })
    })
  })

  describe('remove', () => {
    it('deletes the subscription', async () => {
      const prisma = mkPrisma()
      const svc = new WebhookService(prisma)
      const sub = await svc.create({ url: 'https://a.example.com', events: ['order.created'] })
      await svc.remove(sub.id)
      await expect(svc.findOne(sub.id)).rejects.toMatchObject({
        response: { error: 'SubscriptionNotFound' },
      })
    })
  })
})
