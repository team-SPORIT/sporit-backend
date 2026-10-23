import 'dotenv/config';
import path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/app.helper';
import { createTestUser, getAccessToken } from './helpers/auth.helper';
import {
  cleanupTestData,
  disconnectPrisma,
  prisma,
} from './helpers/cleanup.helper';

const TEST_IMAGE_PATH = path.join(__dirname, 'fixtures', 'test-image.png');
const runId = Date.now();
const DUMMY_IMAGE_URL = 'https://example.com/dummy.jpg';

interface ExerciseResponse {
  id: string;
  name: string;
  owner_id: string | null;
  isDefault: boolean;
}

interface RecordResponse {
  id: string;
  exercise_id: string;
  exercise_type: string;
}

interface WeeklyStats {
  byExercise: {
    exerciseId: string;
    exerciseType: string;
    totalSeconds: number;
    count: number;
  }[];
}

// 종목: 기본 종목 + 개인 종목 조회/추가/삭제, 기록 생성 시 종목 권한 검증, 주간 통계의 exercise_id 기준 집계
describe('종목 (e2e)', () => {
  let app: INestApplication<App>;

  const users = {
    a: { email: `sporit-e2e-ex-a-${runId}@example.com`, id: '', token: '' },
    b: { email: `sporit-e2e-ex-b-${runId}@example.com`, id: '', token: '' },
  };
  const password = 'Test1234!';

  let runningId: string;
  let customNameA: string;
  let customIdA: string;
  let customIdB: string;

  const server = () => app.getHttpServer();
  const authOf = (user: { token: string }) => ({
    Authorization: `Bearer ${user.token}`,
  });

  function createRecord(user: { token: string }, exerciseId: string) {
    return request(server())
      .post('/records')
      .set(authOf(user))
      .field('exerciseId', exerciseId)
      .field('durationSec', '600')
      .attach('startFile', TEST_IMAGE_PATH)
      .attach('endFile', TEST_IMAGE_PATH);
  }

  beforeAll(async () => {
    app = await createTestApp();

    for (const user of Object.values(users)) {
      user.id = (await createTestUser(user.email, password)).id;
      user.token = await getAccessToken(user.email, password);
      await request(server()).post('/auth/sync').set(authOf(user));
    }

    const running = await prisma.exercises.findFirstOrThrow({
      where: { owner_id: null, name: '러닝' },
    });
    runningId = running.id.toString();
    customNameA = `E2E 내 종목 ${runId}`;
  });

  afterAll(async () => {
    await app.close();
    // 개인 종목은 owner(유저) 삭제 시 cascade로 함께 지워진다. 기록이 종목을 참조 중(RESTRICT)이므로
    // 기록은 유저 삭제 cascade에서 같이 정리되는지 afterAll에서 확인한다
    await cleanupTestData({ userIds: Object.values(users).map((u) => u.id) });
    const leftover = await prisma.exercises.count({
      where: { owner_id: { in: Object.values(users).map((u) => u.id) } },
    });
    expect(leftover).toBe(0);
    await disconnectPrisma();
  });

  it('1. 개인 종목을 추가하면 201이고 isDefault=false, owner_id가 내 id이다', async () => {
    const res = await request(server())
      .post('/exercises')
      .set(authOf(users.a))
      .send({ name: customNameA })
      .expect(201);
    const body = res.body as ExerciseResponse;

    expect(body.name).toBe(customNameA);
    expect(body.owner_id).toBe(users.a.id);
    expect(body.isDefault).toBe(false);
    customIdA = body.id;

    const resB = await request(server())
      .post('/exercises')
      .set(authOf(users.b))
      .send({ name: `E2E B 종목 ${runId}` })
      .expect(201);
    customIdB = (resB.body as ExerciseResponse).id;
  });

  it('2. 선택 목록(GET /exercises/selectable)에서 내 개인 종목은 mine에 나오고 남의 종목은 없다', async () => {
    const res = await request(server())
      .get('/exercises/selectable')
      .set(authOf(users.a))
      .expect(200);
    const body = res.body as {
      defaults: ExerciseResponse[];
      mine: ExerciseResponse[];
    };

    expect(body.mine.map((exercise) => exercise.id)).toEqual([customIdA]);
    expect(body.mine.every((exercise) => !exercise.isDefault)).toBe(true);
    expect(body.defaults.map((exercise) => exercise.name)).toContain('러닝');
    expect(body.defaults.every((exercise) => exercise.isDefault)).toBe(true);
    expect(body.mine.map((exercise) => exercise.id)).not.toContain(customIdB);
  });

  it('3. 종목 전체 목록 GET /exercises와 GET /exercises/me는 없다', async () => {
    await request(server()).get('/exercises').set(authOf(users.a)).expect(404);
    await request(server())
      .get('/exercises/me')
      .set(authOf(users.a))
      .expect(404);
  });

  it('4. 내 종목과 같은 이름이나 기본 종목과 같은 이름으로 추가하면 409이다', async () => {
    await request(server())
      .post('/exercises')
      .set(authOf(users.a))
      .send({ name: customNameA })
      .expect(409);

    await request(server())
      .post('/exercises')
      .set(authOf(users.a))
      .send({ name: '러닝' })
      .expect(409);
  });

  it('5. 기본 종목 삭제는 403, 남의 종목 삭제는 403, 없는 종목은 404이다', async () => {
    await request(server())
      .delete(`/exercises/${runningId}`)
      .set(authOf(users.a))
      .expect(403);

    await request(server())
      .delete(`/exercises/${customIdB}`)
      .set(authOf(users.a))
      .expect(403);

    await request(server())
      .delete('/exercises/999999999')
      .set(authOf(users.a))
      .expect(404);

    await request(server())
      .delete('/exercises/abc')
      .set(authOf(users.a))
      .expect(404);
  });

  it('6. 기본 종목과 내 개인 종목으로 기록을 만들 수 있고 응답에 exercise_id/exercise_type이 있다', async () => {
    const res1 = await createRecord(users.a, runningId).expect(201);
    const body1 = res1.body as RecordResponse;
    expect(body1.exercise_id).toBe(runningId);
    expect(body1.exercise_type).toBe('러닝');

    const res2 = await createRecord(users.a, customIdA).expect(201);
    const body2 = res2.body as RecordResponse;
    expect(body2.exercise_id).toBe(customIdA);
    expect(body2.exercise_type).toBe(customNameA);
  });

  it('7. 남의 개인 종목으로 기록을 만들면 403, 없는 종목이면 404, exerciseId가 없으면 400이다', async () => {
    await createRecord(users.a, customIdB).expect(403);
    await createRecord(users.a, '999999999').expect(404);

    await request(server())
      .post('/records')
      .set(authOf(users.a))
      .attach('startFile', TEST_IMAGE_PATH)
      .attach('endFile', TEST_IMAGE_PATH)
      .expect(400);
  });

  it('8. 기록이 있는 개인 종목을 삭제하면 409이다', async () => {
    const res = await request(server())
      .delete(`/exercises/${customIdA}`)
      .set(authOf(users.a))
      .expect(409);

    expect((res.body as { message: string }).message).toBe(
      '기록이 있는 종목은 삭제할 수 없습니다.',
    );
  });

  it('9. 기록이 없는 개인 종목은 삭제할 수 있다 (204)', async () => {
    await request(server())
      .delete(`/exercises/${customIdB}`)
      .set(authOf(users.b))
      .expect(204);

    const selectable = (
      await request(server())
        .get('/exercises/selectable')
        .set(authOf(users.b))
        .expect(200)
    ).body as { mine: ExerciseResponse[] };
    expect(selectable.mine.map((exercise) => exercise.id)).not.toContain(
      customIdB,
    );
  });

  it('10. 주간 통계 byExercise는 exercise_id 기준이라 이름이 같아도 id가 다르면 따로 집계한다', async () => {
    // API로는 같은 이름의 개인 종목을 만들 수 없으므로 prisma로 직접 '러닝' 이름의 개인 종목을 만든다
    const sameNameExercise = await prisma.exercises.create({
      data: { owner_id: users.a.id, name: '러닝' },
    });
    const weekMonday = new Date(Date.UTC(2020, 0, 6)); // 기록이 없는 과거 주 (2020-01-06 월요일)
    await prisma.records.createMany({
      data: [
        {
          user_id: users.a.id,
          exercise_id: BigInt(runningId),
          duration_sec: 100,
          start_image_url: DUMMY_IMAGE_URL,
          end_image_url: DUMMY_IMAGE_URL,
          record_date: weekMonday,
        },
        {
          user_id: users.a.id,
          exercise_id: sameNameExercise.id,
          duration_sec: 200,
          start_image_url: DUMMY_IMAGE_URL,
          end_image_url: DUMMY_IMAGE_URL,
          record_date: weekMonday,
        },
      ],
    });

    const res = await request(server())
      .get('/stats/weekly')
      .query({ weekStart: '2020-01-06' })
      .set(authOf(users.a))
      .expect(200);
    const body = res.body as WeeklyStats;

    expect(body.byExercise).toEqual([
      {
        exerciseId: sameNameExercise.id.toString(),
        exerciseType: '러닝',
        totalSeconds: 200,
        count: 1,
      },
      {
        exerciseId: runningId,
        exerciseType: '러닝',
        totalSeconds: 100,
        count: 1,
      },
    ]);
  });
});
