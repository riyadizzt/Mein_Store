import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20'

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name)

  constructor(config: ConfigService) {
    const clientID = config.get('GOOGLE_CLIENT_ID') || 'not-configured'
    const clientSecret = config.get('GOOGLE_CLIENT_SECRET') || 'not-configured'
    const apiUrl = config.get('NEXT_PUBLIC_API_URL', '') || `http://localhost:${config.get('API_PORT', '3001')}`
    const callbackURL = `${apiUrl}/api/v1/auth/google/callback`

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'profile'],
    })

    if (clientID === 'not-configured') {
      this.logger.warn('Google OAuth nicht konfiguriert — GOOGLE_CLIENT_ID fehlt in .env')
    }
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const { id, emails, name, photos } = profile
    const user = {
      email: emails?.[0]?.value,
      firstName: name?.givenName ?? '',
      lastName: name?.familyName ?? '',
      profileImageUrl: photos?.[0]?.value,
      provider: 'google',
      providerAccountId: id, // needed so auth.service can write OauthAccount row
    }
    done(null, user)
  }
}
