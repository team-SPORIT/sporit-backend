import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { passportJwtSecret } from 'jwks-rsa';

@Injectable()
export class SupabaseStrategy extends PassportStrategy(Strategy, 'supabase') {
  constructor(private config: ConfigService) {
    const supabaseUrl = config.get<string>('SUPABASE_URL');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // 시크릿 대신, JWKS URL에서 공개키를 가져와 검증
      secretOrKeyProvider: passportJwtSecret({
        jwksUri: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
        cache: true, // 공개키 캐싱 (매번 안 가져오게)
        rateLimit: true,
      }),
      audience: 'authenticated',
      algorithms: ['ES256'], // ECC P-256 = ES256
    });
  }

  validate(payload: { sub?: string; email: string }) {
    if (!payload.sub) throw new UnauthorizedException();
    return {
      id: payload.sub,
      email: payload.email,
    };
  }
}
