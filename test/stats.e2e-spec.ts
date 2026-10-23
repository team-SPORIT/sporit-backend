import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  addDays,
  formatKstDate,
  getKstToday,
  getKstWeekStart,
} from '../src/common/utils/kst-date.util';
import { createTestApp } from './helpers/app.helper';
import { createTestUser, getAccessToken } from './helpers/auth.helper';
import {
  cleanupTestData,
  disconnectPrisma,
  prisma,
} from './helpers/cleanup.helper';

const runId = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const DUMMY_IMAGE_URL = 'https://example.com/dummy.jpg';

interface WeeklyStats {
  weekStart: string;
  weekEnd: string;
  totalSeconds: number;
  totalCount: number;
  days: { date: string; totalSeconds: number; count: number }[];
  byExercise: { exerciseType: string; totalSeconds: number; count: number }[];
  previous: {
    weekStart: string;
    totalSeconds: number;
    comparableSeconds: number;
  };
  diffSeconds: number;
}

// 주간 운동 통계: records를 prisma로 직접 만들어 record_date를 백데이트해 시나리오를 구성한다.
// 오늘의 요일에 의존하지 않도록, 기대값은 "오늘이 이번 주 몇 번째 요일인지"로 테스트 안에서 계산한다.
describe('주간 운동 통계 (e2e)', () => {
  let app: INestApplication<App>;

  const userA = {
    email: `sporit-e2e-stats-a-${runId}@example.com`,
    password: 'Test1234!',
  };
  const userB = {
    email: `sporit-e2e-stats-b-${runId}@example.com`,
    password: 'Test1234!',
  };
  let userAId: string;
  let userBId: string;
  let tokenA: string;

  const today = getKstToday();
  const thisMonday = getKstWeekStart(today);
  const lastMonday = addDays(thisMonday, -7);
  const twoWeeksAgoMonday = addDays(thisMonday, -14);
  // 오늘이 이번 주 몇 번째 요일인지 (월=0 ... 일=6)
  const todayIndex = Math.round(
    (today.getTime() - thisMonday.getTime()) / DAY_MS,
  );

  // 지난주 러닝: 월~일 각각 100, 200, ... 700초
  const lastWeekRunningSeconds = (dayIndex: number) => 100 * (dayIndex + 1);
  const LAST_WEEK_TOTAL = 2800;
  const THIS_WEEK_RUNNING_PER_DAY = 600;
  const THIS_WEEK_YOGA_SECONDS = 50000;

  const getWeekly = (token: string, weekStart?: string) =>
    request(app.getHttpServer())
      .get('/stats/weekly')
      .query(weekStart ? { weekStart } : {})
      .set('Authorization', `Bearer ${token}`);

  function record(
    userId: string,
    date: Date,
    exerciseType: string,
    durationSec: number | null,
  ) {
    return {
      user_id: userId,
      exercise_type: exerciseType,
      duration_sec: durationSec,
      start_image_url: DUMMY_IMAGE_URL,
      end_image_url: DUMMY_IMAGE_URL,
      record_date: date,
    };
  }

  beforeAll(async () => {
    app = await createTestApp();

    userAId = (await createTestUser(userA.email, userA.password)).id;
    userBId = (await createTestUser(userB.email, userB.password)).id;
    tokenA = await getAccessToken(userA.email, userA.password);
    const tokenB = await getAccessToken(userB.email, userB.password);

    for (const token of [tokenA, tokenB]) {
      await request(app.getHttpServer())
        .post('/auth/sync')
        .set('Authorization', `Bearer ${token}`);
    }

    const data = [
      // 이번 주: 월요일~오늘까지 매일 러닝 600초, 월요일에는 요가 50000초 + 시간 없는 수영
      ...Array.from({ length: todayIndex + 1 }, (_, i) =>
        record(
          userAId,
          addDays(thisMonday, i),
          '러닝',
          THIS_WEEK_RUNNING_PER_DAY,
        ),
      ),
      record(userAId, thisMonday, '요가', THIS_WEEK_YOGA_SECONDS),
      record(userAId, thisMonday, '수영', null),
      // 지난주: 월~일 매일 러닝, 월요일에는 시간 없는 요가
      ...Array.from({ length: 7 }, (_, i) =>
        record(
          userAId,
          addDays(lastMonday, i),
          '러닝',
          lastWeekRunningSeconds(i),
        ),
      ),
      record(userAId, lastMonday, '요가', null),
      // 2주 전: 월요일 러닝 1000초
      record(userAId, twoWeeksAgoMonday, '러닝', 1000),
      // 다른 유저(B)의 기록: A의 통계에 포함되면 안 된다
      record(userBId, thisMonday, '러닝', 99999),
      record(userBId, lastMonday, '러닝', 99999),
    ];
    await prisma.records.createMany({ data });
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestData({ userIds: [userAId, userBId] });
    await disconnectPrisma();
  });

  it('1. 이번 주 합계/횟수를 집계하고 days는 항상 7개이며 기록 없는 날은 0이다', async () => {
    const res = await getWeekly(tokenA).expect(200);
    const body = res.body as WeeklyStats;

    expect(body.weekStart).toBe(formatKstDate(thisMonday));
    expect(body.weekEnd).toBe(formatKstDate(addDays(thisMonday, 6)));
    expect(body.totalSeconds).toBe(
      THIS_WEEK_RUNNING_PER_DAY * (todayIndex + 1) + THIS_WEEK_YOGA_SECONDS,
    );
    // 러닝 (todayIndex + 1)회 + 요가 1회 + 수영 1회(시간 없어도 횟수에는 포함)
    expect(body.totalCount).toBe(todayIndex + 1 + 2);

    expect(body.days).toHaveLength(7);
    expect(body.days.map((day) => day.date)).toEqual(
      Array.from({ length: 7 }, (_, i) =>
        formatKstDate(addDays(thisMonday, i)),
      ),
    );
    for (let i = todayIndex + 1; i < 7; i++) {
      expect(body.days[i]).toEqual({
        date: formatKstDate(addDays(thisMonday, i)),
        totalSeconds: 0,
        count: 0,
      });
    }
    expect(body.days[0].count).toBe(3);
  });

  it('2. byExercise는 운동 시간 내림차순이고 시간 없는 기록도 횟수에 포함된다', async () => {
    const body = (await getWeekly(tokenA).expect(200)).body as WeeklyStats;

    expect(body.byExercise).toEqual([
      {
        exerciseType: '요가',
        totalSeconds: THIS_WEEK_YOGA_SECONDS,
        count: 1,
      },
      {
        exerciseType: '러닝',
        totalSeconds: THIS_WEEK_RUNNING_PER_DAY * (todayIndex + 1),
        count: todayIndex + 1,
      },
      { exerciseType: '수영', totalSeconds: 0, count: 1 },
    ]);
  });

  it('3. 이번 주 조회 시 지난주는 오늘과 같은 요일까지만 comparableSeconds에 합산한다', async () => {
    const body = (await getWeekly(tokenA).expect(200)).body as WeeklyStats;

    let expectedComparable = 0;
    for (let i = 0; i <= todayIndex; i++) {
      expectedComparable += lastWeekRunningSeconds(i);
    }

    expect(body.previous.weekStart).toBe(formatKstDate(lastMonday));
    expect(body.previous.totalSeconds).toBe(LAST_WEEK_TOTAL);
    expect(body.previous.comparableSeconds).toBe(expectedComparable);
    expect(body.diffSeconds).toBe(body.totalSeconds - expectedComparable);

    // 일요일이 아니라면 오늘 이후 요일의 지난주 기록은 비교에서 빠져야 한다
    if (todayIndex < 6) {
      expect(body.previous.comparableSeconds).toBeLessThan(
        body.previous.totalSeconds,
      );
    }
  });

  it('4. 지난 주를 weekStart로 조회하면 지난주 7일 전체와 2주 전 7일 전체를 비교한다', async () => {
    const body = (
      await getWeekly(tokenA, formatKstDate(lastMonday)).expect(200)
    ).body as WeeklyStats;

    expect(body.weekStart).toBe(formatKstDate(lastMonday));
    expect(body.totalSeconds).toBe(LAST_WEEK_TOTAL);
    expect(body.totalCount).toBe(8);
    expect(body.previous.weekStart).toBe(formatKstDate(twoWeeksAgoMonday));
    expect(body.previous.totalSeconds).toBe(1000);
    expect(body.previous.comparableSeconds).toBe(1000);
    expect(body.diffSeconds).toBe(LAST_WEEK_TOTAL - 1000);
  });

  it('5. 기록이 없는 주는 전부 0이고, 미래 주도 에러 없이 전부 0이다', async () => {
    const pastEmpty = (await getWeekly(tokenA, '2020-01-06').expect(200))
      .body as WeeklyStats;
    expect(pastEmpty.totalSeconds).toBe(0);
    expect(pastEmpty.totalCount).toBe(0);
    expect(pastEmpty.days).toHaveLength(7);
    expect(pastEmpty.days.every((day) => day.totalSeconds === 0)).toBe(true);
    expect(pastEmpty.byExercise).toEqual([]);
    expect(pastEmpty.previous.totalSeconds).toBe(0);
    expect(pastEmpty.diffSeconds).toBe(0);

    const futureMonday = formatKstDate(addDays(thisMonday, 14));
    const future = (await getWeekly(tokenA, futureMonday).expect(200))
      .body as WeeklyStats;
    expect(future.weekStart).toBe(futureMonday);
    expect(future.totalSeconds).toBe(0);
    expect(future.totalCount).toBe(0);
    expect(future.days).toHaveLength(7);
    expect(future.byExercise).toEqual([]);
  });

  it('6. 다른 유저의 기록은 포함되지 않는다', async () => {
    const body = (await getWeekly(tokenA).expect(200)).body as WeeklyStats;

    // B의 99999초 기록이 섞였다면 합계가 크게 달라진다
    expect(body.totalSeconds).toBeLessThan(99999);
    expect(body.previous.totalSeconds).toBe(LAST_WEEK_TOTAL);
  });

  it('7. weekStart가 월요일이 아니면 그 날짜가 속한 주의 월요일로 보정한다', async () => {
    const wednesdayOfLastWeek = formatKstDate(addDays(lastMonday, 2));
    const sundayOfLastWeek = formatKstDate(addDays(lastMonday, 6));

    for (const weekStart of [wednesdayOfLastWeek, sundayOfLastWeek]) {
      const body = (await getWeekly(tokenA, weekStart).expect(200))
        .body as WeeklyStats;
      expect(body.weekStart).toBe(formatKstDate(lastMonday));
      expect(body.weekEnd).toBe(formatKstDate(addDays(lastMonday, 6)));
      expect(body.totalSeconds).toBe(LAST_WEEK_TOTAL);
    }
  });

  it('8. weekStart 형식이 잘못되면 400, 토큰이 없으면 401이다', async () => {
    await getWeekly(tokenA, 'abc').expect(400);
    await getWeekly(tokenA, '2026-13-45').expect(400);
    await getWeekly(tokenA, '2026/10/19').expect(400);

    await request(app.getHttpServer()).get('/stats/weekly').expect(401);
  });
});
