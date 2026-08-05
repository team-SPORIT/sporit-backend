import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // 모든 모듈에서 import 없이 쓸 수 있게
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}