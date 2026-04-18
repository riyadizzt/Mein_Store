/**
 * Smoke-render all 3 email layouts with 3 different social-URL scenarios.
 * Verifies:
 *   - Social row disappears entirely when all 3 URLs empty
 *   - Only configured social icons appear (others hidden individually)
 *   - Klarna/SumUp pills show with new brand colors
 * Pure HTML output, no side effects.
 */
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Handlebars = require('handlebars')

const templatesDir = resolvePath(__dirname, '../src/modules/email/templates')

const SCENARIOS = [
  {
    name: 'A — all 3 URLs set',
    ctx: {
      instagramUrl: 'https://www.instagram.com/bekleidung_malak/',
      facebookUrl: 'https://www.facebook.com/MalakBekleidung',
      tiktokUrl: 'https://www.tiktok.com/@malak_bekleidung',
      hasSocial: '1',
    },
    expect: {
      socialRowPresent: true,
      instagramPresent: true,
      facebookPresent: true,
      tiktokPresent: true,
    },
  },
  {
    name: 'B — only Instagram set',
    ctx: {
      instagramUrl: 'https://www.instagram.com/bekleidung_malak/',
      facebookUrl: '',
      tiktokUrl: '',
      hasSocial: '1',
    },
    expect: {
      socialRowPresent: true,
      instagramPresent: true,
      facebookPresent: false,
      tiktokPresent: false,
    },
  },
  {
    name: 'C — no URLs at all',
    ctx: {
      instagramUrl: '',
      facebookUrl: '',
      tiktokUrl: '',
      hasSocial: '',
    },
    expect: {
      socialRowPresent: false,
      instagramPresent: false,
      facebookPresent: false,
      tiktokPresent: false,
    },
  },
]

const BASE_CTX = {
  subject: 'Test',
  content: '<p>Hello</p>',
  companyName: 'Malak Bekleidung',
  companyAddress: 'Pannierstr. 4, 12047 Berlin',
  companyEmail: 'info@malak-bekleidung.com',
  companyVatId: 'DE327937542',
  currentYear: '2026',
  shopUrl: 'https://malak-bekleidung.com',
  logoUrl: 'https://placehold.co/200x60',
}

function hasSocialRow(html: string): boolean {
  // Look for the distinctive "Social Icons" comment or the full container.
  // We use the icons8 URL pattern as the reliable marker: it only appears
  // if at least one of the 3 social <a> tags was rendered.
  const inst = html.includes('icons8.com/ios-filled/18/ffffff/instagram-new.png')
  const fb = html.includes('icons8.com/ios-filled/18/ffffff/facebook-new.png')
  const tt = html.includes('icons8.com/ios-filled/18/ffffff/tiktok.png')
  return inst || fb || tt
}

let pass = 0
let fail = 0

for (const locale of ['de', 'en', 'ar'] as const) {
  const src = readFileSync(resolvePath(templatesDir, locale, 'layout.hbs'), 'utf8')
  const tpl = Handlebars.compile(src)

  for (const s of SCENARIOS) {
    const html = tpl({ ...BASE_CTX, ...s.ctx })

    const insta = html.includes('icons8.com/ios-filled/18/ffffff/instagram-new.png')
    const fb = html.includes('icons8.com/ios-filled/18/ffffff/facebook-new.png')
    const tt = html.includes('icons8.com/ios-filled/18/ffffff/tiktok.png')
    const row = hasSocialRow(html)

    const cases: Array<[string, boolean, boolean]> = [
      ['social row presence', row, s.expect.socialRowPresent],
      ['instagram', insta, s.expect.instagramPresent],
      ['facebook', fb, s.expect.facebookPresent],
      ['tiktok', tt, s.expect.tiktokPresent],
    ]

    for (const [label, actual, expected] of cases) {
      const ok = actual === expected
      const tag = ok ? '✓' : '✗'
      console.log(`  ${tag} [${locale}] ${s.name} — ${label}: ${actual}${ok ? '' : `  (expected ${expected})`}`)
      if (ok) pass++
      else fail++
    }

    // Klarna + SumUp style check (only for scenario A, just once per locale)
    if (s === SCENARIOS[0]) {
      const klarnaPink = html.includes('background:#FFA8CD') && html.includes('>Klarna<')
      const sumupBlack = html.includes('background:#0f0f0f') && html.includes('>SumUp<')
      console.log(`  ${klarnaPink ? '✓' : '✗'} [${locale}] Klarna pill has brand pink #FFA8CD`)
      console.log(`  ${sumupBlack ? '✓' : '✗'} [${locale}] SumUp pill has brand black #0f0f0f`)
      if (klarnaPink) pass++; else fail++
      if (sumupBlack) pass++; else fail++
    }
  }
}

console.log(`\n═══ ${pass} pass / ${fail} fail ═══\n`)
process.exit(fail === 0 ? 0 : 1)
