import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { isTimingLogEnabled, readPositiveInt } from '../utils/env.util';

// 로그에서 제외하는 경로: 헬스체크(GET /)와 Swagger
const EXCLUDED_PATHS = ['/', '/api-docs'];

const DEFAULT_SLOW_REQUEST_MS = 500;

// 요청마다 "GET /groups 200 123ms" 형식으로 응답 시간을 남긴다.
// 남기는 정보는 메서드, 경로(쿼리스트링 제외), 상태코드, 소요시간뿐이다.
// Authorization 헤더, 요청 body, 쿼리스트링(토큰이 실릴 수 있음)은 읽지도 않는다.
// SLOW_REQUEST_MS(기본 500)를 넘으면 warn 레벨로 "[SLOW]"를 붙인다.
@Injectable()
export class TimingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private readonly slowMs = readPositiveInt(
    process.env.SLOW_REQUEST_MS,
    DEFAULT_SLOW_REQUEST_MS,
  );

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!isTimingLogEnabled() || context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const path = req.originalUrl.split('?')[0];
    if (EXCLUDED_PATHS.includes(path) || path.startsWith('/api-docs/')) {
      return next.handle();
    }

    const startedAt = process.hrtime.bigint();
    // 예외 필터가 에러 응답을 만든 뒤의 최종 상태코드를 찍기 위해 응답이 끝나는 시점에 기록한다
    res.once('finish', () => {
      const elapsedMs = Math.round(
        Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      );
      const message = `${req.method} ${path} ${res.statusCode} ${elapsedMs}ms`;
      if (elapsedMs >= this.slowMs) {
        this.logger.warn(`[SLOW] ${message}`);
      } else {
        this.logger.log(message);
      }
    });

    return next.handle();
  }
}
