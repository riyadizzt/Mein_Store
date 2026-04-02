import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Resend } from 'resend'
import { IEmailProvider, SendEmailOptions, SendEmailResult } from '../email-provider.interface'

@Injectable()
export class ResendProvider implements IEmailProvider {
  private readonly logger = new Logger(ResendProvider.name)
  private readonly resend: Resend

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.getOrThrow<string>('RESEND_API_KEY'))
  }

  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const { data, error } = await this.resend.emails.send({
      from: options.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      replyTo: options.replyTo,
      tags: options.tags,
      attachments: options.attachments?.map((a) => ({
        filename: a.filename,
        content: typeof a.content === 'string' ? Buffer.from(a.content, 'base64') : a.content,
        content_type: a.contentType ?? 'application/pdf',
      })),
    })

    if (error) {
      this.logger.error(`Resend error: ${error.message}`, { to: options.to, subject: options.subject })
      throw new Error(`Resend: ${error.message}`)
    }

    this.logger.log(`Email sent: ${data!.id} → ${options.to}`)
    return { id: data!.id, success: true }
  }
}
