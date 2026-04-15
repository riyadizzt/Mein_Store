/**
 * Shared color-preset list for all admin pickers.
 *
 * Previously 4 different files each had their own inline PRESET_COLORS:
 *   - apps/web/src/app/[locale]/admin/suppliers/receiving/page.tsx (24 colors, DE/EN/AR)
 *   - apps/web/src/app/[locale]/admin/products/new/page.tsx          (18 colors, DE only)
 *   - apps/web/src/components/admin/add-variant-modals.tsx           (18 colors, DE only)
 *   - apps/web/src/components/admin/product-wizard/step-variants.tsx (18 colors, DE only)
 *
 * The product-side pickers were missing Creme / Rose / Hellblau / Dunkelgrün /
 * Anthrazit / Multicolor, plus their hex values drifted away from the ones the
 * receiving page used. This file is now the single source of truth.
 *
 * The canonical stored name for each color is `name.de` (German) — that's
 * what gets written to variant.color in the database, matching how existing
 * variants were created by the other 3 product pages. The UI label is
 * looked up through `getColorLabel()` based on the viewing admin's locale.
 */

export interface ColorPreset {
  name: { de: string; en: string; ar: string }
  hex: string // real hex like "#DC2626" or the sentinel "multi" for rainbow
}

export const COLOR_PRESETS: ReadonlyArray<ColorPreset> = [
  { name: { de: 'Schwarz',    en: 'Black',      ar: 'أسود' },       hex: '#000000' },
  { name: { de: 'Weiß',       en: 'White',      ar: 'أبيض' },       hex: '#FFFFFF' },
  { name: { de: 'Grau',       en: 'Gray',       ar: 'رمادي' },      hex: '#808080' },
  { name: { de: 'Anthrazit',  en: 'Charcoal',   ar: 'فحمي' },       hex: '#374151' },
  { name: { de: 'Silber',     en: 'Silver',     ar: 'فضي' },        hex: '#C0C0C0' },
  { name: { de: 'Rot',        en: 'Red',        ar: 'أحمر' },       hex: '#DC2626' },
  { name: { de: 'Bordeaux',   en: 'Burgundy',   ar: 'خمري' },       hex: '#722F37' },
  { name: { de: 'Blau',       en: 'Blue',       ar: 'أزرق' },       hex: '#2563EB' },
  { name: { de: 'Navy',       en: 'Navy',       ar: 'كحلي' },       hex: '#1E3A5F' },
  { name: { de: 'Hellblau',   en: 'Light Blue', ar: 'أزرق فاتح' },  hex: '#93C5FD' },
  { name: { de: 'Türkis',     en: 'Turquoise',  ar: 'فيروزي' },     hex: '#06B6D4' },
  { name: { de: 'Grün',       en: 'Green',      ar: 'أخضر' },       hex: '#16A34A' },
  { name: { de: 'Dunkelgrün', en: 'Dark Green', ar: 'أخضر غامق' },  hex: '#14532D' },
  { name: { de: 'Khaki',      en: 'Khaki',      ar: 'كاكي' },       hex: '#BDB76B' },
  { name: { de: 'Gelb',       en: 'Yellow',     ar: 'أصفر' },       hex: '#EAB308' },
  { name: { de: 'Gold',       en: 'Gold',       ar: 'ذهبي' },       hex: '#D4A853' },
  { name: { de: 'Orange',     en: 'Orange',     ar: 'برتقالي' },    hex: '#EA580C' },
  { name: { de: 'Braun',      en: 'Brown',      ar: 'بني' },        hex: '#92400E' },
  { name: { de: 'Beige',      en: 'Beige',      ar: 'بيج' },        hex: '#D2B48C' },
  { name: { de: 'Creme',      en: 'Cream',      ar: 'كريمي' },      hex: '#FFFDD0' },
  { name: { de: 'Rosa',       en: 'Rose',       ar: 'زهري' },       hex: '#F9A8D4' },
  { name: { de: 'Pink',       en: 'Pink',       ar: 'وردي' },       hex: '#EC4899' },
  { name: { de: 'Lila',       en: 'Purple',     ar: 'بنفسجي' },     hex: '#9333EA' },
  { name: { de: 'Multicolor', en: 'Multicolor', ar: 'متعدد' },      hex: 'multi' },
]

/**
 * Look up the label for a stored color name in the given locale.
 * The stored name can be in any of the 3 languages — we match across all
 * fields so a variant saved with `name: 'Schwarz'` still resolves correctly
 * when the admin views in Arabic.
 * Custom colors added at runtime (that are not in the preset list) fall
 * through to their raw stored name.
 */
export function getColorLabel(storedName: string, locale: string): string {
  const preset = findColorPreset(storedName)
  if (!preset) return storedName
  if (locale === 'ar') return preset.name.ar
  if (locale === 'en') return preset.name.en
  return preset.name.de
}

/**
 * Find a preset by any-language match (case-insensitive).
 * Returns undefined for custom / ad-hoc colors the admin typed in.
 */
export function findColorPreset(name: string | null | undefined): ColorPreset | undefined {
  if (!name) return undefined
  const needle = name.trim().toLowerCase()
  return COLOR_PRESETS.find(
    (c) =>
      c.name.de.toLowerCase() === needle ||
      c.name.en.toLowerCase() === needle ||
      c.name.ar === name.trim(), // Arabic is case-insensitive anyway
  )
}

/**
 * CSS style for rendering a color swatch. Handles the special 'multi'
 * sentinel by returning a conic-gradient rainbow.
 */
export function getColorStyle(hex: string): React.CSSProperties {
  if (hex === 'multi') {
    return { background: 'conic-gradient(red, yellow, green, cyan, blue, magenta, red)' }
  }
  return { backgroundColor: hex }
}
