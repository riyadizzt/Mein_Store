import { Module, Global } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'
import { QUEUE_NAMES } from './queue.constants'

// Redis Connection aus Upstash
const getRedisConnection = (config: ConfigService) => {
  const url = config.getOrThrow<string>('UPSTASH_REDIS_REST_URL')
  const token = config.getOrThrow<string>('UPSTASH_REDIS_REST_TOKEN')

  // Upstash REST URL → ioredis kompatible URL umwandeln
  const host = url.replace('https://', '')
  return {
    host,
    port: 6379,
    password: token,
    tls: {},
  }
}

@Global()
@Module({
  providers: [
    {
      provide: 'SHOPIFY_SYNC_QUEUE',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Queue(QUEUE_NAMES.SHOPIFY_SYNC, { connection: getRedisConnection(config) }),
    },
    {
      provide: 'EMAIL_QUEUE',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Queue(QUEUE_NAMES.EMAIL, { connection: getRedisConnection(config) }),
    },
    {
      provide: 'INVENTORY_SYNC_QUEUE',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Queue(QUEUE_NAMES.INVENTORY_SYNC, { connection: getRedisConnection(config) }),
    },
    {
      provide: 'ORDER_PROCESSING_QUEUE',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Queue(QUEUE_NAMES.ORDER_PROCESSING, { connection: getRedisConnection(config) }),
    },
  ],
  exports: [
    'SHOPIFY_SYNC_QUEUE',
    'EMAIL_QUEUE',
    'INVENTORY_SYNC_QUEUE',
    'ORDER_PROCESSING_QUEUE',
  ],
})
export class QueueModule {}
