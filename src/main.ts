import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

// BigInt는 기본적으로 JSON 직렬화가 안 되므로, 응답 시 문자열로 자동 변환되게 전역 설정
type BigIntWithToJSON = typeof BigInt.prototype & { toJSON(): string };
(BigInt.prototype as BigIntWithToJSON).toJSON = function (
  this: bigint,
): string {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // whitelist: true -> DTO에 정의되지 않은 필드는 요청에서 자동으로 제거
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Sporit API')
    .setDescription('Sporit 백엔드 API 문서')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, swaggerDocument);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
