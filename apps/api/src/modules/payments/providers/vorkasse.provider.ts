import { Injectable, Logger } from '@nestjs/common'
import * as crypto from 'crypto'
import { PrismaService } from '../../../prisma/prisma.service'
import {
  IPaymentProvider,
  CreatePaymentInput,
  PaymentIntentResult,
  RefundInput,
  RefundResult,
  WebhookVerificationResult,
} from '../payment-provider.interface'

/**
 * Vorkasse (Bank Transfer / Prepayment) Provider
 *
 * No external API calls. The customer sees bank details after checkout
 * and transfers money manually. The admin confirms receipt in the dashboard.
 *
 * Bank details are loaded from ShopSettings (IBAN, BIC, bank name, holder).
 */
@Injectable()
export class VorkasseProvider implements IPaymentProvider {
  readonly providerName = 'VORKASSE'
  private readonly logger = new Logger(VorkasseProvider.name)

  constructor(private readonly prisma: PrismaService) {}

  async createPaymentIntent(input: CreatePaymentInput): Promise<PaymentIntentResult> {
    // No external API call — just generate a reference
    const referenceId = `VK-${input.metadata?.orderNumber ?? input.orderId.slice(0, 8)}`

    this.logger.log(`Vorkasse payment created: ${referenceId} for order ${input.orderId}`)

    return {
      providerPaymentId: referenceId,
      clientSecret: null,
      status: 'pending',
      redirectUrl: undefined,
    }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    // Vorkasse refunds are manual bank transfers — just log it
    this.logger.log(`Vorkasse refund requested: ${input.providerPaymentId} amount=${input.amount}`)

    return {
      providerRefundId: `VK-REFUND-${crypto.randomUUID().slice(0, 8)}`,
      status: 'pending', // Admin does manual bank transfer
      amount: input.amount,
    }
  }

  verifyWebhookSignature(): WebhookVerificationResult {
    // No webhooks for Vorkasse
    return { isValid: false, eventType: '', eventId: '', payload: {} }
  }

  /** Load bank details from ShopSettings */
  async getBankDetails(): Promise<{
    enabled: boolean
    accountHolder: string
    iban: string
    bic: string
    bankName: string
    paymentDeadlineDays: number
    reminderDays: number
    cancelDays: number
  }> {
    const settings = await this.prisma.shopSetting.findMany({
      where: {
        key: {
          in: [
            'vorkasse_enabled',
            'vorkasse_account_holder',
            'vorkasse_iban',
            'vorkasse_bic',
            'vorkasse_bank_name',
            'vorkasse_deadline_days',
            'vorkasse_reminder_days',
            'vorkasse_cancel_days',
          ],
        },
      },
    })

    const get = (key: string) => settings.find((s) => s.key === key)?.value ?? ''

    // Admin UI exposes only `vorkasse_deadline_days`. Treat it as the
    // single source of truth: auto-cancel happens at the deadline, and
    // a reminder is sent earlier (legacy `vorkasse_cancel_days` and
    // `vorkasse_reminder_days` remain as overrides if explicitly set).
    const deadlineDays = parseInt(get('vorkasse_deadline_days')) || 7
    const cancelDays = parseInt(get('vorkasse_cancel_days')) || deadlineDays
    const reminderDays =
      parseInt(get('vorkasse_reminder_days')) || Math.max(1, cancelDays - 3)

    return {
      enabled: get('vorkasse_enabled') === 'true',
      accountHolder: get('vorkasse_account_holder'),
      iban: get('vorkasse_iban'),
      bic: get('vorkasse_bic'),
      bankName: get('vorkasse_bank_name'),
      paymentDeadlineDays: deadlineDays,
      reminderDays,
      cancelDays,
    }
  }

  /** Check if Vorkasse is properly configured (has bank details) */
  async isConfigured(): Promise<boolean> {
    const details = await this.getBankDetails()
    return details.enabled && !!details.iban && !!details.accountHolder
  }
}
