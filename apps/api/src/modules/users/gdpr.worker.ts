import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Worker, Job } from 'bullmq'
import { GdprService } from './gdpr.service'

interface AnonymizeUserPayload {
  userId: string
}

interface DataExportPayload {
  userId: string
  requestId: string
}

@Injectable()
export class GdprWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GdprWorker.name)
  private worker!: Worker

  constructor(
    private readonly gdprService: GdprService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    // Skip workers in development to avoid burning Upstash Redis requests
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log('GDPR worker SKIPPED (not production)')
      return
    }

    const url = this.config.getOrThrow<string>('UPSTASH_REDIS_REST_URL')
    const token = this.config.getOrThrow<string>('UPSTASH_REDIS_REST_TOKEN')
    const host = url.replace('https://', '')

    this.worker = new Worker(
      'gdpr',
      async (job: Job) => {
        switch (job.name) {
          case 'anonymize-user':
            await this.handleAnonymizeUser(job.data as AnonymizeUserPayload)
            break
          case 'data-export':
            await this.handleDataExport(job.data as DataExportPayload)
            break
          default:
            this.logger.warn(`Unknown GDPR job: ${job.name}`)
        }
      },
      {
        connection: { host, port: 6379, password: token, tls: {} },
        concurrency: 2,
        drainDelay: 60000,
        stalledInterval: 300000,
      },
    )

    this.worker.on('completed', (job) => {
      this.logger.log(`GDPR job ${job.name}:${job.id} completed`)
    })

    this.worker.on('failed', (job, err) => {
      this.logger.error(`GDPR job ${job?.name}:${job?.id} failed`, err)
    })
  }

  async onModuleDestroy() {
    await this.worker?.close()
  }

  private async handleAnonymizeUser(payload: AnonymizeUserPayload) {
    this.logger.log(`Anonymizing user ${payload.userId} (BullMQ delayed job)`)
    await this.gdprService.anonymizeUser(payload.userId)
  }

  private async handleDataExport(payload: DataExportPayload) {
    this.logger.log(`Building data export for user ${payload.userId}`)
    // TODO: generate JSON, upload to Cloudinary/S3, update DataExportRequest with download URL
    // For now just mark as completed
    await this.gdprService.buildDataExport(payload.userId)
    this.logger.log(`Data export completed for request ${payload.requestId}`)
  }
}
