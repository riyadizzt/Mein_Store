/**
 * Install legal content (AGB + Widerruf) from legal-templates/*.md into
 * the shop_settings table.
 *
 * Usage:
 *   cd apps/api
 *   npx ts-node scripts/install-legal-content.ts --dry-run    # Preview only
 *   npx ts-node scripts/install-legal-content.ts              # Write to DB
 *
 * Reads 9 files:
 *   - legal-templates/IMPRESSUM_DE.md → shopSetting.impressum_de
 *   - legal-templates/IMPRESSUM_EN.md → shopSetting.impressum_en
 *   - legal-templates/IMPRESSUM_AR.md → shopSetting.impressum_ar
 *   - legal-templates/AGB_DE.md       → shopSetting.agb_de
 *   - legal-templates/AGB_EN.md       → shopSetting.agb_en
 *   - legal-templates/AGB_AR.md       → shopSetting.agb_ar
 *   - legal-templates/WIDERRUF_DE.md  → shopSetting.widerruf_de
 *   - legal-templates/WIDERRUF_EN.md  → shopSetting.widerruf_en
 *   - legal-templates/WIDERRUF_AR.md  → shopSetting.widerruf_ar
 *
 * Safety:
 *   - Aborts if any file contains `[PLATZHALTER` or `[PLACEHOLDER` or
 *     `[تنبيه` unless --force is passed (so you can't accidentally publish
 *     the placeholder version to the live DB before your lawyer has
 *     reviewed it)
 *   - --dry-run prints what would be written without touching the DB
 *   - Does NOT touch impressum_*, datenschutz_*, or any other setting
 */

import { PrismaClient } from '@prisma/client'
import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const prisma = new PrismaClient()

const TEMPLATES_DIR = resolve(__dirname, '..', '..', '..', 'legal-templates')

const MAPPINGS: { file: string; key: string }[] = [
  { file: 'IMPRESSUM_DE.md', key: 'impressum_de' },
  { file: 'IMPRESSUM_EN.md', key: 'impressum_en' },
  { file: 'IMPRESSUM_AR.md', key: 'impressum_ar' },
  { file: 'AGB_DE.md',       key: 'agb_de' },
  { file: 'AGB_EN.md',       key: 'agb_en' },
  { file: 'AGB_AR.md',       key: 'agb_ar' },
  { file: 'WIDERRUF_DE.md',  key: 'widerruf_de' },
  { file: 'WIDERRUF_EN.md',  key: 'widerruf_en' },
  { file: 'WIDERRUF_AR.md',  key: 'widerruf_ar' },
]

const PLACEHOLDER_MARKERS = ['[PLATZHALTER', '[PLACEHOLDER', '[تنبيه']

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const force = args.includes('--force')

  console.log('═══════════════════════════════════════════════════════════')
  console.log('  INSTALL LEGAL CONTENT')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`  Templates dir: ${TEMPLATES_DIR}`)
  console.log(`  Mode:          ${dryRun ? 'DRY-RUN (no DB writes)' : 'LIVE (writing to DB)'}`)
  console.log(`  Force flag:    ${force ? 'ON (placeholders allowed)' : 'OFF (placeholders block)'}`)
  console.log()

  // ── 1. Read all files, check they exist and have content ──
  const loaded: { key: string; content: string; hasPlaceholder: boolean }[] = []
  for (const m of MAPPINGS) {
    const path = join(TEMPLATES_DIR, m.file)
    if (!existsSync(path)) {
      console.error(`❌ Missing file: ${path}`)
      process.exit(1)
    }
    const content = readFileSync(path, 'utf-8').trim()
    if (content.length < 100) {
      console.error(`❌ ${m.file} is too short (${content.length} chars) — looks empty`)
      process.exit(1)
    }
    const hasPlaceholder = PLACEHOLDER_MARKERS.some((marker) => content.includes(marker))
    loaded.push({ key: m.key, content, hasPlaceholder })
  }

  // ── 2. Placeholder check ──
  const withPlaceholders = loaded.filter((l) => l.hasPlaceholder)
  if (withPlaceholders.length > 0) {
    console.log('⚠ The following files still contain placeholder markers:')
    for (const l of withPlaceholders) {
      console.log(`    - ${l.key}  (${PLACEHOLDER_MARKERS.find((m) => l.content.includes(m))} found)`)
    }
    console.log()
    if (!force) {
      console.error('Refusing to install templates with placeholders.')
      console.error('Either replace the placeholders with final lawyer-reviewed text,')
      console.error('or pass --force if you really mean to publish the placeholder version.')
      process.exit(1)
    }
    console.log('  --force passed, proceeding anyway...')
    console.log()
  }

  // ── 3. Preview / write ──
  console.log(`── Summary — ${loaded.length} files to install ──`)
  console.log()
  for (const l of loaded) {
    const preview = l.content.split('\n').slice(0, 2).join(' ').slice(0, 80)
    console.log(`  ${l.key.padEnd(15)}  ${l.content.length.toString().padStart(5, ' ')} chars  |  ${preview}...`)
  }
  console.log()

  if (dryRun) {
    console.log('✅ Dry run complete — no DB writes made.')
    console.log('   Re-run without --dry-run to actually install.')
    await prisma.$disconnect()
    return
  }

  // ── 4. Actually write ──
  console.log('── Writing to DB ──')
  let written = 0
  for (const l of loaded) {
    await prisma.shopSetting.upsert({
      where: { key: l.key },
      create: { key: l.key, value: l.content },
      update: { value: l.content },
    })
    console.log(`  ✅ ${l.key} — ${l.content.length} chars`)
    written++
  }
  console.log()
  console.log(`✅ Installed ${written} legal settings.`)
  console.log('   Verify on /de/legal/agb and /de/legal/widerruf in the browser.')
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
