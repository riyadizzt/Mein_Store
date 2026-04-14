import * as Handlebars from 'handlebars'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  const templatePath = path.join(
    __dirname,
    '..',
    'src',
    'modules',
    'email',
    'templates',
    'de',
    'email-verification.hbs',
  )
  const source = fs.readFileSync(templatePath, 'utf-8')
  const template = Handlebars.compile(source)

  const verifyToken = '77a54d30-235c-4d8d-bd7c-3055c4149da8'
  const verificationUrl = `http://localhost:3000/de/auth/verify-email?token=${verifyToken}`
  const data = { firstName: 'rfg', verificationUrl, expiresIn: '24 Stunden' }

  const rendered = template(data)

  console.log('── Rendered HTML (just the template, no layout) ──\n')
  console.log(rendered)
  console.log('\n── Extracted href ──')
  const hrefMatch = rendered.match(/href="([^"]+)"/)
  if (hrefMatch) {
    console.log(`  ${hrefMatch[1]}`)
    console.log(`  has token query? ${hrefMatch[1].includes('token=')}`)
  } else {
    console.log('  ❌ NO href found!')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
