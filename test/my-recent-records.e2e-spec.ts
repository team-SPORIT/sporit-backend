import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  formatKstDate,
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

interface IdResponse {
  id: string;
  invite_code: string;
}

interface RecentRecordItem {
  id: string;
  exerciseId: string;
  exerciseType: string;
  durationSec: number | null;
  comment: string | null;
  startImageUrl: string;
  endImageUrl: string;
  recordDate: string;
  createdAt: string;
  sharedGroups: { groupId: string; groupName: string }[];
}

interface RecentResponse {
  from: string;
  to: string;
  exercises: {
    exerciseType: string;
    count: number;
    totalSeconds: number;
    records: RecentRecordItem[];
  }[];
}

// 내 최근 7일 기록 조회: 날짜는 getKstToday() 기준 상대 날짜로 만들어 요일 경계에 흔들리지 않게 한다
describe('내 최근 기록 조회 (e2e)', () => {
  let app: INestApplication<App>;

  const userA = {
    email: `sporit-e2e-recent-a-${runId}@example.com`,
    id: '',
    token: '',
  };
  const userB = {
    email: `sporit-e2e-recent-b-${runId}@example.com`,
    id: '',
    token: '',
  };
  const password = 'Test1234!';

  const today = getKstToday();
  const daysAgo = (days: number) => subtractDays(today, days);
  // created_at 정렬 검증을 위해 기록마다 명확히 다른 생성 시각을 지정한다
  const baseTime = Date.now() - 60 * 60 * 1000;
  const createdAt = (offsetSeconds: number) =>
    new Date(baseTime + offsetSeconds * 1000);

  let groupIdG: string; // 러닝만 허용하는 제한 그룹
  let groupIdH: string; // 모두 허용 그룹
  const ids: Record<string, string> = {};
  const urls: Record<string, { start: string; end: string }> = {};

  const server = () => app.getHttpServer();
  const authOf = (user: { token: string }) => ({
    Authorization: `Bearer ${user.token}`,
  });

  const getRecent = (user: { token: string }, exerciseType?: string) =>
    request(server())
      .get('/records/me/recent')
      .query(exerciseType === undefined ? {} : { exerciseType })
      .set(authOf(user));

  async function createRecord(
    tag: string,
    userId: string,
    exerciseId: bigint,
    daysBefore: number,
    durationSec: number | null,
    createdAtOffset: number,
  ): Promise<string> {
    urls[tag] = {
      start: `https://example.com/${runId}-${tag}-start.jpg`,
      end: `https://example.com/${runId}-${tag}-end.jpg`,
    };
    const record = await prisma.records.create({
      data: {
        user_id: userId,
        exercise_id: exerciseId,
        duration_sec: durationSec,
        comment: `comment-${tag}`,
        start_image_url: urls[tag].start,
        end_image_url: urls[tag].end,
        record_date: daysAgo(daysBefore),
        created_at: createdAt(createdAtOffset),
      },
    });
    ids[tag] = record.id.toString();
    return ids[tag];
  }

  beforeAll(async () => {
    app = await createTestApp();

    for (const user of [userA, userB]) {
      user.id = (await createTestUser(user.email, password)).id;
      user.token = await getAccessToken(user.email, password);
      await request(server()).post('/auth/sync').set(authOf(user));
    }

    const createExercise = async (
      user: { token: string },
      name: string,
    ): Promise<bigint> => {
      const res = await request(server())
        .post('/exercises')
        .set(authOf(user))
        .send({ name })
        .expect(201);
      return BigInt((res.body as IdResponse).id);
    };
    const runningA = await createExercise(userA, '러닝');
    const yogaA = await createExercise(userA, '요가');
    const runningB = await createExercise(userB, '러닝');

    // 그룹 G(러닝만 허용)와 H(모두 허용). G의 그룹 전용 종목 '러닝'은 A의 개인 종목 '러닝'과 ID가 다르지만 이름이 같다
    const groupRes = await Promise.all(
      ['G', 'H'].map((label) =>
        request(server())
          .post('/groups')
          .set(authOf(userA))
          .send({ name: `E2E 최근기록 그룹 ${label} ${runId}` })
          .expect(201),
      ),
    );
    groupIdG = (groupRes[0].body as IdResponse).id;
    groupIdH = (groupRes[1].body as IdResponse).id;
    const putRes = await request(server())
      .put(`/groups/${groupIdG}/exercises`)
      .set(authOf(userA))
      .send({ allowAll: false, names: ['러닝'] })
      .expect(200);
    const groupRunning = BigInt(
      (putRes.body as { exercises: { id: string }[] }).exercises[0].id,
    );

    // 러닝(개인): 오늘, 오늘(가장 먼저 생성), 6일 전(경계 포함), 7일 전(제외). 러닝(그룹 전용 종목): 3일 전
    await createRecord('r1', userA.id, runningA, 0, 600, 1);
    await createRecord('r7', userA.id, runningA, 0, 50, 0);
    await createRecord('r2', userA.id, runningA, 6, 300, 2);
    await createRecord('r3-old', userA.id, runningA, 7, 999, 3);
    await createRecord('r4', userA.id, groupRunning, 3, 1200, 4);
    // 요가: 1일 전(시간 없음), 2일 전
    await createRecord('y5', userA.id, yogaA, 1, null, 5);
    await createRecord('y6', userA.id, yogaA, 2, 100, 6);
    // 다른 유저(B)의 기록은 A의 조회에 포함되면 안 된다
    await createRecord('b1', userB.id, runningB, 0, 77777, 7);

    // r1은 G, H 두 그룹에 공유한다 (G는 러닝만 허용: 이름이 같은 그룹 전용 종목으로 통과)
    for (const groupId of [groupIdG, groupIdH]) {
      await request(server())
        .post('/shares')
        .set(authOf(userA))
        .send({ recordId: ids['r1'], groupId })
        .expect(201);
    }
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestData({
      userIds: [userA.id, userB.id],
      groupIds: [BigInt(groupIdG), BigInt(groupIdH)],
    });
    await disconnectPrisma();
  });

  it('1. 오늘 ~ 6일 전 기록은 포함하고 7일 전 기록은 제외한다 (from/to는 KST 기준)', async () => {
    const body = (await getRecent(userA).expect(200)).body as RecentResponse;

    expect(body.to).toBe(formatKstDate(today));
    expect(body.from).toBe(formatKstDate(daysAgo(6)));

    const allIds = body.exercises.flatMap((exercise) =>
      exercise.records.map((record) => record.id),
    );
    expect(allIds).toEqual(
      expect.arrayContaining([
        ids['r1'],
        ids['r7'],
        ids['r2'],
        ids['r4'],
        ids['y5'],
        ids['y6'],
      ]),
    );
    expect(allIds).not.toContain(ids['r3-old']);
    expect(allIds).toHaveLength(6);
  });

  it('2. 이름이 같은 종목은 exercise_id가 달라도 한 종목으로 합산한다', async () => {
    const body = (await getRecent(userA).expect(200)).body as RecentResponse;

    const running = body.exercises.find((e) => e.exerciseType === '러닝')!;
    expect(running.count).toBe(4); // 개인 종목 3건 + 그룹 전용 종목 1건
    expect(running.totalSeconds).toBe(600 + 50 + 300 + 1200);
    expect(new Set(running.records.map((r) => r.exerciseId)).size).toBe(2);

    // durationSec가 null인 기록은 0초로 합산하되 횟수에는 포함한다
    const yoga = body.exercises.find((e) => e.exerciseType === '요가')!;
    expect(yoga.count).toBe(2);
    expect(yoga.totalSeconds).toBe(100);
    expect(
      yoga.records.find((r) => r.id === ids['y5'])!.durationSec,
    ).toBeNull();

    expect(body.exercises).toHaveLength(2);
  });

  it('3. exerciseType 필터: 해당 종목만 내려오고(trim 적용), 없는 이름이면 빈 배열이다', async () => {
    for (const query of ['러닝', '  러닝  ']) {
      const body = (await getRecent(userA, query).expect(200))
        .body as RecentResponse;
      expect(body.exercises.map((e) => e.exerciseType)).toEqual(['러닝']);
      expect(body.exercises[0].count).toBe(4);
    }

    const yoga = (await getRecent(userA, '요가').expect(200))
      .body as RecentResponse;
    expect(yoga.exercises.map((e) => e.exerciseType)).toEqual(['요가']);

    // 정확히 일치해야 한다 (부분 일치 아님)
    const partial = (await getRecent(userA, '러').expect(200))
      .body as RecentResponse;
    expect(partial.exercises).toEqual([]);

    const none = (await getRecent(userA, '없는종목').expect(200))
      .body as RecentResponse;
    expect(none.exercises).toEqual([]);
    expect(none.from).toBe(formatKstDate(daysAgo(6)));
  });

  it('4. 다른 유저의 기록은 제외된다', async () => {
    const bodyA = (await getRecent(userA).expect(200)).body as RecentResponse;
    const allIdsA = bodyA.exercises.flatMap((e) => e.records.map((r) => r.id));
    expect(allIdsA).not.toContain(ids['b1']);
    expect(
      bodyA.exercises.find((e) => e.exerciseType === '러닝')!.totalSeconds,
    ).toBeLessThan(77777);

    const bodyB = (await getRecent(userB).expect(200)).body as RecentResponse;
    expect(bodyB.exercises).toHaveLength(1);
    expect(bodyB.exercises[0].records.map((r) => r.id)).toEqual([ids['b1']]);
  });

  it('5. 공유한 기록은 sharedGroups에 그룹이 나오고 공유하지 않은 기록은 빈 배열이다', async () => {
    const body = (await getRecent(userA).expect(200)).body as RecentResponse;
    const records = body.exercises.flatMap((e) => e.records);
    const byId = new Map(records.map((record) => [record.id, record]));

    expect(
      byId.get(ids['r1'])!.sharedGroups.map((group) => group.groupId),
    ).toEqual([groupIdG, groupIdH]);
    expect(byId.get(ids['r1'])!.sharedGroups[0].groupName).toBe(
      `E2E 최근기록 그룹 G ${runId}`,
    );
    for (const tag of ['r7', 'r2', 'r4', 'y5', 'y6']) {
      expect(byId.get(ids[tag])!.sharedGroups).toEqual([]);
    }
  });

  it('6. 종목은 가장 최근 기록이 최신인 순, 기록은 record_date 내림차순 후 created_at 내림차순이다', async () => {
    const body = (await getRecent(userA).expect(200)).body as RecentResponse;

    // 요가의 최신 기록(y6)이 러닝의 최신 기록(r4)보다 늦게 만들어졌다
    expect(body.exercises.map((e) => e.exerciseType)).toEqual(['요가', '러닝']);

    const yoga = body.exercises[0];
    expect(yoga.records.map((r) => r.id)).toEqual([ids['y5'], ids['y6']]); // 1일 전, 2일 전

    const running = body.exercises[1];
    // 오늘 r1(나중 생성) -> 오늘 r7 -> 3일 전 r4 -> 6일 전 r2
    expect(running.records.map((r) => r.id)).toEqual([
      ids['r1'],
      ids['r7'],
      ids['r4'],
      ids['r2'],
    ]);
  });

  it('7. 모든 기록 항목에 startImageUrl, endImageUrl이 있고 저장한 값과 일치한다', async () => {
    const body = (await getRecent(userA).expect(200)).body as RecentResponse;
    const tagById = new Map(
      Object.entries(ids).map(([tag, id]) => [id, tag] as const),
    );

    const records = body.exercises.flatMap((e) => e.records);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      const tag = tagById.get(record.id)!;
      expect(record.startImageUrl).toBe(urls[tag].start);
      expect(record.endImageUrl).toBe(urls[tag].end);
      expect(record.comment).toBe(`comment-${tag}`);
      expect(record.recordDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('8. 7일이 지난 기록도 DB에서는 삭제되지 않고 조회에서만 제외된다', async () => {
    await getRecent(userA).expect(200);

    const old = await prisma.records.findUnique({
      where: { id: BigInt(ids['r3-old']) },
    });
    expect(old).not.toBeNull();
    expect(formatKstDate(old!.record_date)).toBe(formatKstDate(daysAgo(7)));
    expect(old!.start_image_url).toBe(urls['r3-old'].start);
  });

  it('9. 토큰이 없으면 401이다', async () => {
    await request(server()).get('/records/me/recent').expect(401);
  });
});
