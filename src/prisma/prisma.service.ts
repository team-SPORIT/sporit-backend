import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { isTimingLogEnabled, readPositiveInt } from '../common/utils/env.util';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

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
