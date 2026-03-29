/**
 * Seed: Abteilungs-Kategorien (Herren, Damen, Mädchen, Jungen)
 *
 * Erstellt 4 Hauptkategorien + Unterkategorien als Kinder.
 * Weist bestehende Produkte den passenden Unterkategorien zu.
 * Setzt das gender-Feld auf allen Produkten.
 *
 * Ausführen: npx ts-node apps/api/prisma/seed-departments.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface SubCat {
  slug: string
  de: string
  en: string
  ar: string
}

const DEPARTMENTS: {
  slug: string
  gender: 'men' | 'women' | 'kids'
  de: string
  en: string
  ar: string
  icon: string
  children: SubCat[]
}[] = [
  {
    slug: 'herren',
    gender: 'men',
    de: 'Herren',
    en: 'Men',
    ar: 'رجال',
    icon: '👔',
    children: [
      { slug: 'herren-pullover', de: 'Pullover & Sweatshirts', en: 'Sweaters & Sweatshirts', ar: 'بلوفرات وسويت شيرت' },
      { slug: 'herren-hemden', de: 'Hemden', en: 'Shirts', ar: 'قمصان' },
      { slug: 'herren-t-shirts', de: 'T-Shirts', en: 'T-Shirts', ar: 'تيشيرتات' },
      { slug: 'herren-hosen', de: 'Hosen', en: 'Pants', ar: 'بنطلونات' },
      { slug: 'herren-shorts', de: 'Shorts', en: 'Shorts', ar: 'شورتات' },
      { slug: 'herren-pyjamas', de: 'Pyjamas', en: 'Pajamas', ar: 'بيجامات' },
      { slug: 'herren-jacken', de: 'Jacken & Mäntel', en: 'Jackets & Coats', ar: 'جاكيتات ومعاطف' },
      { slug: 'herren-unterwaesche', de: 'Unterwäsche', en: 'Underwear', ar: 'ملابس داخلية' },
      { slug: 'herren-schuhe', de: 'Schuhe', en: 'Shoes', ar: 'أحذية' },
      { slug: 'herren-accessoires', de: 'Accessoires', en: 'Accessories', ar: 'إكسسوارات' },
    ],
  },
  {
    slug: 'damen',
    gender: 'women',
    de: 'Damen',
    en: 'Women',
    ar: 'نساء',
    icon: '👗',
    children: [
      { slug: 'damen-kleider', de: 'Kleider', en: 'Dresses', ar: 'فساتين' },
      { slug: 'damen-blusen', de: 'Blusen & Tops', en: 'Blouses & Tops', ar: 'بلوزات وتوبات' },
      { slug: 'damen-roecke', de: 'Röcke', en: 'Skirts', ar: 'تنانير' },
      { slug: 'damen-hosen', de: 'Hosen & Leggings', en: 'Pants & Leggings', ar: 'بنطلونات وليقنز' },
      { slug: 'damen-pullover', de: 'Pullover & Sweatshirts', en: 'Sweaters & Sweatshirts', ar: 'بلوفرات وسويت شيرت' },
      { slug: 'damen-pyjamas', de: 'Pyjamas', en: 'Pajamas', ar: 'بيجامات' },
      { slug: 'damen-jacken', de: 'Jacken & Mäntel', en: 'Jackets & Coats', ar: 'جاكيتات ومعاطف' },
      { slug: 'damen-unterwaesche', de: 'Unterwäsche', en: 'Underwear', ar: 'ملابس داخلية' },
      { slug: 'damen-schuhe', de: 'Schuhe', en: 'Shoes', ar: 'أحذية' },
      { slug: 'damen-accessoires', de: 'Taschen & Accessoires', en: 'Bags & Accessories', ar: 'حقائب وإكسسوارات' },
    ],
  },
  {
    slug: 'maedchen',
    gender: 'kids',
    de: 'Mädchen',
    en: 'Girls',
    ar: 'بنات',
    icon: '👧',
    children: [
      { slug: 'maedchen-kleider', de: 'Kleider', en: 'Dresses', ar: 'فساتين' },
      { slug: 'maedchen-blusen', de: 'Blusen & T-Shirts', en: 'Blouses & T-Shirts', ar: 'بلوزات وتيشيرتات' },
      { slug: 'maedchen-hosen', de: 'Hosen & Leggings', en: 'Pants & Leggings', ar: 'بنطلونات وليقنز' },
      { slug: 'maedchen-pullover', de: 'Pullover', en: 'Sweaters', ar: 'بلوفرات' },
      { slug: 'maedchen-pyjamas', de: 'Pyjamas', en: 'Pajamas', ar: 'بيجامات' },
      { slug: 'maedchen-jacken', de: 'Jacken', en: 'Jackets', ar: 'جاكيتات' },
      { slug: 'maedchen-unterwaesche', de: 'Unterwäsche', en: 'Underwear', ar: 'ملابس داخلية' },
      { slug: 'maedchen-schuhe', de: 'Schuhe', en: 'Shoes', ar: 'أحذية' },
      { slug: 'maedchen-accessoires', de: 'Accessoires', en: 'Accessories', ar: 'إكسسوارات' },
    ],
  },
  {
    slug: 'jungen',
    gender: 'kids',
    de: 'Jungen',
    en: 'Boys',
    ar: 'أولاد',
    icon: '👦',
    children: [
      { slug: 'jungen-t-shirts', de: 'T-Shirts', en: 'T-Shirts', ar: 'تيشيرتات' },
      { slug: 'jungen-hemden', de: 'Hemden', en: 'Shirts', ar: 'قمصان' },
      { slug: 'jungen-hosen', de: 'Hosen', en: 'Pants', ar: 'بنطلونات' },
      { slug: 'jungen-shorts', de: 'Shorts', en: 'Shorts', ar: 'شورتات' },
      { slug: 'jungen-pullover', de: 'Pullover', en: 'Sweaters', ar: 'بلوفرات' },
      { slug: 'jungen-pyjamas', de: 'Pyjamas', en: 'Pajamas', ar: 'بيجامات' },
      { slug: 'jungen-jacken', de: 'Jacken', en: 'Jackets', ar: 'جاكيتات' },
      { slug: 'jungen-unterwaesche', de: 'Unterwäsche', en: 'Underwear', ar: 'ملابس داخلية' },
      { slug: 'jungen-schuhe', de: 'Schuhe', en: 'Shoes', ar: 'أحذية' },
      { slug: 'jungen-accessoires', de: 'Accessoires', en: 'Accessories', ar: 'إكسسوارات' },
    ],
  },
]

// Mapping: old flat category slug → which department + subcategory suffix
const PRODUCT_MAPPING: Record<string, { dept: string; subSuffix: string; gender: 'men' | 'women' | 'kids' }> = {
  'jacken':      { dept: 'herren', subSuffix: 'jacken', gender: 'men' },
  'hosen':       { dept: 'herren', subSuffix: 'hosen', gender: 'men' },
  'hemden':      { dept: 'damen', subSuffix: 'blusen', gender: 'women' },
  'kleider':     { dept: 'damen', subSuffix: 'kleider', gender: 'women' },
  'schuhe':      { dept: 'herren', subSuffix: 'schuhe', gender: 'men' },
  't-shirts':    { dept: 'herren', subSuffix: 't-shirts', gender: 'men' },
  'pullover':    { dept: 'damen', subSuffix: 'pullover', gender: 'women' },
  'accessoires': { dept: 'damen', subSuffix: 'accessoires', gender: 'women' },
  'sportswear':  { dept: 'herren', subSuffix: 'hosen', gender: 'men' },
  'kinder':      { dept: 'maedchen', subSuffix: 'kleider', gender: 'kids' },
}

async function main() {
  console.log('🏬 Abteilungs-Kategorien Seed gestartet...\n')

  // Track new category IDs for product reassignment
  const newCatMap: Record<string, string> = {} // slug → id

  for (const dept of DEPARTMENTS) {
    // Check if department already exists
    const existing = await prisma.category.findUnique({ where: { slug: dept.slug } })
    let parentId: string

    if (existing) {
      parentId = existing.id
      console.log(`  ✓ ${dept.icon} ${dept.de} existiert bereits (${existing.id.slice(0, 8)}...)`)
    } else {
      const parent = await prisma.category.create({
        data: {
          slug: dept.slug,
          sortOrder: DEPARTMENTS.indexOf(dept),
          imageUrl: `https://placehold.co/400x300/1a1a2e/ffffff?text=${encodeURIComponent(dept.de)}`,
          translations: {
            create: [
              { language: 'de', name: dept.de },
              { language: 'en', name: dept.en },
              { language: 'ar', name: dept.ar },
            ],
          },
        },
      })
      parentId = parent.id
      console.log(`  + ${dept.icon} ${dept.de} erstellt (${parent.id.slice(0, 8)}...)`)
    }
    newCatMap[dept.slug] = parentId

    // Create subcategories
    for (let i = 0; i < dept.children.length; i++) {
      const sub = dept.children[i]
      const existingSub = await prisma.category.findUnique({ where: { slug: sub.slug } })
      if (existingSub) {
        newCatMap[sub.slug] = existingSub.id
        continue
      }

      const child = await prisma.category.create({
        data: {
          slug: sub.slug,
          parentId,
          sortOrder: i,
          translations: {
            create: [
              { language: 'de', name: sub.de },
              { language: 'en', name: sub.en },
              { language: 'ar', name: sub.ar },
            ],
          },
        },
      })
      newCatMap[sub.slug] = child.id
    }
    console.log(`    ↳ ${dept.children.length} Unterkategorien`)
  }

  // Reassign products to new subcategories
  console.log('\n📦 Weise Produkte den neuen Abteilungen zu...')

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    include: { category: true },
  })

  let reassigned = 0
  for (const product of products) {
    const oldSlug = product.category?.slug
    if (!oldSlug) continue

    const mapping = PRODUCT_MAPPING[oldSlug]
    if (!mapping) continue

    const newSubSlug = `${mapping.dept}-${mapping.subSuffix}`
    const newCatId = newCatMap[newSubSlug]
    if (!newCatId) continue

    await prisma.product.update({
      where: { id: product.id },
      data: {
        categoryId: newCatId,
        gender: mapping.gender as any,
      },
    })
    reassigned++
  }

  console.log(`  ✓ ${reassigned} Produkte zugewiesen`)

  // Deactivate old flat categories (those without parents that aren't departments)
  const deptSlugs = DEPARTMENTS.map((d) => d.slug)
  const oldCats = await prisma.category.findMany({
    where: {
      parentId: null,
      slug: { notIn: deptSlugs },
    },
  })

  for (const old of oldCats) {
    // Only deactivate if no products still reference it
    const count = await prisma.product.count({ where: { categoryId: old.id, deletedAt: null } })
    if (count === 0) {
      await prisma.category.update({ where: { id: old.id }, data: { isActive: false } })
      console.log(`  ⊘ Alte Kategorie "${old.slug}" deaktiviert`)
    }
  }

  console.log('\n✅ Abteilungs-Seed abgeschlossen!')
  console.log(`   4 Abteilungen, ${DEPARTMENTS.reduce((s, d) => s + d.children.length, 0)} Unterkategorien`)
  console.log(`   ${reassigned} Produkte zugewiesen`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
