import { ExecutionContext, Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

@Injectable()
export class FacebookOAuthGuard extends AuthGuard('facebook') {
  handleRequest(err: any, user: any, _info: any, context: ExecutionContext) {
    if (err || !user) {
      const res = context.switchToHttp().getResponse()
      const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      res.redirect(`${frontendUrl}/auth/login?error=facebook_cancelled`)
      return null
    }
    return user
  }
}
