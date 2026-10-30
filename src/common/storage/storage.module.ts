import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

// 전역 모듈로 등록 -> 다른 모듈에서 import 없이 StorageService 주입 가능
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
