import {
  Controller,
  Sse,
  Query,
  MessageEvent,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
import { Observable, Subject, interval, map, merge } from 'rxjs'
import { OnEvent } from '@nestjs/event-emitter'
import { ConfigService } from '@nestjs/config'
import * as jwt from 'jsonwebtoken'

@Controller('admin/notifications')
export class NotificationSseController {
  private readonly logger = new Logger(NotificationSseController.name)
  private readonly notificationSubject = new Subject<MessageEvent>()

  constructor(private readonly config: ConfigService) {}

  @OnEvent('notification.created')
  handleNotificationCreated(notification: any) {
    try {
      this.notificationSubject.next({
        data: JSON.stringify(notification),
        type: 'notification',
      } as MessageEvent)
    } catch (error: any) {
      this.logger.error(`Failed to push SSE notification: ${error?.message}`)
    }
  }

  @Sse('stream')
  stream(@Query('token') token?: string): Observable<MessageEvent> {
    // Validate JWT token from query param (SSE doesn't support custom headers)
    if (!token) throw new UnauthorizedException('Token required')
    try {
      const secret = this.config.getOrThrow<string>('JWT_SECRET')
      const payload = jwt.verify(token, secret) as any
      if (!payload?.sub) throw new Error('Invalid token')
      this.logger.log(`SSE client connected: user=${payload.sub}`)
    } catch {
      throw new UnauthorizedException('Invalid token')
    }

    const heartbeat$ = interval(30_000).pipe(
      map((): MessageEvent => ({
        data: JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }),
        type: 'heartbeat',
      })),
    )

    return merge(this.notificationSubject.asObservable(), heartbeat$)
  }
}
