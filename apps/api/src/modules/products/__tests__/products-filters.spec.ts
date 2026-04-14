/**
 * ProductsService — variant filter tests.
 *
 * Covers the new color / size / inStock filters and the getFilterOptions endpoint
 * that powers the storefront filter sidebar.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ProductsService, compareSizes } from '../products.service'
import { PrismaService } from '../../../prisma/prisma.service'

function buildPrisma() {
  const mock: any = {
    product: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    productVariant: {
      findMany: jest.fn(),
    },
    category: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  }
  return mock
}

async function makeService(prisma: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ProductsService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile()
  return module.get<ProductsService>(ProductsService)
}

describe('ProductsService — variant filters', () => {
  let prisma: any

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = buildPrisma()
  })

  describe('findAll — colors filter', () => {
    it('fügt where.variants.some.color hinzu wenn colors gesetzt sind', async () => {
      const service = await makeService(prisma)
      await service.findAll({ colors: ['Schwarz', 'Gold'] })

      const findManyCall = prisma.product.findMany.mock.calls[0][0]
      expect(findManyCall.where.variants).toEqual({
        some: expect.objectContaining({
          isActive: true,
          color: { in: ['Schwarz', 'Gold'], mode: 'insensitive' },
        }),
      })
    })

    it('case-insensitive: matcht "schwarz" und "Schwarz" gleich', async () => {
      const service = await makeService(prisma)
      await service.findAll({ colors: ['schwarz'] })

      const where = prisma.product.findMany.mock.calls[0][0].where
      expect(where.variants.some.color.mode).toBe('insensitive')
    })

    it('kein Filter wenn colors leeres Array', async () => {
      const service = await makeService(prisma)
      await service.findAll({ colors: [] })

      const where = prisma.product.findMany.mock.calls[0][0].where
      expect(where.variants).toBeUndefined()
    })
  })

  describe('findAll — sizes filter', () => {
    it('fügt where.variants.some.size hinzu wenn sizes gesetzt sind', async () => {
      const service = await makeService(prisma)
      await service.findAll({ sizes: ['M', 'L', 'XL'] })

      const where = prisma.product.findMany.mock.calls[0][0].where
      expect(where.variants).toEqual({
        some: expect.objectContaining({
          isActive: true,
          size: { in: ['M', 'L', 'XL'], mode: 'insensitive' },
        }),
      })
    })
  })

  describe('findAll — inStock filter', () => {
    it('fügt inventory.some.quantityOnHand > 0 zur Variant-Bedingung hinzu', async () => {
      const service = await makeService(prisma)
      await service.findAll({ inStock: true })

      const where = prisma.product.findMany.mock.calls[0][0].where
      expect(where.variants.some.inventory).toEqual({
        some: { quantityOnHand: { gt: 0 } },
      })
    })

    it('kein Filter wenn inStock=false', async () => {
      const service = await makeService(prisma)
      await service.findAll({ inStock: false })

      const where = prisma.product.findMany.mock.calls[0][0].where
      expect(where.variants).toBeUndefined()
    })
  })

  describe('findAll — combined filters', () => {
    it('kombiniert colors + sizes + inStock in einer where.variants.some Bedingung', async () => {
      const service = await makeService(prisma)
      await service.findAll({
        colors: ['Schwarz'],
        sizes: ['M'],
        inStock: true,
      })

      const where = prisma.product.findMany.mock.calls[0][0].where
      expect(where.variants.some).toEqual(
        expect.objectContaining({
          isActive: true,
          color: { in: ['Schwarz'], mode: 'insensitive' },
          size: { in: ['M'], mode: 'insensitive' },
          inventory: { some: { quantityOnHand: { gt: 0 } } },
        }),
      )
    })

    it('kombiniert categoryId + colors korrekt', async () => {
      prisma.category.findMany.mockResolvedValue([]) // no children

      const service = await makeService(prisma)
      await service.findAll({
        categoryId: 'cat-1',
        colors: ['Rot'],
      })

      const where = prisma.product.findMany.mock.calls[0][0].where
      expect(where.categoryId).toBe('cat-1')
      expect(where.variants.some.color.in).toEqual(['Rot'])
    })

    it('Eltern-Kategorie + Color: erweitert auf Kinder UND filtert Variante', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'child-1' },
        { id: 'child-2' },
      ])

      const service = await makeService(prisma)
      await service.findAll({
        categoryId: 'parent-cat',
        colors: ['Blau'],
      })

      const where = prisma.product.findMany.mock.calls[0][0].where
      expect(where.categoryId).toEqual({ in: ['parent-cat', 'child-1', 'child-2'] })
      expect(where.variants.some.color.in).toEqual(['Blau'])
    })
  })

  describe('getFilterOptions', () => {
    it('liefert distinct Farben + Größen in Kleidungs-Reihenfolge', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        { color: 'Schwarz', colorHex: '#000000', size: 'M' },
        { color: 'Schwarz', colorHex: '#000000', size: 'L' },
        { color: 'Gold', colorHex: '#d4a853', size: 'M' },
        { color: 'Weiß', colorHex: '#ffffff', size: 'XL' },
      ])

      const service = await makeService(prisma)
      const result = await service.getFilterOptions()

      expect(result.colors).toHaveLength(3)
      expect(result.colors.map((c) => c.name).sort()).toEqual(['Gold', 'Schwarz', 'Weiß'])
      // Letter sizes follow the canonical S→M→L→XL order, NOT alphabetical.
      expect(result.sizes).toEqual(['M', 'L', 'XL'])
    })

    it('dedupliziert case-insensitive Farben (Schwarz vs schwarz)', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        { color: 'Schwarz', colorHex: '#000', size: 'M' },
        { color: 'schwarz', colorHex: '#000', size: 'L' }, // duplicate via case
      ])

      const service = await makeService(prisma)
      const result = await service.getFilterOptions()

      expect(result.colors).toHaveLength(1)
      expect(result.colors[0].name).toBe('Schwarz') // first one wins
    })

    it('ignoriert Varianten ohne color oder size', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        { color: null, colorHex: null, size: 'M' },
        { color: 'Rot', colorHex: '#f00', size: null },
      ])

      const service = await makeService(prisma)
      const result = await service.getFilterOptions()

      expect(result.colors).toHaveLength(1)
      expect(result.colors[0].name).toBe('Rot')
      expect(result.sizes).toEqual(['M'])
    })

    it('liefert leere Listen wenn keine Varianten existieren', async () => {
      prisma.productVariant.findMany.mockResolvedValue([])
      const service = await makeService(prisma)
      const result = await service.getFilterOptions()

      expect(result.colors).toEqual([])
      expect(result.sizes).toEqual([])
    })

    it('mit categoryId: filtert Varianten auf diese Kategorie', async () => {
      prisma.category.findMany.mockResolvedValue([])
      prisma.productVariant.findMany.mockResolvedValue([
        { color: 'Schwarz', colorHex: '#000', size: 'M' },
      ])

      const service = await makeService(prisma)
      await service.getFilterOptions('cat-baby')

      const findManyCall = prisma.productVariant.findMany.mock.calls[0][0]
      expect(findManyCall.where.product.categoryId).toBe('cat-baby')
    })

    it('mit Eltern-categoryId: erweitert auf Kinder', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'baby-jacken' },
        { id: 'baby-hosen' },
      ])
      prisma.productVariant.findMany.mockResolvedValue([])

      const service = await makeService(prisma)
      await service.getFilterOptions('cat-baby')

      const findManyCall = prisma.productVariant.findMany.mock.calls[0][0]
      expect(findManyCall.where.product.categoryId).toEqual({
        in: ['cat-baby', 'baby-jacken', 'baby-hosen'],
      })
    })

    it('Sortierung: Farben alphabetisch (locale-aware)', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        { color: 'Zitronengelb', colorHex: '#ff0', size: 'M' },
        { color: 'Apfelgrün', colorHex: '#0f0', size: 'L' },
        { color: 'Mitternachtsblau', colorHex: '#00f', size: 'S' },
      ])

      const service = await makeService(prisma)
      const result = await service.getFilterOptions()

      expect(result.colors.map((c) => c.name)).toEqual([
        'Apfelgrün',
        'Mitternachtsblau',
        'Zitronengelb',
      ])
    })

    it('Sortierung: Buchstaben-Größen in Kleidungs-Reihenfolge S→M→L→XL', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        { color: 'Rot', colorHex: '#f00', size: 'XL' },
        { color: 'Rot', colorHex: '#f00', size: 'S' },
        { color: 'Rot', colorHex: '#f00', size: 'M' },
        { color: 'Rot', colorHex: '#f00', size: 'L' },
      ])

      const service = await makeService(prisma)
      const result = await service.getFilterOptions()

      expect(result.sizes).toEqual(['S', 'M', 'L', 'XL'])
    })

    it('Sortierung: gemischte numerische + Buchstaben-Größen — Zahlen zuerst', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        { color: 'X', colorHex: null, size: 'XS' },
        { color: 'X', colorHex: null, size: '34' },
        { color: 'X', colorHex: null, size: 'M' },
        { color: 'X', colorHex: null, size: '4XL' },
        { color: 'X', colorHex: null, size: '2' },
        { color: 'X', colorHex: null, size: 'L' },
        { color: 'X', colorHex: null, size: 'XXL' },
        { color: 'X', colorHex: null, size: '3' },
        { color: 'X', colorHex: null, size: 'S' },
        { color: 'X', colorHex: null, size: '3XL' },
      ])

      const service = await makeService(prisma)
      const result = await service.getFilterOptions()

      // Real-world expectation from the user's screenshot.
      expect(result.sizes).toEqual([
        '2', '3', '34',           // numeric ascending
        'XS', 'S', 'M', 'L', 'XXL', '3XL', '4XL',  // letter sizes in canonical order
      ])
    })
  })
})

// ── compareSizes — pure function tests ───────────────────────────

describe('compareSizes', () => {
  const sortIt = (arr: string[]) => [...arr].sort(compareSizes)

  it('numerische Größen: aufsteigend', () => {
    expect(sortIt(['36', '34', '38', '32'])).toEqual(['32', '34', '36', '38'])
  })

  it('Baby-Größen (Monate/Alter als Zahlen)', () => {
    expect(sortIt(['12', '3', '6', '24', '9'])).toEqual(['3', '6', '9', '12', '24'])
  })

  it('Standard Buchstaben-Größen S→M→L→XL', () => {
    expect(sortIt(['XL', 'S', 'L', 'M'])).toEqual(['S', 'M', 'L', 'XL'])
  })

  it('Erweiterte Buchstaben-Größen XXS→3XL', () => {
    expect(sortIt(['3XL', 'XXS', 'XL', 'XS', 'XXL', 'M']))
      .toEqual(['XXS', 'XS', 'M', 'XL', 'XXL', '3XL'])
  })

  it('alternative Schreibweisen (2XL = XXL, 3XL = XXXL)', () => {
    // 2XL und XXL haben den gleichen Rang, sollten lokal stabil bleiben
    const result = sortIt(['3XL', 'XXL', 'XL', '2XL'])
    expect(result.indexOf('XL')).toBeLessThan(result.indexOf('XXL'))
    expect(result.indexOf('XXL')).toBeLessThan(result.indexOf('3XL'))
  })

  it('numerisch + Buchstaben gemischt: Zahlen zuerst', () => {
    expect(sortIt(['L', '34', 'M', '36', 'XL'])).toEqual(['34', '36', 'M', 'L', 'XL'])
  })

  it('unbekannte Labels (Typos, Custom): alphabetisch ans Ende', () => {
    expect(sortIt(['XL', 'M', 'OneSize', 'L'])).toEqual(['M', 'L', 'XL', 'OneSize'])
  })

  it('case-insensitive für Buchstaben-Größen', () => {
    expect(sortIt(['xl', 'm', 's', 'L'])).toEqual(['s', 'm', 'L', 'xl'])
  })

  it('reproduziert das User-Screenshot-Beispiel korrekt', () => {
    // Screenshot: 2, 3, 34, 3XL, 4XI, L, M, S, XS, XXL (alphabetisch — falsch)
    // (4XI ist im Original ein Typo für 4XL, kommt als unbekanntes Label ans Ende)
    const input = ['2', '3', '34', '3XL', '4XI', 'L', 'M', 'S', 'XS', 'XXL']
    expect(sortIt(input)).toEqual([
      '2', '3', '34',                    // Zahlen aufsteigend
      'XS', 'S', 'M', 'L', 'XXL', '3XL', // Buchstaben in Reihenfolge
      '4XI',                              // Typo → ans Ende
    ])
  })

  it('leeres Array', () => {
    expect(sortIt([])).toEqual([])
  })

  it('ein Element', () => {
    expect(sortIt(['M'])).toEqual(['M'])
  })
})
