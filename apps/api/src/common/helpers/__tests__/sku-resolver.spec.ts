import { resolveUniqueSku, resolveUniqueSkus } from '../sku-resolver'

// Minimal prisma mock — just productVariant.findFirst which is the only
// call the resolver makes. We give the mock a backing Set for realistic
// lookups.
const mkPrisma = (existingSkus: string[] = []) => {
  const existing = new Set(existingSkus)
  return {
    productVariant: {
      findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
        return existing.has(where.sku) ? { id: 'x' } : null
      }),
    },
  } as any
}

describe('resolveUniqueSku', () => {
  it('returns the base SKU if no collision', async () => {
    const prisma = mkPrisma([])
    const res = await resolveUniqueSku(prisma, 'MAL-ABC-RED-S', new Set())
    expect(res).toBe('MAL-ABC-RED-S')
  })

  it('appends -002 on first collision', async () => {
    const prisma = mkPrisma(['MAL-ABC-RED-S'])
    const res = await resolveUniqueSku(prisma, 'MAL-ABC-RED-S', new Set())
    expect(res).toBe('MAL-ABC-RED-S-002')
  })

  it('keeps counting up: -003, -004, -005', async () => {
    const prisma = mkPrisma(['MAL-X-Y-S', 'MAL-X-Y-S-002', 'MAL-X-Y-S-003'])
    const res = await resolveUniqueSku(prisma, 'MAL-X-Y-S', new Set())
    expect(res).toBe('MAL-X-Y-S-004')
  })

  it('skips already-reserved SKUs from the same request', async () => {
    // No DB collisions, but the caller has already reserved the base SKU
    // in this same create payload (e.g. two variants generate the same
    // raw SKU due to a wizard bug).
    const prisma = mkPrisma([])
    const reserved = new Set<string>()
    const first = await resolveUniqueSku(prisma, 'MAL-DUP-RED-M', reserved)
    const second = await resolveUniqueSku(prisma, 'MAL-DUP-RED-M', reserved)
    expect(first).toBe('MAL-DUP-RED-M')
    expect(second).toBe('MAL-DUP-RED-M-002')
  })

  it('handles combined DB collision + same-request reservation', async () => {
    // DB has the base + -002. Same request wants it twice.
    const prisma = mkPrisma(['MAL-X-Y-S', 'MAL-X-Y-S-002'])
    const reserved = new Set<string>()
    const first = await resolveUniqueSku(prisma, 'MAL-X-Y-S', reserved)
    const second = await resolveUniqueSku(prisma, 'MAL-X-Y-S', reserved)
    expect(first).toBe('MAL-X-Y-S-003')
    expect(second).toBe('MAL-X-Y-S-004')
  })

  it('suffix uses 3-digit zero-padding', async () => {
    // Collisions up to -011 — check we get -012 with padding
    const taken = ['MAL-Z']
    for (let i = 2; i <= 11; i++) taken.push(`MAL-Z-${String(i).padStart(3, '0')}`)
    const prisma = mkPrisma(taken)
    const res = await resolveUniqueSku(prisma, 'MAL-Z', new Set())
    expect(res).toBe('MAL-Z-012')
  })

  it('throws on exhaustion of the 999 cap', async () => {
    // Occupy the base + -002..-999 (all 999 slots)
    const taken = ['MAL-FULL']
    for (let i = 2; i <= 999; i++) taken.push(`MAL-FULL-${String(i).padStart(3, '0')}`)
    const prisma = mkPrisma(taken)
    await expect(resolveUniqueSku(prisma, 'MAL-FULL', new Set())).rejects.toThrow(/exhausted/)
  })
})

describe('resolveUniqueSkus (batch)', () => {
  it('returns an empty adjustments array when nothing collides', async () => {
    const prisma = mkPrisma([])
    const { resolved, adjustments } = await resolveUniqueSkus(prisma, [
      'MAL-NEW-RED-S', 'MAL-NEW-RED-M', 'MAL-NEW-RED-L',
    ])
    expect(resolved).toEqual(['MAL-NEW-RED-S', 'MAL-NEW-RED-M', 'MAL-NEW-RED-L'])
    expect(adjustments).toEqual([])
  })

  it('collects adjustments for every changed SKU', async () => {
    // S + L already in DB, M is free.
    const prisma = mkPrisma(['MAL-HS-ROT-S', 'MAL-HS-ROT-L'])
    const { resolved, adjustments } = await resolveUniqueSkus(prisma, [
      'MAL-HS-ROT-S', 'MAL-HS-ROT-M', 'MAL-HS-ROT-L',
    ])
    expect(resolved).toEqual(['MAL-HS-ROT-S-002', 'MAL-HS-ROT-M', 'MAL-HS-ROT-L-002'])
    expect(adjustments).toEqual([
      { original: 'MAL-HS-ROT-S', final: 'MAL-HS-ROT-S-002' },
      { original: 'MAL-HS-ROT-L', final: 'MAL-HS-ROT-L-002' },
    ])
  })

  it('handles two variants wanting the same base SKU in one request', async () => {
    // DB is clean, but the payload has a duplicate base (e.g. wizard bug).
    const prisma = mkPrisma([])
    const { resolved, adjustments } = await resolveUniqueSkus(prisma, [
      'MAL-SAME-BLK-M',
      'MAL-SAME-BLK-M',  // duplicate
    ])
    expect(resolved).toEqual(['MAL-SAME-BLK-M', 'MAL-SAME-BLK-M-002'])
    expect(adjustments).toEqual([
      { original: 'MAL-SAME-BLK-M', final: 'MAL-SAME-BLK-M-002' },
    ])
  })

  it('does not mark unchanged SKUs as adjustments', async () => {
    const prisma = mkPrisma(['MAL-A-B-S'])  // only first variant collides
    const { resolved, adjustments } = await resolveUniqueSkus(prisma, [
      'MAL-A-B-S',  // → -002
      'MAL-A-B-M',  // free
    ])
    expect(resolved).toEqual(['MAL-A-B-S-002', 'MAL-A-B-M'])
    expect(adjustments).toHaveLength(1)
    expect(adjustments[0].original).toBe('MAL-A-B-S')
  })
})
