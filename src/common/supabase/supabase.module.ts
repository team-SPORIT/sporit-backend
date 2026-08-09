import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

// 전역 모듈로 등록 -> 다른 모듈에서 import 없이 SupabaseService 주입 가능
@Global()
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
