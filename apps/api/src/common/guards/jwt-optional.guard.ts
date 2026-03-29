import { Injectable, ExecutionContext } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

/**
 * Optional JWT Guard — allows unauthenticated requests through.
 * If valid token → req.user is set.
 * If no token or invalid → req.user stays undefined (no 401).
 */
@Injectable()
export class JwtOptionalGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Extract the request to check for Authorization header
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers?.authorization

    // No auth header → allow through as guest
    if (!authHeader) return true

    // Has auth header → try to validate
    try {
      await super.canActivate(context)
    } catch {
      // Invalid token → allow through as guest (req.user stays undefined)
    }
    return true
  }

  handleRequest(_err: any, user: any) {
    // Never throw — return user or null
    return user || null
  }
}
