import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy, Profile } from 'passport-facebook'

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  private readonly logger = new Logger(FacebookStrategy.name)

  constructor(config: ConfigService) {
    const clientID = config.get('META_APP_ID') || 'not-configured'
    const clientSecret = config.get('META_APP_SECRET') || 'not-configured'
    const callbackURL = `${config.get('APP_URL', 'http://localhost:3001')}/api/v1/auth/facebook/callback`

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'public_profile'],
      profileFields: ['id', 'emails', 'name', 'photos'],
    })

    if (clientID === 'not-configured') {
      this.logger.warn('Facebook OAuth nicht konfiguriert — META_APP_ID fehlt in .env')
    }
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: (err: any, user?: any) => void,
  ): Promise<void> {
    const { id, emails, name, photos } = profile
    const user = {
      email: emails?.[0]?.value,
      firstName: name?.givenName ?? '',
      lastName: name?.familyName ?? '',
      profileImageUrl: photos?.[0]?.value,
      provider: 'facebook',
      providerAccountId: id,
    }
    done(null, user)
  }
}
