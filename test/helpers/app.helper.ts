import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';

// main.ts와 동일하게 BigInt를 JSON 응답에서 문자열로 자동 변환 (e2e에서는 main.ts의 bootstrap()을 안 타므로 직접 패치)
function patchBigIntSerialization() {
  (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (
    this: bigint,
  ) {
    return this.toString();
  };
}

// main.ts의 bootstrap()과 동일한 설정(ValidationPipe, BigInt 직렬화)으로 실제 앱과 같게 e2e용 앱 생성
export async function createTestApp(): Promise<INestApplication<App>> {
  patchBigIntSerialization();

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();

  return app;
}
