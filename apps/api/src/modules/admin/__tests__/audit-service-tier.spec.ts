/**
 * AuditService — tier classification (C15.1) unit tests.
 *
 * Pins down:
 *   1. determineAuditTier — pure-function happy paths for all 3 tiers.
 *   2. Set membership wins — caller-override CANNOT downgrade financial
 *      to operational/ephemeral or upgrade ephemeral past Set.
 *   3. Caller-override CAN upgrade an unlisted action to financial
 *      (only path where override has effect).
 *   4. AuditService.log() persists the tier.
 *   5. FINANCIAL_ACTIONS + EPHEMERAL_ACTIONS Sets contain expected
 *      action-keys (regression guard against accidental deletions).
 *   6. The two Sets are DISJOINT (no action in both).
 */

import 'reflect-metadata'
import {
  AuditService,
  determineAuditTier,
  FINANCIAL_ACTIONS,
  EPHEMERAL_ACTIONS,
} from '../services/audit.service'

describe('determineAuditTier (C15.1 pure function)', () => {
  it('action in FINANCIAL_ACTIONS → tier=financial', () => {
    expect(determineAuditTier('INVOICE_CREATED')).toBe('financial')
    expect(determineAuditTier('REFUND_COMPLETED')).toBe('financial')
    expect(determineAuditTier('AUDIT_ARCHIVE_COMPLETED')).toBe('financial')
  })

  it('action in EPHEMERAL_ACTIONS → tier=ephemeral', () => {
    expect(determineAuditTier('EBAY_ACCOUNT_DELETION_RECEIVED')).toBe('ephemeral')
    expect(determineAuditTier('EBAY_WEBHOOK_DUPLICATE')).toBe('ephemeral')
  })

  it('unlisted action with no override → tier=operational (default)', () => {
    expect(determineAuditTier('PRODUCT_UPDATED')).toBe('operational')
    expect(determineAuditTier('USER_BLOCKED')).toBe('operational')
    expect(determineAuditTier('SOMETHING_NEVER_SEEN_BEFORE')).toBe('operational')
  })

  it('Set wins: caller-override CANNOT downgrade financial → operational', () => {
    expect(
      determineAuditTier('INVOICE_CREATED', 'operational'),
    ).toBe('financial')
  })

  it('Set wins: caller-override CANNOT downgrade financial → ephemeral', () => {
    expect(
      determineAuditTier('REFUND_COMPLETED', 'ephemeral'),
    ).toBe('financial')
  })

  it('Set wins: caller-override CANNOT change ephemeral → financial', () => {
    expect(
      determineAuditTier('EBAY_ACCOUNT_DELETION_RECEIVED', 'financial'),
    ).toBe('ephemeral')
  })

  it('Set wins: caller-override CANNOT change ephemeral → operational', () => {
    expect(
      determineAuditTier('EBAY_WEBHOOK_DUPLICATE', 'operational'),
    ).toBe('ephemeral')
  })

  it('caller-override CAN upgrade unlisted action to financial', () => {
    expect(
      determineAuditTier('LEGACY_OPERATIONAL_EVENT', 'financial'),
    ).toBe('financial')
  })

  it('caller-override CAN downgrade unlisted action to ephemeral', () => {
    // Useful for future spam-events the dev wants ephemeral-classified
    // before adding to the Set (PR-time discipline).
    expect(
      determineAuditTier('LEGACY_NOISY_EVENT', 'ephemeral'),
    ).toBe('ephemeral')
  })
})

describe('FINANCIAL_ACTIONS + EPHEMERAL_ACTIONS — invariants', () => {
  it('FINANCIAL_ACTIONS is non-empty', () => {
    expect(FINANCIAL_ACTIONS.size).toBeGreaterThan(0)
  })

  it('EPHEMERAL_ACTIONS is non-empty', () => {
    expect(EPHEMERAL_ACTIONS.size).toBeGreaterThan(0)
  })

  it('FINANCIAL_ACTIONS and EPHEMERAL_ACTIONS are DISJOINT', () => {
    for (const a of FINANCIAL_ACTIONS) {
      expect(EPHEMERAL_ACTIONS.has(a)).toBe(false)
    }
    for (const a of EPHEMERAL_ACTIONS) {
      expect(FINANCIAL_ACTIONS.has(a)).toBe(false)
    }
  })

  it('FINANCIAL_ACTIONS contains the documented invoice + refund + payment + cancel set', () => {
    // Regression guard against accidental deletion.
    const required = [
      'INVOICE_CREATED',
      'INVOICE_GENERATED',
      'MARKETPLACE_INVOICE_GENERATED',
      'CREDIT_NOTE_GENERATED',
      'PAYMENT_CREATED',
      'PAYMENT_CAPTURED',
      'PAYMENT_DISPUTED',
      'REFUND_INITIATED',
      'REFUND_COMPLETED',
      'REFUND_FAILED',
      'EBAY_REFUND_COMPLETED',
      'EBAY_REFUND_FAILED',
      'EBAY_REFUND_PENDING_48H',
      'EBAY_REFUND_MANUALLY_CONFIRMED',
      'VORKASSE_REFUND_CONFIRMED',
      'ORDER_CANCELLED_POST_PAYMENT',
      'RETURN_REFUNDED',
      'RETURN_REFUND_FAILED',
      'PAYMENT_TIMEOUT_REFUNDED',
      'AUDIT_ARCHIVE_COMPLETED',
      'AUDIT_ARCHIVE_FAILED',
    ]
    for (const a of required) {
      expect(FINANCIAL_ACTIONS.has(a)).toBe(true)
    }
  })

  it('EPHEMERAL_ACTIONS contains EBAY_ACCOUNT_DELETION_RECEIVED + EBAY_WEBHOOK_DUPLICATE', () => {
    expect(EPHEMERAL_ACTIONS.has('EBAY_ACCOUNT_DELETION_RECEIVED')).toBe(true)
    expect(EPHEMERAL_ACTIONS.has('EBAY_WEBHOOK_DUPLICATE')).toBe(true)
  })

  it('ORDER_CANCELLED_PRE_PAYMENT is NOT financial (operational — no money moved)', () => {
    // Owner-decision Q-1: pre-payment cancels are operational.
    expect(FINANCIAL_ACTIONS.has('ORDER_CANCELLED_PRE_PAYMENT')).toBe(false)
    expect(EPHEMERAL_ACTIONS.has('ORDER_CANCELLED_PRE_PAYMENT')).toBe(false)
    expect(determineAuditTier('ORDER_CANCELLED_PRE_PAYMENT')).toBe('operational')
  })
})

describe('AuditService.log() — persists tier', () => {
  function makeSvc(): { svc: AuditService; created: any[] } {
    const created: any[] = []
    const prisma = {
      adminAuditLog: {
        create: jest.fn(({ data }: any) => {
          created.push(data)
          return Promise.resolve({ id: 'gen-id', ...data })
        }),
      },
    }
    return { svc: new AuditService(prisma as any), created }
  }

  it('persists tier=financial for INVOICE_CREATED', async () => {
    const { svc, created } = makeSvc()
    await svc.log({
      adminId: 'system',
      action: 'INVOICE_CREATED',
      entityType: 'invoice',
    })
    expect(created[0].tier).toBe('financial')
  })

  it('persists tier=ephemeral for EBAY_ACCOUNT_DELETION_RECEIVED', async () => {
    const { svc, created } = makeSvc()
    await svc.log({
      adminId: 'system',
      action: 'EBAY_ACCOUNT_DELETION_RECEIVED',
      entityType: 'ebay_deletion_notification',
    })
    expect(created[0].tier).toBe('ephemeral')
  })

  it('persists default tier=operational for unlisted action', async () => {
    const { svc, created } = makeSvc()
    await svc.log({
      adminId: 'system',
      action: 'PRODUCT_UPDATED',
      entityType: 'product',
    })
    expect(created[0].tier).toBe('operational')
  })

  it('caller-override IGNORED for financial actions (Set wins)', async () => {
    const { svc, created } = makeSvc()
    await svc.log({
      adminId: 'system',
      action: 'REFUND_COMPLETED',
      entityType: 'refund',
      tier: 'operational',
    })
    expect(created[0].tier).toBe('financial')
  })

  it('caller-override APPLIED for unlisted action (upgrade legacy event)', async () => {
    const { svc, created } = makeSvc()
    await svc.log({
      adminId: 'system',
      action: 'LEGACY_THING',
      entityType: 'misc',
      tier: 'financial',
    })
    expect(created[0].tier).toBe('financial')
  })
})
