/**
 * Smoke test for the Vorkasse instructions email.
 *
 * Boots a standalone Nest app context, resolves EmailService, and
 * renders the vorkasse-instructions template in all 3 languages
 * against a synthetic payload. Verifies the template files load,
 * Handlebars compiles cleanly, and the rendered HTML contains the
 * key fields (IBAN, BIC, order number, amount, due date).
 *
 * Does NOT actually send any email — only renders. Safe to run
 * against production without spamming customers.
 */

import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { EmailService } from '../src/modules/email/email.service'

type R = { name: string; status: 'PASS' | 'FAIL'; note?: string }
const results: R[] = []
const pass = (n: string, note?: string) => {
  results.push({ name: n, status: 'PASS', note })
  console.log(`  ✅ ${n}${note ? ` — ${note}` : ''}`)
}
const fail = (n: string, note: string) => {
  results.push({ name: n, status: 'FAIL', note })
  console.log(`  ❌ ${n} — ${note}`)
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  VORKASSE INSTRUCTIONS EMAIL — render smoke test')
  console.log('═══════════════════════════════════════════════════════════\n')

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  })
  const emailService = app.get(EmailService)

  const payload = {
    firstName: 'Test Kunde',
    orderNumber: 'ORD-20260414-000999',
    orderDate: '14.04.2026',
    total: '100.00',
    currency: 'EUR',
    accountHolder: 'Malak Bekleidung GmbH',
    iban: 'DE89 3704 0044 0532 0130 00',
    bic: 'COBADEFFXXX',
    bankName: 'Commerzbank',
    paymentDeadlineDays: 7,
    paymentDueDate: '21.04.2026',
    appUrl: 'https://malak-bekleidung.com',
  }

  for (const lang of ['de', 'en', 'ar'] as const) {
    console.log(`\n── ${lang.toUpperCase()} render ──`)
    try {
      const rendered = emailService.renderEmail('vorkasse-instructions' as any, lang, payload)
      if (!rendered.html || rendered.html.length < 500) {
        fail(`${lang}: HTML length`, `got ${rendered.html?.length ?? 0} chars`)
        continue
      }
      pass(`${lang}: template renders`, `${rendered.html.length} chars`)

      // Subject must exist and contain the order number placeholder replacement
      if (!rendered.subject || !rendered.subject.includes('ORD-20260414-000999')) {
        fail(`${lang}: subject`, `got "${rendered.subject}"`)
      } else {
        pass(`${lang}: subject has orderNumber`, rendered.subject)
      }

      // Key content checks: IBAN, BIC, total, due date must appear in HTML
      const mustInclude = [
        { key: 'IBAN', val: 'DE89 3704 0044 0532 0130 00' },
        { key: 'BIC', val: 'COBADEFFXXX' },
        { key: 'Bank', val: 'Commerzbank' },
        { key: 'Holder', val: 'Malak Bekleidung GmbH' },
        { key: 'orderNumber', val: 'ORD-20260414-000999' },
        { key: 'amount', val: '100.00' },
        { key: 'dueDate', val: '21.04.2026' },
        { key: 'deadline days', val: '7' },
      ]
      let allFound = true
      for (const check of mustInclude) {
        if (!rendered.html.includes(check.val)) {
          fail(`${lang}: missing "${check.key}"`, `"${check.val}" not in HTML`)
          allFound = false
        }
      }
      if (allFound) pass(`${lang}: all key fields present`, '8/8 placeholders rendered')

      // Lang-specific sanity checks
      if (lang === 'de' && !rendered.html.includes('Zahlungsinformationen')) {
        fail('de: header text', 'missing "Zahlungsinformationen"')
      }
      if (lang === 'en' && !rendered.html.includes('Payment instructions')) {
        fail('en: header text', 'missing "Payment instructions"')
      }
      if (lang === 'ar' && !rendered.html.includes('تعليمات الدفع')) {
        fail('ar: header text', 'missing "تعليمات الدفع"')
      }
      if (lang === 'ar' && !rendered.html.includes('dir="rtl"')) {
        fail('ar: dir=rtl', 'layout not set to RTL')
      }
    } catch (err) {
      fail(`${lang}: render error`, (err as Error).message)
    }
  }

  await app.close()

  console.log('\n═══════════════════════════════════════════════════════════')
  const p = results.filter((r) => r.status === 'PASS').length
  const f = results.filter((r) => r.status === 'FAIL').length
  console.log(`  RESULT: ${p} passed, ${f} failed`)
  console.log('═══════════════════════════════════════════════════════════')
  process.exit(f > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
