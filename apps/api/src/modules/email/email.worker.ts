import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Worker, Job } from 'bullmq'
import { IEmailProvider, EMAIL_PROVIDER } from './email-provider.interface'
import { EmailService, EmailJobPayload } from './email.service'

@Injectable()
export class EmailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailWorker.name)
  private worker!: Worker

  constructor(
    private readonly config: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly provider: IEmailProvider,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit() {
    // Skip workers in development to avoid burning Upstash Redis requests
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log('Email worker SKIPPED (not production)')
      return
    }

    const url = this.config.getOrThrow<string>('UPSTASH_REDIS_REST_URL')
    const token = this.config.getOrThrow<string>('UPSTASH_REDIS_REST_TOKEN')
    const host = url.replace('https://', '')

    this.worker = new Worker(
      'email',
      async (job: Job<EmailJobPayload>) => {
        await this.handleSendEmail(job)
      },
      {
        connection: { host, port: 6379, password: token, tls: {} },
        concurrency: 5,
        drainDelay: 30000,
        stalledInterval: 300000,
      },
    )

    this.worker.on('completed', (job) => {
      this.logger.log(`Email job ${job.id} completed: ${job.data.type} → ${job.data.to}`)
    })

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Email job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts}): ${err.message}`,
        { type: job?.data?.type, to: job?.data?.to },
      )
    })
  }

  async onModuleDestroy() {
    await this.worker?.close()
  }

  private async handleSendEmail(job: Job<EmailJobPayload>): Promise<void> {
    const { to, type, lang, data } = job.data

    const { html, subject, from } = this.emailService.renderEmail(type, lang, data)

    await this.provider.send({
      to,
      from,
      subject,
      html,
      tags: [
        { name: 'type', value: type },
        { name: 'lang', value: lang },
      ],
    })
  }
}
