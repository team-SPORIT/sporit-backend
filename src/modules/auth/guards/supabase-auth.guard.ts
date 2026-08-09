import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// 'supabase' 전략(SupabaseStrategy)으로 요청의 Bearer 토큰을 검증하는 가드
@Injectable()
export class SupabaseAuthGuard extends AuthGuard('supabase') {}
