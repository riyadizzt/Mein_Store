/**
 * Build the shared ReturnPayloadBase used by all 4 return webhook events
 * (requested / approved / received / refunded). Each caller adds its own
 * event-specific fields on top.
 *
 * Pure, never throws. Returns null if the return or the linked order
 * cannot be loaded — caller interprets null as "skip the emit".
 */
import type { ReturnPayloadBase, CustomerSnapshot, ReturnItemSnapshot, MoneyAmount } from '../events'

function money(amount: unknown): MoneyAmount {
  const n =
    typeof amount === 'number'
      ? amount
      : typeof amount === 'string'
        ? Number(amount)
        : amount && typeof (amount as any).toString === 'function'
          ? Number((amount as any).toString())
          : 0
  return { amount: (Number.isFinite(n) ? n : 0).toFixed(2), currency: 'EUR' }
}

function detectLocale(raw: unknown): 'de' | 'en' | 'ar' {
  if (raw === 'en' || raw === 'ar' || raw === 'de') return raw
  return 'de'
}

export async function buildReturnPayloadBase(
  prisma: any,
  returnId: string,
  appUrl: string,
): Promise<ReturnPayloadBase | null> {
  const ret = await prisma.return.findUnique({
    where: { id: returnId },
    include: {
      order: {
        include: {
          user: {
            select: {
              id: true, email: true, firstName: true, lastName: true,
              preferredLang: true, passwordHash: true,
            },
          },
        },
      },
    },
  })
  if (!ret || !ret.order) return null

  const order = ret.order
  const customer: CustomerSnapshot = {
    id: order.user?.id ?? null,
    email: order.user?.email ?? order.guestEmail ?? '',
    firstName: order.user?.firstName ?? '',
    lastName: order.user?.lastName ?? '',
    locale: detectLocale(order.user?.preferredLang),
    // stub user = passwordHash null → effectively guest
    isGuest: !order.user?.passwordHash,
  }

  // returnItems is a Json column — an array of { variantId, sku, name,
  // quantity, reason } shapes built at creation time.
  const rawItems = Array.isArray(ret.returnItems) ? ret.returnItems : []
  const items: ReturnItemSnapshot[] = rawItems.map((i: any) => ({
    variantId: i.variantId ?? '',
    sku: i.sku ?? '',
    productName: i.name ?? i.productName ?? '',
    quantity: typeof i.quantity === 'number' ? i.quantity : 1,
    reason: i.reason ?? ret.reason ?? 'unspecified',
  }))

  // shopPaysShipping is stored in adminNotes (set during approve step).
  const shopPaysShipping = ret.adminNotes === 'shop_pays_shipping'

  return {
    returnId: ret.id,
    returnNumber: ret.returnNumber ?? '',
    orderId: order.id,
    orderNumber: order.orderNumber,
    customer,
    items,
    refundAmount: money(ret.refundAmount),
    shopPaysShipping,
    createdAt: ret.createdAt.toISOString(),
    returnUrl: `${appUrl}/de/admin/returns/${ret.id}`,
  }
}
