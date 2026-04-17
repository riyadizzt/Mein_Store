import { WebhookDispatcherService } from '../webhook-dispatcher.service'
import { WebhookService } from '../webhook.service'
import type { OrderCreatedPayload } from '../events'

function mkPrisma() {
  const logs: any[] = []
  const subs: any[] = []
  return {
    __logs: logs,
    __subs: subs,
    webhookSubscription: {
      findMany: jest.fn(async ({ where }: any = {}) => {
        return subs.filter((s) => {
          if (where?.isActive !== undefined && s.isActive !== where.isActive) return false
          if (where?.events?.has && !s.events.includes(where.events.has)) return false
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
        subs[i] = { ...subs[i], ...data, updatedAt: new Date() }
        return subs[i]
      }),
      delete: jest.fn(),
    },
    webhookDeliveryLog: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `log-${logs.length + 1}`, createdAt: new Date(), ...data }
        logs.push(row)
        return row
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const i = logs.findIndex((l) => l.id === where.id)
        if (i < 0) throw new Error('not found')
        logs[i] = { ...logs[i], ...data }
        return logs[i]
      }),
      findMany: jest.fn(async () => logs),
      findUnique: jest.fn(async ({ where }: any) => logs.find((l) => l.id === where.id) ?? null),
      count: jest.fn(async () => logs.length),
    },
  } as any
}

function mkQueue() {
  const jobs: any[] = []
  return {
    __jobs: jobs,
    add: jest.fn(async (name: string, data: any, opts: any) => {
      const job = { id: `job-${jobs.length + 1}`, name, data, opts }
      jobs.push(job)
      return job
    }),
  }
}

const sampleOrderPayload: OrderCreatedPayload = {
  orderId: 'ord-1',
  orderNumber: 'ORD-2026-00001',
  channel: 'website',
  customer: {
    id: 'u-1', email: 'a@b.com', firstName: 'Alice', lastName: 'Doe',
    locale: 'de', isGuest: false,
  },
  items: [{
    variantId: 'v-1', sku: 'SKU-1', productName: 'Shirt', productSlug: 'shirt',
    color: null, size: 'M', quantity: 1,
    unitPrice: { amount: '99.99', currency: 'EUR' },
    lineTotal: { amount: '99.99', currency: 'EUR' },
    imageUrl: null,
  }],
  subtotal: { amount: '99.99', currency: 'EUR' },
  shipping: { amount: '4.99', currency: 'EUR' },
  discount: { amount: '0.00', currency: 'EUR' },
  total: { amount: '104.98', currency: 'EUR' },
  taxIncluded: { amount: '16.76', currency: 'EUR' },
  shippingAddress: {
    firstName: 'Alice', lastName: 'Doe', street: 'Main', houseNumber: '1',
    postalCode: '10115', city: 'Berlin', country: 'DE', phone: null,
  },
  billingAddress: null,
  paymentMethod: null,
  createdAt: '2026-04-17T10:00:00.000Z',
  orderUrl: 'https://malak.example.com/admin/orders/ord-1',
}

describe('WebhookDispatcherService', () => {
  describe('emit — happy path', () => {
    it('creates delivery log + enqueues job for each matching active subscription', async () => {
      const prisma = mkPrisma()
      const sub = new WebhookService(prisma)
      await sub.create({ url: 'https://a.example.com', events: ['order.created'] })
      await sub.create({ url: 'https://b.example.com', events: ['order.created', 'order.cancelled'] })
      // inactive — should NOT receive
      const s3 = await sub.create({ url: 'https://c.example.com', events: ['order.created'] })
      await sub.update(s3.id, { isActive: false })
      // different event — should NOT receive
      await sub.create({ url: 'https://d.example.com', events: ['return.requested'] })

      const queue = mkQueue()
      const dispatcher = new WebhookDispatcherService(prisma, sub, queue)

      const result = await dispatcher.emit('order.created', sampleOrderPayload)

      expect(result.enqueued).toBe(2)
      expect(result.errors).toEqual([])
      expect(prisma.__logs).toHaveLength(2)
      expect(queue.__jobs).toHaveLength(2)
      // Each log has a distinct event_id
      const ids = new Set(prisma.__logs.map((l: any) => l.eventId))
      expect(ids.size).toBe(2)
      // Payload envelope shape
      expect(prisma.__logs[0].payload).toMatchObject({
        type: 'order.created',
        apiVersion: expect.any(String),
        data: { object: { orderNumber: 'ORD-2026-00001' } },
      })
    })

    it('enqueues job with 3-retry attempts config', async () => {
      const prisma = mkPrisma()
      const sub = new WebhookService(prisma)
      await sub.create({ url: 'https://a.example.com', events: ['order.created'] })
      const queue = mkQueue()
      const dispatcher = new WebhookDispatcherService(prisma, sub, queue)

      await dispatcher.emit('order.created', sampleOrderPayload)

      expect(queue.__jobs[0].opts.attempts).toBe(3)
      expect(queue.__jobs[0].name).toBe('deliver-webhook')
    })
  })

  describe('emit — no matching subscriptions', () => {
    it('returns 0 enqueued, no errors, no log, no queue job', async () => {
      const prisma = mkPrisma()
      const sub = new WebhookService(prisma)
      const queue = mkQueue()
      const dispatcher = new WebhookDispatcherService(prisma, sub, queue)
      const result = await dispatcher.emit('order.created', sampleOrderPayload)
      expect(result.enqueued).toBe(0)
      expect(prisma.__logs).toHaveLength(0)
      expect(queue.__jobs).toHaveLength(0)
    })
  })

  describe('emit — defensive failures', () => {
    it('NEVER throws — swallows errors from findActiveForEvent', async () => {
      const prisma = mkPrisma()
      prisma.webhookSubscription.findMany = jest.fn().mockRejectedValue(new Error('DB offline'))
      const sub = new WebhookService(prisma)
      const dispatcher = new WebhookDispatcherService(prisma, sub, mkQueue())

      const result = await dispatcher.emit('order.created', sampleOrderPayload)
      expect(result.enqueued).toBe(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toMatch(/DB offline/)
    })

    it('continues with other subs if one sub fails to log', async () => {
      const prisma = mkPrisma()
      const sub = new WebhookService(prisma)
      await sub.create({ url: 'https://a.example.com', events: ['order.created'] })
      await sub.create({ url: 'https://b.example.com', events: ['order.created'] })

      // Make the FIRST log.create call fail, the second succeed
      let n = 0
      prisma.webhookDeliveryLog.create = jest.fn().mockImplementation(async ({ data }: any) => {
        n++
        if (n === 1) throw new Error('unique violation')
        return { id: `log-${n}`, createdAt: new Date(), ...data }
      })

      const dispatcher = new WebhookDispatcherService(prisma, sub, mkQueue())
      const result = await dispatcher.emit('order.created', sampleOrderPayload)

      expect(result.enqueued).toBe(1)
      expect(result.errors).toHaveLength(1)
    })

    it('returns empty result for unknown event type (no crash)', async () => {
      const prisma = mkPrisma()
      const sub = new WebhookService(prisma)
      const dispatcher = new WebhookDispatcherService(prisma, sub, mkQueue())
      const result = await dispatcher.emit('fake.event' as any, {} as any)
      expect(result.enqueued).toBe(0)
      expect(result.errors[0]).toMatch(/unknown event/)
    })

    it('works when queue is not provided (unit test / NoOp scenario)', async () => {
      const prisma = mkPrisma()
      const sub = new WebhookService(prisma)
      await sub.create({ url: 'https://a.example.com', events: ['order.created'] })
      const dispatcher = new WebhookDispatcherService(prisma, sub) // no queue
      const result = await dispatcher.emit('order.created', sampleOrderPayload)
      expect(result.enqueued).toBe(1)
      expect(prisma.__logs).toHaveLength(1)
    })
  })

  describe('retryDelivery', () => {
    it('resets status to pending and enqueues fresh job', async () => {
      const prisma = mkPrisma()
      const sub = new WebhookService(prisma)
      const s = await sub.create({ url: 'https://a.example.com', events: ['order.created'] })
      prisma.__logs.push({
        id: 'log-X', subscriptionId: s.id, eventType: 'order.created', eventId: 'evt-X',
        payload: {}, status: 'failed', attemptCount: 3, errorMessage: 'timeout',
      })
      const queue = mkQueue()
      const dispatcher = new WebhookDispatcherService(prisma, sub, queue)

      const updated = await dispatcher.retryDelivery('log-X')
      expect(updated.status).toBe('pending')
      expect(updated.errorMessage).toBeNull()
      expect(queue.__jobs).toHaveLength(1)
    })
  })

  describe('sendTestEvent', () => {
    it('creates a log + enqueues ONE job for the specific subscription', async () => {
      const prisma = mkPrisma()
      const sub = new WebhookService(prisma)
      const s = await sub.create({ url: 'https://a.example.com', events: ['order.created'] })
      const queue = mkQueue()
      const dispatcher = new WebhookDispatcherService(prisma, sub, queue)

      const log = await dispatcher.sendTestEvent(s.id)
      expect(log.subscriptionId).toBe(s.id)
      expect(log.status).toBe('pending')
      expect(queue.__jobs).toHaveLength(1)
      expect((log.payload as any).data.object.test).toBe(true)
    })
  })
})
