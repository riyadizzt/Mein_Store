import { ExceptionFilter, Catch, ArgumentsHost, UnauthorizedException } from '@nestjs/common'
import { Response } from 'express'

/**
 * Exception filter for OAuth callbacks.
 * Catches 401 errors (user cancelled or auth failed) and redirects to login page
 * instead of showing raw JSON error.
 */
@Catch(UnauthorizedException)
export class OAuthRedirectFilter implements ExceptionFilter {
  catch(_exception: UnauthorizedException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>()
    const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    if (!res.headersSent) {
      res.redirect(`${frontendUrl}/auth/login?error=oauth_cancelled`)
    }
  }
}
