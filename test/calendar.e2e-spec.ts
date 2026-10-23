import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  formatKstDate,
  formatKstMonth,
  getKstMonthRange,
  getKstToday,
  subtractDays,
} from '../src/common/utils/kst-date.util';
import { createTestApp } from './helpers/app.helper';
import { createTestUser, getAccessToken } from './helpers/auth.helper';
import {
  cleanupTestData,
  disconnectPrisma,
  prisma,
} from './helpers/cleanup.helper';

const runId = Date.now();
const DUMMY_IMAGE_URL = 'https://example.com/dummy.jpg';

interface IdResponse {
  id: string;
}

interface CalendarExercise {
  exerciseType: string;
  categoryId: string | null;
  categoryName: string | null;
  color: string | null;
}

interface CalendarResponse {
  month: string;
  startMonth: string;
  days: { date: string; exercises: CalendarExercise[] }[];
}

// 월별 캘린더: 월은 getKstToday() 기준 상대 값으로 만들어 오늘 날짜(월초/월말)에 흔들리지 않게 한다
describe('월별 캘린더 (e2e)', () => {
  let app: INestApplication<App>;

  const users = {
    a: { email: `sporit-e2e-cal-a-${runId}@example.com`, id: '', token: '' },
    b: { email: `sporit-e2e-cal-b-${runId}@example.com`, id: '', token: '' },
    c: { email: `sporit-e2e-cal-c-${runId}@example.com`, id: '', token: '' },
    d: { email: `sporit-e2e-cal-d-${runId}@example.com`, id: '', token: '' },
  };
  const password = 'Test1234!';

  // 월 계산: cur = 이번 달, prev = 지난달, prevPrev = 지지난달, next = 다음 달
  const today = getKstToday();
  const cur = getKstMonthRange(today.getUTCFullYear(), today.getUTCMonth() + 1);
  const prevLast = subtractDays(cur.from, 1);
  const prev = getKstMonthRange(
    prevLast.getUTCFullYear(),
    prevLast.getUTCMonth() + 1,
  );
  const prevPrevLast = subtractDays(prev.from, 1);
  const prevPrev = getKstMonthRange(
    prevPrevLast.getUTCFullYear(),
    prevPrevLast.getUTCMonth() + 1,
  );
  const nextFirst = new Date(cur.to.getTime() + 24 * 60 * 60 * 1000);
  const dayOf = (month: { from: Date }, day: number) =>
    new Date(month.from.getTime() + (day - 1) * 24 * 60 * 60 * 1000);

  const curMonth = formatKstMonth(cur.from);
  const prevMonth = formatKstMonth(prev.from);
  const prevPrevMonth = formatKstMonth(prevPrev.from);
  const nextMonth = formatKstMonth(nextFirst);

  const baseTime = Date.now() - 60 * 60 * 1000;
  const at = (offsetSeconds: number) =>
    new Date(baseTime + offsetSeconds * 1000);

  let cardioId: string;
  let strengthId: string;

  const server = () => app.getHttpServer();
  const authOf = (user: { token: string }) => ({
    Authorization: `Bearer ${user.token}`,
  });
  const getCalendar = (user: { token: string }, month?: string) =>
    request(server())
      .get('/calendar')
      .query(month === undefined ? {} : { month })
      .set(authOf(user));

  const createExercise = async (user: { token: string }, name: string) => {
    const res = await request(server())
      .post('/exercises')
      .set(authOf(user))
      .send({ name })
      .expect(201);
    return BigInt((res.body as IdResponse).id);
  };

  const createRecord = (
    userId: string,
    exerciseId: bigint,
    date: Date,
    createdAtOffset: number,
  ) =>
    prisma.records.create({
      data: {
        user_id: userId,
        exercise_id: exerciseId,
        start_image_url: DUMMY_IMAGE_URL,
        end_image_url: DUMMY_IMAGE_URL,
        record_date: date,
        created_at: at(createdAtOffset),
      },
    });

  let groupId: string;

  beforeAll(async () => {
    app = await createTestApp();

    for (const user of Object.values(users)) {
      user.id = (await createTestUser(user.email, password)).id;
      user.token = await getAccessToken(user.email, password);
      await request(server()).post('/auth/sync').set(authOf(user));
    }

    // A는 4개월 전에 가입했다고 백데이트 (지난달/지지난달 조회가 startMonth 이후가 되도록)
    await prisma.profiles.update({
      where: { id: users.a.id },
      data: {
        created_at: new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 4, 15),
        ),
      },
    });
    // D는 KST로는 이번 달 1일 01:00(= UTC로는 지난달 말일 16:00)에 가입: startMonth는 KST 기준 이번 달이어야 한다
    await prisma.profiles.update({
      where: { id: users.d.id },
      data: {
        created_at: new Date(`${formatKstDate(prevLast)}T16:00:00.000Z`),
      },
    });

    // A의 개인 종목, 그리고 이름이 같지만 ID가 다른 그룹 전용 종목 '러닝'
    const runningA = await createExercise(users.a, '러닝');
    const yogaA = await createExercise(users.a, '요가');
    const swimmingA = await createExercise(users.a, '수영');
    const groupRes = await request(server())
      .post('/groups')
      .set(authOf(users.a))
      .send({ name: `E2E 캘린더 그룹 ${runId}` })
      .expect(201);
    groupId = (groupRes.body as IdResponse).id;
    const putRes = await request(server())
      .put(`/groups/${groupId}/exercises`)
      .set(authOf(users.a))
      .send({ allowAll: false, names: ['러닝'] })
      .expect(200);
    const groupRunning = BigInt(
      (putRes.body as { exercises: { id: string }[] }).exercises[0].id,
    );

    // 카테고리: 러닝 -> 유산소(blue), 수영 -> 근력(red), 요가는 미분류
    const cardioRes = await request(server())
      .post('/categories')
      .set(authOf(users.a))
      .send({ name: '유산소', color: 'blue', exerciseNames: ['러닝'] })
      .expect(201);
    cardioId = (cardioRes.body as IdResponse).id;
    const strengthRes = await request(server())
      .post('/categories')
      .set(authOf(users.a))
      .send({ name: '근력', color: 'red' })
      .expect(201);
    strengthId = (strengthRes.body as IdResponse).id;
    await request(server())
      .put(`/categories/${strengthId}/exercises`)
      .set(authOf(users.a))
      .send({ exerciseNames: ['수영'] })
      .expect(200);

    // 지난달: 1일 러닝 / 5일 요가(먼저) -> 러닝(나중), 같은 이름 중복 기록(요가, 그룹 전용 러닝) / 말일 수영
    await createRecord(users.a.id, runningA, dayOf(prev, 1), 1);
    await createRecord(users.a.id, yogaA, dayOf(prev, 5), 2);
    await createRecord(users.a.id, runningA, dayOf(prev, 5), 3);
    await createRecord(users.a.id, yogaA, dayOf(prev, 5), 4);
    await createRecord(users.a.id, groupRunning, dayOf(prev, 5), 5);
    await createRecord(users.a.id, swimmingA, prev.to, 6);
    // 경계 밖: 지지난달 말일, 이번 달 1일, 오늘
    await createRecord(users.a.id, runningA, prevPrev.to, 7);
    await createRecord(users.a.id, yogaA, cur.from, 8);
    await createRecord(users.a.id, runningA, today, 9);

    // 다른 유저(B)의 기록은 A의 캘린더에 포함되면 안 된다
    const runningB = await createExercise(users.b, '러닝');
    await createRecord(users.b.id, runningB, dayOf(prev, 10), 10);

    // C: 이번 달에 가입한 유저가 가입 이전(지난달) 날짜의 기록을 가지고 있어도 빈 days로 응답한다
    const runningC = await createExercise(users.c, '러닝');
    await createRecord(users.c.id, runningC, dayOf(prev, 3), 11);
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestData({
      userIds: Object.values(users).map((user) => user.id),
      groupIds: groupId ? [BigInt(groupId)] : [],
    });
    await disconnectPrisma();
  });

  it('1. 날짜별로 종목이 묶여 내려오고 기록이 없는 날은 days에 없다 (날짜 오름차순)', async () => {
    const body = (await getCalendar(users.a, prevMonth).expect(200))
      .body as CalendarResponse;

    expect(body.month).toBe(prevMonth);
    expect(body.days.map((day) => day.date)).toEqual([
      formatKstDate(dayOf(prev, 1)),
      formatKstDate(dayOf(prev, 5)),
      formatKstDate(prev.to),
    ]);
  });

  it('2. 같은 날 같은 종목 이름은 한 번만 나온다 (기록이 여러 건이어도, 같은 이름의 다른 exercise_id도)', async () => {
    const body = (await getCalendar(users.a, prevMonth).expect(200))
      .body as CalendarResponse;
    const day5 = body.days.find(
      (day) => day.date === formatKstDate(dayOf(prev, 5)),
    )!;

    // 요가 2건 + 러닝(개인) 1건 + 러닝(그룹 전용, ID가 다름) 1건 -> 요가, 러닝 한 번씩
    expect(day5.exercises.map((e) => e.exerciseType)).toEqual(['요가', '러닝']);
  });

  it('3. 한 날에 종목이 둘이면 먼저 기록한 순서로 나온다 (이름순이 아님)', async () => {
    const body = (await getCalendar(users.a, prevMonth).expect(200))
      .body as CalendarResponse;
    const day5 = body.days.find(
      (day) => day.date === formatKstDate(dayOf(prev, 5)),
    )!;

    // '러닝'이 이름순으로는 앞서지만 '요가'를 먼저 기록했다
    expect(day5.exercises[0].exerciseType).toBe('요가');
    expect(day5.exercises[1].exerciseType).toBe('러닝');
  });

  it('4. 카테고리가 있으면 categoryId/categoryName/color가 채워지고 미분류는 null이다', async () => {
    const body = (await getCalendar(users.a, prevMonth).expect(200))
      .body as CalendarResponse;
    const byDate = new Map(body.days.map((day) => [day.date, day]));

    expect(byDate.get(formatKstDate(dayOf(prev, 1)))!.exercises).toEqual([
      {
        exerciseType: '러닝',
        categoryId: cardioId,
        categoryName: '유산소',
        color: 'blue',
      },
    ]);
    expect(byDate.get(formatKstDate(dayOf(prev, 5)))!.exercises).toEqual([
      {
        exerciseType: '요가',
        categoryId: null,
        categoryName: null,
        color: null,
      },
      {
        exerciseType: '러닝',
        categoryId: cardioId,
        categoryName: '유산소',
        color: 'blue',
      },
    ]);
    expect(byDate.get(formatKstDate(prev.to))!.exercises).toEqual([
      {
        exerciseType: '수영',
        categoryId: strengthId,
        categoryName: '근력',
        color: 'red',
      },
    ]);
  });

  it('5. 월 경계: 말일/1일 기록은 올바른 달에만 들어가고 7일이 지난 과거 기록도 포함된다', async () => {
    const prevBody = (await getCalendar(users.a, prevMonth).expect(200))
      .body as CalendarResponse;
    const prevDates = prevBody.days.map((day) => day.date);
    // 지난달 1일 기록(오늘로부터 7일을 훌쩍 넘음)이 포함된다
    expect(prevDates).toContain(formatKstDate(prev.from));
    // 지난달 말일 포함, 지지난달 말일/이번 달 1일은 제외
    expect(prevDates).toContain(formatKstDate(prev.to));
    expect(prevDates).not.toContain(formatKstDate(prevPrev.to));
    expect(prevDates).not.toContain(formatKstDate(cur.from));

    const prevPrevBody = (await getCalendar(users.a, prevPrevMonth).expect(200))
      .body as CalendarResponse;
    expect(prevPrevBody.days.map((day) => day.date)).toEqual([
      formatKstDate(prevPrev.to),
    ]);

    const curBody = (await getCalendar(users.a, curMonth).expect(200))
      .body as CalendarResponse;
    const curDates = curBody.days.map((day) => day.date);
    expect(curDates).toContain(formatKstDate(cur.from));
    expect(curDates).not.toContain(formatKstDate(prev.to));
  });

  it('6. 다른 유저의 기록은 제외된다', async () => {
    const bodyA = (await getCalendar(users.a, prevMonth).expect(200))
      .body as CalendarResponse;
    // B의 기록은 지난달 10일: A의 캘린더에는 없다
    expect(bodyA.days.map((day) => day.date)).not.toContain(
      formatKstDate(dayOf(prev, 10)),
    );

    const bodyB = (await getCalendar(users.b, prevMonth).expect(200))
      .body as CalendarResponse;
    // B는 이번 달에 가입했으므로 지난달은 빈 days다
    expect(bodyB.days).toEqual([]);
  });

  it('7. month를 생략하면 KST 기준 이번 달이다', async () => {
    const body = (await getCalendar(users.a).expect(200))
      .body as CalendarResponse;

    expect(body.month).toBe(curMonth);
    const byDate = new Map(body.days.map((day) => [day.date, day]));
    expect(
      byDate.get(formatKstDate(today))!.exercises.map((e) => e.exerciseType),
    ).toContain('러닝');
    expect(
      byDate.get(formatKstDate(cur.from))!.exercises.map((e) => e.exerciseType),
    ).toContain('요가');
  });

  it('8. 가입 이전 달과 미래 달은 에러 없이 빈 days와 startMonth를 돌려준다', async () => {
    // C는 이번 달에 가입: 기록이 지난달에 있어도 가입 이전 달이라 빈 days
    const before = (await getCalendar(users.c, prevMonth).expect(200))
      .body as CalendarResponse;
    expect(before).toEqual({
      month: prevMonth,
      startMonth: curMonth,
      days: [],
    });

    // 미래 달
    const future = (await getCalendar(users.a, nextMonth).expect(200))
      .body as CalendarResponse;
    expect(future.month).toBe(nextMonth);
    expect(future.days).toEqual([]);

    // A는 4개월 전에 가입했으므로 startMonth는 그 달이다
    const startOfA = formatKstMonth(
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 4, 15)),
    );
    expect(future.startMonth).toBe(startOfA);

    // startMonth는 KST 기준: D는 UTC로는 지난달 말일 16:00에 가입했지만 KST로는 이번 달이다
    const dBody = (await getCalendar(users.d, curMonth).expect(200))
      .body as CalendarResponse;
    expect(dBody.startMonth).toBe(curMonth);
  });

  it('9. month 형식 오류와 13월은 400, 토큰이 없으면 401이다', async () => {
    for (const month of ['abc', '2026-13', '2026-00', '2026-1', '202610', '']) {
      await getCalendar(users.a, month).expect(400);
    }

    await request(server()).get('/calendar').expect(401);
  });
});
