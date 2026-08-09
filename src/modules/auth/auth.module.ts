import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SupabaseStrategy } from './strategies/supabase.strategy';

@Module({
  imports: [PassportModule],
  controllers: [AuthController],
  // PrismaService는 전역(@Global) PrismaModule에서 제공되므로 여기서 import 불필요
  providers: [AuthService, SupabaseStrategy],
})
export class AuthModule {}
