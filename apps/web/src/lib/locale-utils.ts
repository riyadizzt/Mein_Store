/**
 * Central locale utilities for admin dashboard.
 * Colors, categories, movement types — always in the admin's language.
 * Numbers always Latin (0-9), never Arabic numerals (١٢٣).
 */

// ── Color translations ────────────────────────────────────
const COLOR_MAP: Record<string, Record<string, string>> = {
  Schwarz:  { de: 'Schwarz',  en: 'Black',   ar: 'أسود' },
  Weiß:     { de: 'Weiß',     en: 'White',   ar: 'أبيض' },
  Blau:     { de: 'Blau',     en: 'Blue',    ar: 'أزرق' },
  Rot:      { de: 'Rot',      en: 'Red',     ar: 'أحمر' },
  Grün:     { de: 'Grün',     en: 'Green',   ar: 'أخضر' },
  Grau:     { de: 'Grau',     en: 'Gray',    ar: 'رمادي' },
  Beige:    { de: 'Beige',    en: 'Beige',   ar: 'بيج' },
  Navy:     { de: 'Navy',     en: 'Navy',    ar: 'كحلي' },
  Braun:    { de: 'Braun',    en: 'Brown',   ar: 'بني' },
  Rosa:     { de: 'Rosa',     en: 'Pink',    ar: 'وردي' },
  Gelb:     { de: 'Gelb',     en: 'Yellow',  ar: 'أصفر' },
  Orange:   { de: 'Orange',   en: 'Orange',  ar: 'برتقالي' },
  Lila:     { de: 'Lila',     en: 'Purple',  ar: 'بنفسجي' },
  Türkis:   { de: 'Türkis',   en: 'Turquoise', ar: 'فيروزي' },
  Bordeaux: { de: 'Bordeaux', en: 'Burgundy', ar: 'خمري' },
  Khaki:    { de: 'Khaki',    en: 'Khaki',   ar: 'كاكي' },
  Silber:   { de: 'Silber',   en: 'Silver',  ar: 'فضي' },
  Gold:     { de: 'Gold',     en: 'Gold',    ar: 'ذهبي' },
  // Extended German shade keys
  Anthrazit:  { de: 'Anthrazit',  en: 'Anthracite', ar: 'فحمي' },
  Hellblau:   { de: 'Hellblau',   en: 'Light Blue', ar: 'أزرق فاتح' },
  Dunkelblau: { de: 'Dunkelblau', en: 'Dark Blue',  ar: 'أزرق داكن' },
  Dunkelgrau: { de: 'Dunkelgrau', en: 'Dark Gray',  ar: 'رمادي داكن' },
  Hellgrau:   { de: 'Hellgrau',   en: 'Light Gray', ar: 'رمادي فاتح' },
  Dunkelgrün: { de: 'Dunkelgrün', en: 'Dark Green', ar: 'أخضر داكن' },
  Hellgrün:   { de: 'Hellgrün',   en: 'Light Green', ar: 'أخضر فاتح' },
  Creme:      { de: 'Creme',      en: 'Cream',      ar: 'كريمي' },
  Mint:       { de: 'Mint',       en: 'Mint',       ar: 'نعناعي' },
  Olive:      { de: 'Olive',      en: 'Olive',      ar: 'زيتوني' },
  Senf:       { de: 'Senf',       en: 'Mustard',    ar: 'خردلي' },
  Koralle:    { de: 'Koralle',    en: 'Coral',      ar: 'مرجاني' },
  // English keys (for data stored in English)
  Black:    { de: 'Schwarz',  en: 'Black',   ar: 'أسود' },
  White:    { de: 'Weiß',     en: 'White',   ar: 'أبيض' },
  Blue:     { de: 'Blau',     en: 'Blue',    ar: 'أزرق' },
  Red:      { de: 'Rot',      en: 'Red',     ar: 'أحمر' },
  Green:    { de: 'Grün',     en: 'Green',   ar: 'أخضر' },
  Gray:     { de: 'Grau',     en: 'Gray',    ar: 'رمادي' },
  Brown:    { de: 'Braun',    en: 'Brown',   ar: 'بني' },
  Pink:     { de: 'Rosa',     en: 'Pink',    ar: 'وردي' },
  Yellow:   { de: 'Gelb',     en: 'Yellow',  ar: 'أصفر' },
  Purple:   { de: 'Lila',     en: 'Purple',  ar: 'بنفسجي' },
  // Arabic keys (for data that was stored in Arabic — rare, legacy)
  أسود:     { de: 'Schwarz',  en: 'Black',   ar: 'أسود' },
  اسود:     { de: 'Schwarz',  en: 'Black',   ar: 'أسود' },  // without hamza (legacy)
  أبيض:     { de: 'Weiß',     en: 'White',   ar: 'أبيض' },
  ابيض:     { de: 'Weiß',     en: 'White',   ar: 'أبيض' },
  أحمر:     { de: 'Rot',      en: 'Red',     ar: 'أحمر' },
  احمر:     { de: 'Rot',      en: 'Red',     ar: 'أحمر' },
  أخضر:     { de: 'Grün',     en: 'Green',   ar: 'أخضر' },
  أزرق:     { de: 'Blau',     en: 'Blue',    ar: 'أزرق' },
  بنفسجي:   { de: 'Lila',     en: 'Purple',  ar: 'بنفسجي' },
  // Typos / variant spellings — map to canonical
  BLUn:     { de: 'Blau',     en: 'Blue',    ar: 'أزرق' },
}

export function translateColor(color: string | null | undefined, locale: string): string {
  if (!color) return ''
  const entry = COLOR_MAP[color]
  if (entry) return entry[locale] ?? entry.de ?? color
  return color
}

// ── Movement type translations ────────────────────────────
const MOVEMENT_MAP: Record<string, Record<string, string>> = {
  purchase_received:    { de: 'Wareneingang',         en: 'Goods received',       ar: 'استلام بضاعة' },
  supplier_delivery:    { de: 'Wareneingang (Lieferant)', en: 'Supplier delivery', ar: 'استلام من مورد' },
  sale_online:          { de: 'Online-Verkauf',      en: 'Online sale',          ar: 'بيع أونلاين' },
  sale_pos:             { de: 'Ladenverkauf',        en: 'POS sale',             ar: 'بيع في المتجر' },
  sale_social:          { de: 'Social-Media-Verkauf', en: 'Social media sale',   ar: 'بيع عبر التواصل' },
  return_received:      { de: 'Retoure erhalten',    en: 'Return received',      ar: 'استلام مرتجع' },
  stocktake_adjustment: { de: 'Inventur-Korrektur',  en: 'Stocktake adjustment', ar: 'تعديل جرد' },
  transfer:             { de: 'Transfer',            en: 'Transfer',             ar: 'نقل' },
  damaged:              { de: 'Beschädigt',          en: 'Damaged',              ar: 'تالف' },
  expired:              { de: 'Abgelaufen',          en: 'Expired',              ar: 'منتهي الصلاحية' },
  reserved:             { de: 'Reserviert',          en: 'Reserved',             ar: 'محجوز' },
  released:             { de: 'Freigegeben',         en: 'Released',             ar: 'تم الإفراج' },
  cancelled:            { de: 'Storniert',           en: 'Cancelled',            ar: 'ملغي' },
}

export function translateMovement(type: string | null | undefined, locale: string): string {
  if (!type) return ''
  const entry = MOVEMENT_MAP[type]
  if (entry) return entry[locale] ?? entry.de ?? type
  return type
}

// ── Product name from translations array ──────────────────
export function getProductName(translations: { language: string; name: string }[] | undefined, locale: string): string {
  if (!translations?.length) return ''
  const map: Record<string, string> = {}
  for (const t of translations) map[t.language] = t.name
  return map[locale] ?? map.de ?? map.en ?? ''
}

// ── Category name from translations array ─────────────────
export function getCategoryName(category: any, locale: string): string {
  if (!category) return '—'
  const ts = category.translations ?? []
  const map: Record<string, string> = {}
  for (const t of ts) map[t.language] = t.name
  return map[locale] ?? map.de ?? map.en ?? '—'
}

// ── Numbers: ALWAYS Latin digits ──────────────────────────
// When locale is 'ar', Intl.NumberFormat uses Arabic-Indic digits (١٢٣).
// We force Latin (123) by using 'en' locale for number formatting.

export function formatNumber(n: number, locale: string): string {
  // Always use a locale that produces Latin digits
  const safeLocale = locale === 'ar' ? 'en-US' : locale === 'de' ? 'de-DE' : 'en-US'
  return new Intl.NumberFormat(safeLocale).format(n)
}

export function formatCurrency(amount: number, locale: string, currency = 'EUR'): string {
  // For Arabic: use 'ar-EG' but force Latin digits via numberingSystem
  if (locale === 'ar') {
    return new Intl.NumberFormat('ar-EG-u-nu-latn', { style: 'currency', currency }).format(amount)
  }
  const safeLocale = locale === 'de' ? 'de-DE' : 'en-US'
  return new Intl.NumberFormat(safeLocale, { style: 'currency', currency }).format(amount)
}

export function formatDate(date: string | null, locale: string): string {
  if (!date) return '—'
  if (locale === 'ar') {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(date))
  }
  const safeLocale = locale === 'de' ? 'de-DE' : 'en-GB'
  return new Intl.DateTimeFormat(safeLocale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(date))
}

// Same as formatDate but prefixes the long weekday name. Used by the
// admin orders + shipments list day-group headers. Arabic still uses
// Latin numerals for the date portion (project rule), and the weekday
// comes from the natural locale (الثلاثاء, Dienstag, Tuesday).
export function formatDateWithWeekday(date: string | null, locale: string): string {
  if (!date) return '—'
  if (locale === 'ar') {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(date))
  }
  const safeLocale = locale === 'de' ? 'de-DE' : 'en-GB'
  return new Intl.DateTimeFormat(safeLocale, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(date))
}

// Hours + minutes only (e.g. "18:45"). Used by list rows when the
// group header already shows the date — the row only needs the time.
// Latin numerals in Arabic per project rule.
export function formatTime(date: string | null, locale: string): string {
  if (!date) return '—'
  if (locale === 'ar') {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(date))
  }
  const safeLocale = locale === 'de' ? 'de-DE' : 'en-GB'
  return new Intl.DateTimeFormat(safeLocale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(date))
}

export function formatDateTime(date: string | null, locale: string): string {
  if (!date) return '—'
  if (locale === 'ar') {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date))
  }
  const safeLocale = locale === 'de' ? 'de-DE' : 'en-GB'
  return new Intl.DateTimeFormat(safeLocale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date))
}

export function formatShortDate(date: string | null, locale: string): string {
  if (!date) return '—'
  if (locale === 'ar') {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: '2-digit', month: '2-digit' }).format(new Date(date))
  }
  const safeLocale = locale === 'de' ? 'de-DE' : 'en-GB'
  return new Intl.DateTimeFormat(safeLocale, { day: '2-digit', month: '2-digit' }).format(new Date(date))
}
