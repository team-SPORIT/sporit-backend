import { Controller, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SupabaseAuthGuard } from './guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // 앱이 Supabase 로그인 직후 최초 1회 호출하는 엔드포인트
  @Post('sync')
  @UseGuards(SupabaseAuthGuard)
  sync(@CurrentUser() user: { id: string; email: string }) {
    return this.authService.syncProfile(user);
  }
}
