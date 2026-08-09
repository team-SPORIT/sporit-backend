import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  // service_role 키로 생성한 클라이언트라 RLS를 무시함 -> 서버 내부에서만 사용
  private readonly client: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('SUPABASE_URL');
    const serviceRoleKey = this.config.get<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );

    this.client = createClient(url!, serviceRoleKey!);
  }

  getClient(): SupabaseClient {
    return this.client;
  }
}
