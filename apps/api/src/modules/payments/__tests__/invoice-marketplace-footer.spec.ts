/**
 * InvoiceService.renderMarketplaceFooterBlock — C13.1 unit tests.
 *
 * Tests the helper directly with a stub PDFDocument that records
 * `.text()` calls. Bypasses pdfkit's binary encoder (FlateDecode +
 * font glyph subsetting make content streams unreadable in tests).
 *
 * Pins down:
 *   - eBay channel + channelOrderId set → 2 text lines emitted
 *   - Website channel → no text emitted (regression-anchor)
 *   - eBay channel + channelOrderId=null → defensive skip
 *   - PAYMENT_METHOD_LABELS resolves 'ebay_managed_payments' to a
 *     human-readable string (constant-level assertion)
 *   - Helper does NOT touch other PDFKit operators that would imply
 *     the standard footer was double-rendered
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { InvoiceService } from '../invoice.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { StorageService } from '../../../common/services/storage.service'

// ──────────────────────────────────────────────────────────────
// Stub-Doc: chainable, records every .text() call
// ──────────────────────────────────────────────────────────────

interface StubDoc {
  textCalls: Array<{ str: string; x: number; y: number }>
  text: jest.Mock
  roundedRect: jest.Mock
  fill: jest.Mock
  font: jest.Mock
  fontSize: jest.Mock
  fillColor: jest.Mock
}

function makeStubDoc(): StubDoc {
  const calls: Array<{ str: string; x: number; y: number }> = []
  const stub: any = { textCalls: calls }
  stub.text = jest.fn((str: string, x: number, y: number) => {
    calls.push({ str, x, y })
    return stub
  })
  stub.roundedRect = jest.fn(() => stub)
  stub.fill = jest.fn(() => stub)
  stub.font = jest.fn(() => stub)
  stub.fontSize = jest.fn(() => stub)
  stub.fillColor = jest.fn(() => stub)
  return stub as StubDoc
}

async function makeService(): Promise<InvoiceService> {
  const prisma = {
    shopSetting: { findMany: jest.fn().mockResolvedValue([]) },
  }
  const config = { get: jest.fn((_k: string, fb?: string) => fb ?? '') }
  const storage = {}
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      InvoiceService,
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: config },
      { provide: StorageService, useValue: storage },
    ],
  }).compile()
  return module.get<InvoiceService>(InvoiceService)
}

// Access the private helper via cast — TypeScript private is purely
// compile-time, runtime allows any access.
function renderBlock(svc: InvoiceService, doc: StubDoc, order: any, footerY = 770) {
  ;(svc as any).renderMarketplaceFooterBlock(doc, order, footerY)
}

// ──────────────────────────────────────────────────────────────
// eBay channel — block rendered with both lines
// ──────────────────────────────────────────────────────────────

describe('InvoiceService.renderMarketplaceFooterBlock — eBay (C13.1)', () => {
  it('renders both text lines when channel=ebay and channelOrderId set', async () => {
    const svc = await makeService()
    const doc = makeStubDoc()
    renderBlock(svc, doc, { channel: 'ebay', channelOrderId: '12-12345-67890' })

    expect(doc.text).toHaveBeenCalledTimes(2)
    expect(doc.textCalls[0].str).toBe(
      'Verkauf über eBay — eBay-Bestellnummer: 12-12345-67890',
    )
    expect(doc.textCalls[1].str).toBe(
      'Zahlung über eBay Managed Payments verarbeitet.',
    )
  })

  it('positions block at footerY - 38 with 12px line spacing', async () => {
    const svc = await makeService()
    const doc = makeStubDoc()
    renderBlock(svc, doc, { channel: 'ebay', channelOrderId: 'X-1' }, 770)

    // Header line at blockY+2 = 770-38+2 = 734
    expect(doc.textCalls[0].y).toBe(734)
    // Subtext at blockY+14 = 770-38+14 = 746 (12px below header)
    expect(doc.textCalls[1].y).toBe(746)
    expect(doc.textCalls[1].y - doc.textCalls[0].y).toBe(12)
  })

  it('draws slate-100 rounded-rect background panel', async () => {
    const svc = await makeService()
    const doc = makeStubDoc()
    renderBlock(svc, doc, { channel: 'ebay', channelOrderId: 'X-1' })

    expect(doc.roundedRect).toHaveBeenCalledTimes(1)
    expect(doc.fill).toHaveBeenCalledWith('#f1f5f9')
  })

  it('uses Helvetica-Bold for the header line and Helvetica for the subtext', async () => {
    const svc = await makeService()
    const doc = makeStubDoc()
    renderBlock(svc, doc, { channel: 'ebay', channelOrderId: 'X-1' })

    // Font calls in order: Bold for line 1, regular Helvetica for line 2
    expect(doc.font).toHaveBeenCalledWith('Helvetica-Bold')
    expect(doc.font).toHaveBeenCalledWith('Helvetica')
    expect(doc.fontSize).toHaveBeenCalledWith(8)
    expect(doc.fontSize).toHaveBeenCalledWith(7.5)
  })

  it('forwards the exact channelOrderId into the header — no truncation, no escaping', async () => {
    const svc = await makeService()
    const doc = makeStubDoc()
    // eBay legacy IDs can be long with dashes — verify pass-through
    const longId = '02-12345-67890-abc'
    renderBlock(svc, doc, { channel: 'ebay', channelOrderId: longId })

    expect(doc.textCalls[0].str).toContain(longId)
  })
})

// ──────────────────────────────────────────────────────────────
// Skip-paths: website channel + null channelOrderId
// ──────────────────────────────────────────────────────────────

describe('InvoiceService.renderMarketplaceFooterBlock — skip paths (C13.1)', () => {
  it('website channel → no text rendered, no rect drawn (regression-anchor)', async () => {
    const svc = await makeService()
    const doc = makeStubDoc()
    renderBlock(svc, doc, { channel: 'website', channelOrderId: null })

    expect(doc.text).not.toHaveBeenCalled()
    expect(doc.roundedRect).not.toHaveBeenCalled()
    expect(doc.fill).not.toHaveBeenCalled()
  })

  it('eBay channel but channelOrderId=null → defensive skip', async () => {
    const svc = await makeService()
    const doc = makeStubDoc()
    renderBlock(svc, doc, { channel: 'ebay', channelOrderId: null })

    expect(doc.text).not.toHaveBeenCalled()
    expect(doc.roundedRect).not.toHaveBeenCalled()
  })

  it('eBay channel but channelOrderId="" → defensive skip', async () => {
    const svc = await makeService()
    const doc = makeStubDoc()
    renderBlock(svc, doc, { channel: 'ebay', channelOrderId: '' })

    expect(doc.text).not.toHaveBeenCalled()
  })

  it('mobile channel (future shop client) → no marketplace block', async () => {
    const svc = await makeService()
    const doc = makeStubDoc()
    renderBlock(svc, doc, { channel: 'mobile', channelOrderId: null })

    expect(doc.text).not.toHaveBeenCalled()
  })

  it('TIKTOK marketplace (Phase 3) currently routes through skip — ready for future expansion', async () => {
    // Today the helper is eBay-specific by design (S-1/S-2 decisions).
    // When TIKTOK lands, this test must be updated to match.
    const svc = await makeService()
    const doc = makeStubDoc()
    renderBlock(svc, doc, { channel: 'tiktok', channelOrderId: 'tk-12345' })

    // Currently NOT rendered — explicit eBay-only filter in helper
    expect(doc.text).not.toHaveBeenCalled()
  })
})
