'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export default function PrintOrderPage({ params: { id } }: { params: { id: string; locale: string } }) {
  const { data: order, isLoading } = useQuery({
    queryKey: ['admin-order', id],
    queryFn: async () => { const { data } = await api.get(`/admin/orders/${id}`); return data },
  })

  if (isLoading || !order) return <p>Laden...</p>

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>

      <div className="p-4 max-w-2xl mx-auto">
        <button onClick={() => window.print()} className="mb-4 px-4 py-2 bg-black text-white rounded print:hidden">
          Drucken
        </button>

        <div id="print-area" className="text-sm" style={{ fontFamily: 'system-ui, sans-serif' }}>
          {/* Header */}
          <div className="flex justify-between border-b pb-4 mb-4">
            <div>
              <h1 className="text-xl font-bold">LIEFERSCHEIN</h1>
              <p className="text-gray-500 mt-1">{order.orderNumber}</p>
              <p className="text-gray-500">{new Date(order.createdAt).toLocaleDateString('de-DE')}</p>
            </div>
            <div className="text-right">
              <p className="font-bold">Malak Bekleidung</p>
              <p className="text-gray-500 text-xs">info@malak-bekleidung.com</p>
            </div>
          </div>

          {/* Customer */}
          <div className="grid grid-cols-2 gap-8 mb-6">
            <div>
              <p className="font-semibold text-xs text-gray-500 uppercase mb-1">Lieferadresse</p>
              {order.shippingAddress ? (
                <>
                  <p>{order.shippingAddress.firstName} {order.shippingAddress.lastName}</p>
                  <p>{order.shippingAddress.street} {order.shippingAddress.houseNumber}</p>
                  <p>{order.shippingAddress.postalCode} {order.shippingAddress.city}</p>
                  <p>{order.shippingAddress.country}</p>
                </>
              ) : (
                <p>{order.user?.firstName} {order.user?.lastName}<br/>{order.user?.email}</p>
              )}
            </div>
            <div>
              <p className="font-semibold text-xs text-gray-500 uppercase mb-1">Kunde</p>
              <p>{order.user?.firstName} {order.user?.lastName}</p>
              <p>{order.user?.email}</p>
              {order.user?.phone && <p>{order.user.phone}</p>}
            </div>
          </div>

          {/* Items Table */}
          <table className="w-full border-collapse mb-6">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="text-left py-2">Pos.</th>
                <th className="text-left py-2">Artikel</th>
                <th className="text-center py-2">Menge</th>
                <th className="text-right py-2">Einzelpreis</th>
                <th className="text-right py-2">Gesamt</th>
              </tr>
            </thead>
            <tbody>
              {(order.items ?? []).map((item: any, i: number) => (
                <tr key={item.id} className="border-b">
                  <td className="py-2">{i + 1}</td>
                  <td className="py-2">
                    <p className="font-medium">{item.snapshotName}</p>
                    <p className="text-xs text-gray-500">{item.snapshotSku} {item.variant?.color ? `/ ${item.variant.color}` : ''} {item.variant?.size ? `/ ${item.variant.size}` : ''}</p>
                  </td>
                  <td className="text-center py-2">{item.quantity}</td>
                  <td className="text-right py-2">€{Number(item.unitPrice).toFixed(2)}</td>
                  <td className="text-right py-2">€{Number(item.totalPrice).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64">
              <div className="flex justify-between py-1"><span>Zwischensumme</span><span>€{Number(order.subtotal).toFixed(2)}</span></div>
              <div className="flex justify-between py-1"><span>Versand</span><span>€{Number(order.shippingCost).toFixed(2)}</span></div>
              <div className="flex justify-between py-1"><span>MwSt.</span><span>€{Number(order.taxAmount).toFixed(2)}</span></div>
              <div className="flex justify-between py-1 border-t-2 border-black font-bold text-base"><span>Gesamt</span><span>€{Number(order.totalAmount).toFixed(2)}</span></div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-8 pt-4 border-t text-xs text-gray-400 text-center">
            Malak Bekleidung — malak-bekleidung.com
          </div>
        </div>
      </div>
    </>
  )
}
