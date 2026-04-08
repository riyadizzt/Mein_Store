/**
 * Unit-Tests für die MwSt-Berechnung (Bruttopreise, deutsches Recht).
 *
 * Regel: Preise sind BRUTTO (inkl. MwSt). Die MwSt wird HERAUSGERECHNET,
 * nicht draufaddiert. totalAmount = subtotal + versand - rabatt.
 *
 * Formel: MwSt = Brutto - (Brutto / (1 + Steuersatz/100))
 */

// @ts-nocheck — Jest uses Babel (no TS), TypeScript runs separately
// Exakte Kopie der Logik aus orders.service.ts
function calculateOrder(items, shippingCost, discountAmount) {
  discountAmount = discountAmount || 0
  let subtotal = 0
  let taxAmount = 0

  for (const item of items) {
    const itemTotal = item.unitPrice * item.quantity
    const itemNet = itemTotal / (1 + item.taxRate / 100)
    const itemTax = itemTotal - itemNet
    subtotal += itemTotal
    taxAmount += itemTax
  }

  // Versand-MwSt (19%)
  const shippingTax = shippingCost - (shippingCost / 1.19)
  taxAmount += shippingTax

  // Rabatt reduziert MwSt
  if (discountAmount > 0) {
    const discountTax = discountAmount - (discountAmount / 1.19)
    taxAmount -= discountTax
  }

  const totalAmount = subtotal + shippingCost - discountAmount
  taxAmount = Math.round(taxAmount * 100) / 100

  return { subtotal, taxAmount, totalAmount }
}

describe('German VAT calculation (Bruttopreise)', () => {
  it('1x €50.00 Produkt + €4.99 Versand → Gesamt €54.99, MwSt €8.78', () => {
    const result = calculateOrder(
      [{ unitPrice: 50, quantity: 1, taxRate: 19 }],
      4.99,
    )
    expect(result.subtotal).toBe(50)
    expect(result.totalAmount).toBe(54.99)
    expect(result.taxAmount).toBe(8.78)
    // KRITISCH: totalAmount darf NICHT subtotal + shipping + taxAmount sein!
    expect(result.totalAmount).not.toBe(result.subtotal + 4.99 + result.taxAmount)
  })

  it('MwSt wird NICHT auf den Gesamtbetrag addiert', () => {
    const result = calculateOrder(
      [{ unitPrice: 100, quantity: 1, taxRate: 19 }],
      0,
    )
    expect(result.totalAmount).toBe(100)
    expect(result.taxAmount).toBeCloseTo(15.97, 1)
  })

  it('2x €29.99 + Versand €4.99 → korrekt', () => {
    const result = calculateOrder(
      [{ unitPrice: 29.99, quantity: 2, taxRate: 19 }],
      4.99,
    )
    expect(result.subtotal).toBe(59.98)
    expect(result.totalAmount).toBe(64.97)
    expect(result.taxAmount).toBeCloseTo(10.37, 1)
  })

  it('Mit Rabatt €10 → MwSt wird anteilig reduziert', () => {
    const result = calculateOrder(
      [{ unitPrice: 100, quantity: 1, taxRate: 19 }],
      4.99,
      10,
    )
    expect(result.totalAmount).toBe(94.99)
    expect(result.taxAmount).toBeCloseTo(15.17, 1)
  })

  it('Kostenloser Versand → keine Versand-MwSt', () => {
    const result = calculateOrder(
      [{ unitPrice: 150, quantity: 1, taxRate: 19 }],
      0,
    )
    expect(result.totalAmount).toBe(150)
    expect(result.taxAmount).toBeCloseTo(23.95, 1)
  })

  it('Mehrere Artikel → Gesamt = Summe Bruttopreise + Versand', () => {
    const result = calculateOrder(
      [
        { unitPrice: 49.99, quantity: 1, taxRate: 19 },
        { unitPrice: 79.99, quantity: 1, taxRate: 19 },
        { unitPrice: 19.99, quantity: 3, taxRate: 19 },
      ],
      4.99,
    )
    expect(result.subtotal).toBe(189.95)
    expect(result.totalAmount).toBe(194.94)
    expect(result.totalAmount).toBe(result.subtotal + 4.99)
  })

  it('Rundung ist Cent-genau', () => {
    const result = calculateOrder(
      [{ unitPrice: 33.33, quantity: 1, taxRate: 19 }],
      0,
    )
    const decimals = result.taxAmount.toString().split('.')[1]
    expect(decimals ? decimals.length : 0).toBeLessThanOrEqual(2)
  })

  it('0€ Bestellung → 0€ MwSt', () => {
    const result = calculateOrder([], 0)
    expect(result.subtotal).toBe(0)
    expect(result.taxAmount).toBe(0)
    expect(result.totalAmount).toBe(0)
  })
})
