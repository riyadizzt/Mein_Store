export interface EmailAttachment {
  filename: string
  content: Buffer | string // Buffer or base64 string
  contentType?: string
}

export interface SendEmailOptions {
  to: string
  from: string
  subject: string
  html: string
  replyTo?: string
  tags?: Array<{ name: string; value: string }>
  attachments?: EmailAttachment[]
}

export interface SendEmailResult {
  id: string
  success: boolean
}

export interface IEmailProvider {
  send(options: SendEmailOptions): Promise<SendEmailResult>
}

export const EMAIL_PROVIDER = 'EMAIL_PROVIDER'
