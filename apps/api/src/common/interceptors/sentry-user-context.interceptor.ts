/**
 * SentryUserContextInterceptor
 *
 * Attaches the current authenticated user (id, email, role) to the Sentry
 * scope so that errors reported during this request are linked to the user
 * who triggered them.
 *
 * Runs globally as an APP_INTERCEPTOR — that means it fires AFTER guards
 * (so `req.user` is populated by JwtAuthGuard) and BEFORE the controller.
 *
 * Privacy guarantees:
 *   - Only `id`, `email`, `role`, `staffRole` are ever sent to Sentry.
 *   - NEVER: passwordHash, refresh tokens, access tokens, payment data.
 *   - For anonymous routes, no user context is set (Sentry keeps the
 *     request as unauthenticated — correct).
 *
 * Graceful degradation:
 *   - When SENTRY_DSN is not set, `Sentry.getClient()` returns undefined.
 *     We short-circuit and call `next.handle()` without any work.
 *   - Even if setUser() were called in that case it would be a no-op,
 *     but the early-return saves allocating the user object.
 */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import * as Sentry from '@sentry/nestjs'

interface RequestUser {
  id?: string
  sub?: string
  email?: string
  role?: string
  staffRole?: string
}

@Injectable()
export class SentryUserContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // No-op when Sentry isn't initialized (SENTRY_DSN missing).
    // This makes the interceptor free in dev / graceful-degraded mode.
    const client = Sentry.getClient()
    if (!client) return next.handle()

    // Only HTTP contexts carry req.user (skip RPC, WS, GraphQL if ever used).
    if (context.getType() !== 'http') return next.handle()

    const req = context.switchToHttp().getRequest()
    const user = req?.user as RequestUser | undefined

    if (user && typeof user === 'object') {
      // Pick ONLY the safe fields. Do NOT spread `...user` — that would
      // accidentally ship anything else that JwtStrategy added later.
      const safeUser: Record<string, string | undefined> = {
        id: user.id ?? user.sub,
        email: user.email ?? undefined,
      }
      const role = user.role ?? user.staffRole
      if (role) safeUser.role = role

      // Remove undefineds so Sentry's scope stays clean.
      for (const key of Object.keys(safeUser)) {
        if (safeUser[key] === undefined) delete safeUser[key]
      }

      Sentry.setUser(safeUser)
    }
    // Else: anonymous request — leave Sentry user context untouched
    // (it will report the error with just ip/ua from requestDataIntegration).

    return next.handle()
  }
}
