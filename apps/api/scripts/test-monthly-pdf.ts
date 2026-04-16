import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'

const prisma = new PrismaClient()
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit')

async function main() {
  // Minimal PDF test first
  console.log('Testing pdfkit...')
  const buf = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.font('Helvetica-Bold').fontSize(24).text('TEST PDF', 50, 50)
    doc.end()
  })
  console.log(`Minimal PDF: ${buf.length} bytes`)
  fs.writeFileSync('/tmp/test-minimal.pdf', buf)
  console.log('Saved to /tmp/test-minimal.pdf')

  // Now test the actual service
  console.log('\nTesting FinanceReportsService.generateMonthlyReportPdf...')
  const { FinanceReportsService } = require('../src/modules/admin/services/finance-reports.service')
  const service = new FinanceReportsService(prisma)

  try {
    const pdf = await service.generateMonthlyReportPdf(2026, 4)
    console.log(`Monthly PDF: ${pdf.length} bytes`)
    fs.writeFileSync('/tmp/test-monthly.pdf', pdf)
    console.log('Saved to /tmp/test-monthly.pdf')
    if (pdf.length < 500) {
      console.log('⚠  PDF suspiciously small — content might be empty')
      console.log('First 200 bytes:', pdf.toString('utf8', 0, 200))
    } else {
      console.log('✅ PDF looks good')
    }
  } catch (e: any) {
    console.error('❌ Error generating PDF:', e.message)
    console.error(e.stack)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
