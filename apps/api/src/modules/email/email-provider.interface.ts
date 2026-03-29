export interface SendEmailOptions {
  to: string
  from: string
  subject: string
  html: string
  replyTo?: string
  tags?: Array<{ name: string; value: string }>
}

export interface SendEmailResult {
  id: string
  success: boolean
}

export interface IEmailProvider {
  send(options: SendEmailOptions): Promise<SendEmailResult>
}

export const EMAIL_PROVIDER = 'EMAIL_PROVIDER'
