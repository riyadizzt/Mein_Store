import { API_BASE_URL } from './env'

export type LegalKey = 'impressum' | 'agb' | 'datenschutz' | 'widerruf'
export type LegalLocale = 'de' | 'en' | 'ar'

type PublicSettings = {
  legal?: Partial<Record<LegalKey, Partial<Record<LegalLocale, string>>>>
}

export async function fetchLegalContent(
  key: LegalKey,
  locale: LegalLocale,
): Promise<string> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/settings/public`, {
      next: { revalidate: 60, tags: ['shop-settings-public'] },
    })
    if (!res.ok) return ''
    const settings = (await res.json()) as PublicSettings
    const bag = settings.legal?.[key]
    if (!bag) return ''
    return (bag[locale] || bag.de || bag.en || bag.ar || '').trim()
  } catch {
    return ''
  }
}

const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/

export function renderLegalAsHtml(raw: string): string {
  const content = raw.trim()
  if (!content) return ''
  if (HTML_TAG_RE.test(content)) return content

  const escape = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

  const blocks = content.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
  return blocks
    .map((block) => {
      const lines = block.split('\n')
      const first = lines[0] || ''

      if (/^#{1,3}\s/.test(first)) {
        const level = first.match(/^(#{1,3})/)?.[1].length ?? 1
        const text = escape(first.replace(/^#{1,3}\s+/, ''))
        const rest = lines.slice(1).map(escape).join('<br />')
        const heading = `<h${level}>${text}</h${level}>`
        return rest ? `${heading}<p>${rest}</p>` : heading
      }

      if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
        const items = lines
          .map((l) => `<li>${escape(l.replace(/^\s*[-•]\s+/, ''))}</li>`)
          .join('')
        return `<ul>${items}</ul>`
      }

      return `<p>${lines.map(escape).join('<br />')}</p>`
    })
    .join('\n')
}
