/**
 * Static analysis: compare the `allowed` list in updateSettings against
 * the object literal returned by getSettings. Any key present in allowed
 * but missing from the GET response causes the "turns off by itself"
 * regression the admin saw for addressAutocompleteEnabled — the PATCH
 * saves correctly but the GET projects nothing back, so the UI reads
 * `undefined` and falls back to the default.
 *
 * This script parses admin.controller.ts with plain regex (no TypeScript
 * AST) and prints three lists: fields in GET only, fields in allowed
 * only, fields in both. Used to generate the fix + kept as documentation.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const file = join(__dirname, '..', 'src', 'modules', 'admin', 'admin.controller.ts')
const source = readFileSync(file, 'utf-8')

// ── Extract the getSettings return object keys ──
// Match: `async getSettings() { ... return { ... } ... }`
const getMatch = source.match(/async\s+getSettings\s*\(\s*\)[\s\S]*?return\s*\{([\s\S]*?)\n\s*\}\s*\n/)
if (!getMatch) {
  console.error('Could not find getSettings return block')
  process.exit(1)
}
const getBody = getMatch[1]
// Match lines like:  `  keyName: db.keyName ?? '...'`
const getKeys = new Set<string>()
for (const line of getBody.split('\n')) {
  const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/)
  if (m) getKeys.add(m[1])
}

// ── Extract the ADMIN_SETTINGS_WRITABLE_KEYS array ──
const allowedMatch = source.match(/ADMIN_SETTINGS_WRITABLE_KEYS\s*=\s*\[([\s\S]*?)\n\s*\]\s*as\s+const/)
if (!allowedMatch) {
  console.error('Could not find ADMIN_SETTINGS_WRITABLE_KEYS array')
  process.exit(1)
}
const allowedBody = allowedMatch[1]
const allowedKeys = new Set<string>()
for (const token of allowedBody.matchAll(/'([a-zA-Z_][a-zA-Z0-9_]*)'/g)) {
  allowedKeys.add(token[1])
}

// ── Compute diffs ──
const onlyInGet = [...getKeys].filter((k) => !allowedKeys.has(k)).sort()
const onlyInAllowed = [...allowedKeys].filter((k) => !getKeys.has(k)).sort()
const inBoth = [...getKeys].filter((k) => allowedKeys.has(k)).sort()

console.log('═══════════════════════════════════════════════════════════')
console.log('  SETTINGS PROJECTION DIFF')
console.log('═══════════════════════════════════════════════════════════\n')
console.log(`GET response keys:   ${getKeys.size}`)
console.log(`PATCH allowed keys:  ${allowedKeys.size}`)
console.log(`In both:             ${inBoth.length}`)
console.log(`GET-only:            ${onlyInGet.length}  (env-derived / computed)`)
console.log(`allowed-only:        ${onlyInAllowed.length}  ← BROKEN: PATCH saves, GET never returns\n`)

if (onlyInGet.length > 0) {
  console.log('── GET-only keys (read but not writable, usually env-derived) ──')
  for (const k of onlyInGet) console.log(`  ${k}`)
  console.log()
}

if (onlyInAllowed.length > 0) {
  console.log('── allowed-only keys (BROKEN — the parity bug) ──')
  for (const k of onlyInAllowed) console.log(`  ❌ ${k}`)
  console.log()
}

if (onlyInAllowed.length === 0) {
  console.log('✅ parity OK — every writable key is also readable')
  process.exit(0)
} else {
  console.log(`❌ ${onlyInAllowed.length} writable keys are unreadable`)
  process.exit(1)
}
