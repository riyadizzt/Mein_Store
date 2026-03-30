import { Module, Global, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'
import { QUEUE_NAMES } from './queue.constants'

const logger = new Logger('QueueModule')

// Redis Connection aus Upstash
const getRedisConnection = (config: ConfigService) => {
  const url = config.getOrThrow<string>('UPSTASH_REDIS_REST_URL')
  const token = config.getOrThrow<string>('UPSTASH_REDIS_REST_TOKEN')
  const host = url.replace('https://', '')
  return { host, port: 6379, password: token, tls: {} }
}

// No-op queue for development — same interface, no Redis connection
class NoOpQueue {
  name: string
  constructor(name: string) { this.name = name }
  async add(jobName: string, data: any) {
    logger.debug(`[DEV] Queue ${this.name}: job "${jobName}" queued (no-op)`)
    return { id: 'dev-' + Date.now(), name: jobName, data }
  }
  async addBulk(jobs: any[]) { return jobs.map((j, i) => ({ id: `dev-${Date.now()}-${i}`, ...j })) }
  async getJobCounts() { return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 } }
  async close() {}
}

const isDev = process.env.NODE_ENV !== 'production'

const createQueueProvider = (token: string, queueName: string) => ({
  provide: token,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    if (isDev) {
      logger.log(`${token} → NoOp (development)`)
      return new NoOpQueue(queueName) as any
    }
    return new Queue(queueName, { connection: getRedisConnection(config) })
  },
})

@Global()
@Module({
  providers: [
    createQueueProvider('SHOPIFY_SYNC_QUEUE', QUEUE_NAMES.SHOPIFY_SYNC),
    createQueueProvider('EMAIL_QUEUE', QUEUE_NAMES.EMAIL),
    createQueueProvider('INVENTORY_SYNC_QUEUE', QUEUE_NAMES.INVENTORY_SYNC),
    createQueueProvider('ORDER_PROCESSING_QUEUE', QUEUE_NAMES.ORDER_PROCESSING),
    createQueueProvider('GDPR_QUEUE', QUEUE_NAMES.GDPR),
  ],
  exports: [
    'SHOPIFY_SYNC_QUEUE',
    'EMAIL_QUEUE',
    'INVENTORY_SYNC_QUEUE',
    'ORDER_PROCESSING_QUEUE',
    'GDPR_QUEUE',
  ],
})
export class QueueModule {}
