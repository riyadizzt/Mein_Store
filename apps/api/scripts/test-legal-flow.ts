/**
 * Verify the full legal-content flow end-to-end:
 *   1. Write test value to shop_settings.impressum_de
 *   2. Fetch /api/v1/settings/public via HTTP
 *   3. Assert the value comes back in legal.impressum.de
 *   4. Simulate what the shop legal page does (fetchLegalContent + renderLegalAsHtml)
 *   5. Restore original value (or empty if none existed)
 *
 * Non-destructive: saves original value before overwriting, restores at the end.
 * Safe to run against live DB.
 */

import { PrismaClient } from '@prisma/client'

const API_URL = process.env.TEST_API_URL || 'http://localhost:3001'
const prisma = new PrismaClient()

const TEST_MARKER = '__LEGAL_FLOW_TEST_2026__'
const TEST_CONTENT = `# Test-Impressum\n\nDies ist ein automatisierter End-to-End-Test.\n${TEST_MARKER}\n\nMalak Bekleidung\nPannierstr. 4\n12047 Berlin`

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  LEGAL CONTENT FLOW — End-to-End Test')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`  API URL: ${API_URL}`)
  console.log()

  // 1. Save original value (or null)
  const original = await prisma.shopSetting.findUnique({ where: { key: 'impressum_de' } })
  const hadOriginal = !!original
  const originalValue = original?.value ?? ''
  console.log(`  [1/5] Original impressum_de: ${hadOriginal ? `${originalValue.length} chars` : 'MISSING'}`)

  try {
    // 2. Write test content
    await prisma.shopSetting.upsert({
      where: { key: 'impressum_de' },
      create: { key: 'impressum_de', value: TEST_CONTENT },
      update: { value: TEST_CONTENT },
    })
    console.log(`  [2/5] Wrote test content (${TEST_CONTENT.length} chars) to impressum_de`)

    // 3. Fetch /settings/public via HTTP
    const res = await fetch(`${API_URL}/api/v1/settings/public?_ts=${Date.now()}`)
    if (!res.ok) {
      throw new Error(`GET /settings/public → HTTP ${res.status}`)
    }
    const settings: any = await res.json()
    const returned: string = settings?.legal?.impressum?.de ?? ''
    console.log(`  [3/5] API returned legal.impressum.de: ${returned.length} chars`)

    if (!returned.includes(TEST_MARKER)) {
      throw new Error(`MISMATCH: /settings/public did not return test content with marker ${TEST_MARKER}`)
    }
    console.log(`        ✓ Marker ${TEST_MARKER} found in response`)

    // 4. Simulate shop render (same as legal-content.ts)
    const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/
    const simulateRender = (raw: string) => {
      const content = raw.trim()
      if (!content) return ''
      if (HTML_TAG_RE.test(content)) return content
      const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
          return `<p>${lines.map(escape).join('<br />')}</p>`
        })
        .join('\n')
    }
    const html = simulateRender(returned)
    console.log(`  [4/5] Rendered HTML: ${html.length} chars`)
    if (!html.includes('<h1>Test-Impressum</h1>')) {
      throw new Error(`RENDER FAIL: expected <h1>Test-Impressum</h1> not in: ${html.slice(0, 200)}`)
    }
    if (!html.includes(TEST_MARKER)) {
      throw new Error(`RENDER FAIL: marker lost during render`)
    }
    console.log(`        ✓ <h1> rendered from markdown #`)
    console.log(`        ✓ Marker preserved in HTML`)

    console.log()
    console.log('✅ FLOW WORKS — Admin write → DB → API → Shop render chain verified')
  } catch (e: any) {
    console.error()
    console.error('❌ FLOW BROKEN:', e.message)
    process.exitCode = 1
  } finally {
    // 5. Restore
    if (hadOriginal) {
      await prisma.shopSetting.update({
        where: { key: 'impressum_de' },
        data: { value: originalValue },
      })
      console.log(`  [5/5] Restored original impressum_de (${originalValue.length} chars)`)
    } else {
      await prisma.shopSetting.delete({ where: { key: 'impressum_de' } }).catch(() => {})
      console.log(`  [5/5] Removed test row (original did not exist)`)
    }
    await prisma.$disconnect()
  }
}

main()
