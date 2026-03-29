import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Injectable()
export class EmailRateLimiter {
  private readonly logger = new Logger(EmailRateLimiter.name)
  private readonly redis: Redis

  constructor(private readonly config: ConfigService) {
    const url = this.config.getOrThrow<string>('UPSTASH_REDIS_REST_URL')
    const token = this.config.getOrThrow<string>('UPSTASH_REDIS_REST_TOKEN')
    const host = url.replace('https://', '')

    this.redis = new Redis({
      host,
      port: 6379,
      password: token,
      tls: {},
    })
  }

  /**
   * Check if action is within rate limit. Returns true if allowed.
   * @param key  Unique key (e.g. `pwd-reset:{userId}`)
   * @param max  Max attempts
   * @param ttlSeconds  Window in seconds
   */
  async check(key: string, max: number, ttlSeconds: number): Promise<boolean> {
    const fullKey = `rate:email:${key}`
    const current = await this.redis.incr(fullKey)

    if (current === 1) {
      await this.redis.expire(fullKey, ttlSeconds)
    }

    if (current > max) {
      this.logger.warn(`Rate limit exceeded: ${fullKey} (${current}/${max})`)
      return false
    }

    return true
  }
}
