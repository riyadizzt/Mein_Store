import { OrderWebhookListener } from '../listeners/order-webhook.listener'
import { ORDER_EVENTS } from '../../orders/events/order.events'

function mkPrisma(overrides: any = {}) {
  return {
    order: {
      findUnique: jest.fn(async ({ where }: any) => overrides[where.id] ?? null),
    },
    payment: {
      findUnique: jest.fn(async ({ where }: any) => overrides.__payment?.[where.orderId] ?? null),
    },
    shipment: {
      findUnique: jest.fn(async ({ where }: any) => overrides.__shipment?.[where.orderId] ?? null),
    },
  } as any
}

function mkDispatcher() {
  const emits: any[] = []
  return {
    __emits: emits,
    emit: jest.fn(async (type: string, payload: any) => {
      emits.push({ type, payload })
      return { enqueued: 1, errors: [] }
    }),
  } as any
}

const mkConfig = (url = 'https://malak.example.com') => ({
  get: jest.fn((key: string, def?: string) => (key === 'APP_URL' ? url : def)),
} as any)

// ── Fixtures ─────────────────────────────────────────────────

const fullOrder = {
  id: 'ord-1',
  orderNumber: 'ORD-2026-00001',
  channel: 'website',
  subtotal: 99.99,
  shippingCost: 4.99,
  discountAmount: 0,
  totalAmount: 104.98,
  taxAmount: 16.76,
  notes: null,
  cancelledAt: null,
  createdAt: new Date('2026-04-17T10:00:00.000Z'),
  guestEmail: null,
  shippingAddressSnapshot: null,
  user: {
    id: 'u-1', email: 'alice@example.com', firstName: 'Alice', lastName: 'Doe',
    preferredLang: 'de', passwordHash: 'hashed',
  },
  shippingAddress: {
    firstName: 'Alice', lastName: 'Doe', street: 'Main', houseNumber: '1',
    postalCode: '10115', city: 'Berlin', country: 'DE', phone: '+49301234567',
  },
  items: [
    {
      variantId: 'v-1', quantity: 1,
      unitPrice: 99.99, totalPrice: 99.99,
      snapshotName: 'Winterjacke Classic', snapshotSku: 'MAL-WJ-RED-M',
      variant: {
        id: 'v-1', sku: 'MAL-WJ-RED-M', color: 'Red', size: 'M',
        product: { slug: 'winterjacke-classic', images: [{ url: 'https://cdn/img.jpg' }] },
      },
    },
  ],
  payment: { method: 'STRIPE_CARD', provider: 'STRIPE' },
}

describe('OrderWebhookListener', () => {
  describe('handleCreated', () => {
    it('emits order.created with full payload', async () => {
      const prisma = mkPrisma({ 'ord-1': fullOrder })
      const dispatcher = mkDispatcher()
      const listener = new OrderWebhookListener(prisma, dispatcher, mkConfig())

      await listener.handleCreated({
        orderId: 'ord-1',
        orderNumber: 'ORD-2026-00001',
        correlationId: 'corr-1',
        items: [],
      })

      expect(dispatcher.__emits).toHaveLength(1)
      expect(dispatcher.__emits[0].type).toBe('order.created')
      const p = dispatcher.__emits[0].payload
      expect(p.orderId).toBe('ord-1')
      expect(p.orderNumber).toBe('ORD-2026-00001')
      expect(p.channel).toBe('website')
      expect(p.customer).toEqual({
        id: 'u-1', email: 'alice@example.com', firstName: 'Alice', lastName: 'Doe',
        locale: 'de', isGuest: false,
      })
      expect(p.items).toHaveLength(1)
      expect(p.items[0].sku).toBe('MAL-WJ-RED-M')
      expect(p.items[0].productSlug).toBe('winterjacke-classic')
      expect(p.items[0].imageUrl).toBe('https://cdn/img.jpg')
      expect(p.subtotal).toEqual({ amount: '99.99', currency: 'EUR' })
      expect(p.total).toEqual({ amount: '104.98', currency: 'EUR' })
      expect(p.taxIncluded).toEqual({ amount: '16.76', currency: 'EUR' })
      expect(p.shippingAddress.city).toBe('Berlin')
      expect(p.orderUrl).toBe('https://malak.example.com/de/admin/orders/ord-1')
    })

    it('marks stub-user (no passwordHash) as guest', async () => {
      const stubOrder = {
        ...fullOrder,
        user: { ...fullOrder.user, passwordHash: null },
      }
      const prisma = mkPrisma({ 'ord-1': stubOrder })
      const dispatcher = mkDispatcher()
      const listener = new OrderWebhookListener(prisma, dispatcher, mkConfig())

      await listener.handleCreated({
        orderId: 'ord-1', orderNumber: 'ORD-2026-00001', correlationId: 'c', items: [],
      })

      expect(dispatcher.__emits[0].payload.customer.isGuest).toBe(true)
    })

    it('falls back to shippingAddressSnapshot JSON for guests', async () => {
      const snapshotOrder = {
        ...fullOrder,
        shippingAddress: null,
        shippingAddressSnapshot: {
          firstName: 'Bob', lastName: 'Guest', street: 'Oak', houseNumber: '2',
          postalCode: '20095', city: 'Hamburg', country: 'DE',
        },
      }
      const prisma = mkPrisma({ 'ord-1': snapshotOrder })
      const dispatcher = mkDispatcher()
      const listener = new OrderWebhookListener(prisma, dispatcher, mkConfig())

      await listener.handleCreated({
        orderId: 'ord-1', orderNumber: 'ORD-2026-00001', correlationId: 'c', items: [],
      })

      const addr = dispatcher.__emits[0].payload.shippingAddress
      expect(addr.city).toBe('Hamburg')
      expect(addr.firstName).toBe('Bob')
    })

    it('SWALLOWS errors — dispatcher never called on DB failure', async () => {
      const prisma = mkPrisma()
      prisma.order.findUnique = jest.fn().mockRejectedValue(new Error('DB offline'))
      const dispatcher = mkDispatcher()
      const listener = new OrderWebhookListener(prisma, dispatcher, mkConfig())

      await expect(
        listener.handleCreated({ orderId: 'ord-X', orderNumber: 'X', correlationId: 'c', items: [] }),
      ).resolves.toBeUndefined()
      expect(dispatcher.__emits).toHaveLength(0)
    })

    it('skips order without shipping address (no emit)', async () => {
      const noAddr = { ...fullOrder, shippingAddress: null, shippingAddressSnapshot: null }
      const prisma = mkPrisma({ 'ord-1': noAddr })
      const dispatcher = mkDispatcher()
      const listener = new OrderWebhookListener(prisma, dispatcher, mkConfig())

      await listener.handleCreated({
        orderId: 'ord-1', orderNumber: 'ORD-2026-00001', correlationId: 'c', items: [],
      })
      expect(dispatcher.__emits).toHaveLength(0)
    })

    it('respects notes.locale when user.preferredLang is null', async () => {
      const arOrder = {
        ...fullOrder,
        user: { ...fullOrder.user, preferredLang: null },
        notes: JSON.stringify({ locale: 'ar' }),
      }
      const prisma = mkPrisma({ 'ord-1': arOrder })
      const dispatcher = mkDispatcher()
      const listener = new OrderWebhookListener(prisma, dispatcher, mkConfig())

      await listener.handleCreated({
        orderId: 'ord-1', orderNumber: 'ORD-2026-00001', correlationId: 'c', items: [],
      })
      expect(dispatcher.__emits[0].payload.customer.locale).toBe('ar')
    })
  })

  describe('handleConfirmed', () => {
    it('emits order.confirmed with payment info merged in', async () => {
      const prisma = mkPrisma({
        'ord-1': fullOrder,
        __payment: {
          'ord-1': { id: 'pay-1', provider: 'STRIPE', method: 'STRIPE_CARD', status: 'captured', paidAt: new Date('2026-04-17T10:05:00Z') },
        },
      })
      const dispatcher = mkDispatcher()
      const listener = new OrderWebhookListener(prisma, dispatcher, mkConfig())

      await listener.handleConfirmed({
        orderId: 'ord-1', orderNumber: 'ORD-2026-00001', correlationId: 'c', reservationIds: [],
      })

      expect(dispatcher.__emits[0].type).toBe('order.confirmed')
      const p = dispatcher.__emits[0].payload
      expect(p.paymentProvider).toBe('STRIPE')
      expect(p.paymentMethod).toBe('STRIPE_CARD')
      expect(p.paymentId).toBe('pay-1')
      expect(p.confirmedAt).toBe('2026-04-17T10:05:00.000Z')
    })
  })

  describe('handleStatusChanged', () => {
    it('emits generic order.status_changed', async () => {
      const prisma = mkPrisma({ 'ord-1': { orderNumber: 'ORD-X' } })
      const dispatcher = mkDispatcher()
      const listener = new OrderWebhookListener(prisma, dispatcher, mkConfig())

      await listener.handleStatusChanged({
        orderId: 'ord-1', fromStatus: 'pending', toStatus: 'processing',
        source: 'admin', correlationId: 'c',
      })

      expect(dispatcher.__emits).toHaveLength(1)
      expect(dispatcher.__emits[0].type).toBe('order.status_changed')
      expect(dispatcher.__emits[0].payload.toStatus).toBe('processing')
    })

    it('ALSO emits order.shipped with carrier/tracking when toStatus=shipped', async () => {
      const prisma = mkPrisma({
        'ord-1': { orderNumber: 'ORD-X' },
        __shipment: {
          'ord-1': {
            carrier: 'DHL', trackingNumber: 'DHL123', trackingUrl: 'https://track',
            labelUrl: 'https://label.pdf', shippedAt: new Date('2026-04-17T12:00:00Z'),
          },
        },
      })
      const dispatcher = mkDispatcher()
      const listener = new OrderWebhookListener(prisma, dispatcher, mkConfig())

      await listener.handleStatusChanged({
        orderId: 'ord-1', fromStatus: 'processing', toStatus: 'shipped',
        source: 'admin', correlationId: 'c',
      })

      expect(dispatcher.__emits.map((e: any) => e.type)).toEqual(['order.status_changed', 'order.shipped'])
      const shipped = dispatcher.__emits[1].payload
      expect(shipped.carrier).toBe('DHL')
      expect(shipped.trackingNumber).toBe('DHL123')
      expect(shipped.labelUrl).toBe('https://label.pdf')
    })

    it('ALSO emits order.delivered when toStatus=delivered', async () => {
      const prisma = mkPrisma({
        'ord-1': { orderNumber: 'ORD-X' },
        __shipment: {
          'ord-1': {
            carrier: 'DHL', trackingNumber: 'DHL123',
            deliveredAt: new Date('2026-04-18T09:00:00Z'),
          },
        },
      })
      const dispatcher = mkDispatcher()
      const listener = new OrderWebhookListener(prisma, dispatcher, mkConfig())

      await listener.handleStatusChanged({
        orderId: 'ord-1', fromStatus: 'shipped', toStatus: 'delivered',
        source: 'cron', correlationId: 'c',
      })

      expect(dispatcher.__emits.map((e: any) => e.type)).toEqual(['order.status_changed', 'order.delivered'])
      expect(dispatcher.__emits[1].payload.deliveredAt).toBe('2026-04-18T09:00:00.000Z')
    })

    it('swallows errors from DB lookup', async () => {
      const prisma = mkPrisma()
      prisma.order.findUnique = jest.fn().mockRejectedValue(new Error('down'))
      const dispatcher = mkDispatcher()
      const listener = new OrderWebhookListener(prisma, dispatcher, mkConfig())

      await expect(
        listener.handleStatusChanged({
          orderId: 'ord-1', fromStatus: 'p', toStatus: 'c', source: 's', correlationId: 'c',
        }),
      ).resolves.toBeUndefined()
    })
  })

  describe('handleCancelled', () => {
    it('emits refundAmount=total when payment was captured', async () => {
      const cancelled = {
        orderNumber: 'ORD-X',
        totalAmount: 104.98,
        cancelledAt: new Date('2026-04-17T15:00:00Z'),
        items: [{ id: 'i1', quantity: 1 }, { id: 'i2', quantity: 2 }],
        payment: { amount: 104.98, status: 'captured' },
        returns: [],
      }
      const prisma = mkPrisma({ 'ord-1': cancelled })
      const dispatcher = mkDispatcher()
      const listener = new OrderWebhookListener(prisma, dispatcher, mkConfig())

      await listener.handleCancelled({
        orderId: 'ord-1', orderNumber: 'ORD-X', correlationId: 'c',
        reason: 'customer_request', reservationIds: [],
      })

      const p = dispatcher.__emits[0].payload
      expect(p.reason).toBe('customer_request')
      expect(p.refundAmount).toEqual({ amount: '104.98', currency: 'EUR' })
      expect(p.itemsTotal).toBe(3)
    })

    it('emits refundAmount=null when payment was never captured', async () => {
      const cancelled = {
        orderNumber: 'ORD-X', totalAmount: 50,
        cancelledAt: new Date(),
        items: [{ id: 'i1', quantity: 1 }],
        payment: { amount: 50, status: 'pending' },
        returns: [],
      }
      const prisma = mkPrisma({ 'ord-1': cancelled })
      const dispatcher = mkDispatcher()
      const listener = new OrderWebhookListener(prisma, dispatcher, mkConfig())

      await listener.handleCancelled({
        orderId: 'ord-1', orderNumber: 'ORD-X', correlationId: 'c',
        reason: 'payment_timeout', reservationIds: [],
      })

      expect(dispatcher.__emits[0].payload.refundAmount).toBeNull()
    })
  })

  // Sanity check that we use the real event constants
  describe('event constants wiring', () => {
    it('ORDER_EVENTS has the 4 event names we listen to', () => {
      expect(ORDER_EVENTS.CREATED).toBe('order.created')
      expect(ORDER_EVENTS.CONFIRMED).toBe('order.confirmed')
      expect(ORDER_EVENTS.STATUS_CHANGED).toBe('order.status_changed')
      expect(ORDER_EVENTS.CANCELLED).toBe('order.cancelled')
    })
  })
})
