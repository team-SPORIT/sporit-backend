import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SupabaseAuthGuard } from './guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // 앱이 Supabase 로그인 직후 최초 1회 호출하는 엔드포인트
  @Post('sync')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Supabase 로그인 직후 프로필 동기화' })
  sync(
    @CurrentUser()
    user: {
      id: string;
      email: string;
      name?: string;
      avatar?: string;
    },
  ) {
    return this.authService.syncProfile(user);
  }
}
