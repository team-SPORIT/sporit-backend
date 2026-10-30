import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { isTimingLogEnabled, readPositiveInt } from '../common/utils/env.util';

// 커넥션 풀 설정. 요청이 뜸할 때 연결이 닫혀 다음 요청이 새로 연결하느라 느려지는 것을 줄인다.
// - idleTimeoutMillis: 놀고 있는 연결을 닫기까지 기다리는 시간 (pg 기본은 10초라 뜸한 요청마다 재연결됨)
// - keepAlive: TCP keep-alive로 중간 프록시/방화벽이 놀고 있는 연결을 끊는 것을 줄인다
// - min: 1 -> 연결이 한 번 만들어지면 idle 시간이 지나도 최소 1개는 닫지 않고 유지한다 (pg-pool 3.x 지원)
// - max: 풀의 최대 연결 수 (pg 기본값과 같은 10)
const DEFAULT_POOL_IDLE_MS = 300_000; // 5분
const DEFAULT_POOL_MAX = 10;

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  idleTimeoutMillis: readPositiveInt(
    process.env.DB_POOL_IDLE_MS,
    DEFAULT_POOL_IDLE_MS,
  ),
  max: readPositiveInt(process.env.DB_POOL_MAX, DEFAULT_POOL_MAX),
  min: 1,
  keepAlive: true,
});

const DEFAULT_SLOW_QUERY_MS = 200;
// 로그가 지나치게 길어지지 않게 쿼리 문장은 이 길이까지만 남긴다
const MAX_QUERY_LOG_LENGTH = 1000;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('Prisma');

  constructor() {
    // 테스트에서는 쿼리 이벤트 자체를 받지 않는다
    super(
      isTimingLogEnabled()
        ? { adapter, log: [{ emit: 'event', level: 'query' }] }
        : { adapter },
    );

    if (isTimingLogEnabled()) {
      this.registerSlowQueryLog();
    }
  }

  // SLOW_QUERY_MS(기본 200)를 넘는 쿼리만 warn으로 남긴다.
  // 쿼리 문장은 "$1, $2" 같은 자리표시자 형태이고, 파라미터 값(event.params)은 읽지 않으므로 로그에 값이 남지 않는다
  private registerSlowQueryLog() {
    const slowMs = readPositiveInt(
      process.env.SLOW_QUERY_MS,
      DEFAULT_SLOW_QUERY_MS,
    );
    const on = this.$on as unknown as (
      event: 'query',
      callback: (event: { query: string; duration: number }) => void,
    ) => void;

    on.call(this, 'query', ({ query, duration }) => {
      if (duration < slowMs) return;
      const text =
        query.length > MAX_QUERY_LOG_LENGTH
          ? `${query.slice(0, MAX_QUERY_LOG_LENGTH)}...`
          : query;
      this.logger.warn(`[SLOW QUERY] ${Math.round(duration)}ms ${text}`);
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
