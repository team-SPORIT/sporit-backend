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

interface ExerciseResponse {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

interface RecordResponse {
  id: string;
  exercise_id: string;
  exercise_type: string;
}

interface SelectableResponse {
  mine: { id: string; name: string }[];
  groups: unknown[];
}

// 종목: 기본 종목 없이 개인 종목만 조회/추가/삭제, 기록 생성 시 종목 권한 검증
describe('종목 (e2e)', () => {
  let app: INestApplication<App>;

  const users = {
    a: { email: `sporit-e2e-ex-a-${runId}@example.com`, id: '', token: '' },
    b: { email: `sporit-e2e-ex-b-${runId}@example.com`, id: '', token: '' },
  };
  const password = 'Test1234!';

  const nameA = `E2E 내 종목 ${runId}`;
  const nameA2 = `E2E 내 종목2 ${runId}`;
  let idA: string;
  let idA2: string;
  let idB: string;

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
  });

  afterAll(async () => {
    await app.close();
    // 기록이 종목을 참조 중(RESTRICT)이므로 cleanup이 기록을 먼저 지운 뒤 유저(개인 종목 cascade)를 지운다
    await cleanupTestData({ userIds: Object.values(users).map((u) => u.id) });
    const leftover = await prisma.exercises.count({
      where: { owner_id: { in: Object.values(users).map((u) => u.id) } },
    });
    expect(leftover).toBe(0);
    await disconnectPrisma();
  });

  it('1. 개인 종목을 추가하면 201이고 owner_id가 내 id이며 isDefault 필드는 없다', async () => {
    const res = await request(server())
      .post('/exercises')
      .set(authOf(users.a))
      .send({ name: nameA })
      .expect(201);
    const body = res.body as ExerciseResponse;

    expect(body.name).toBe(nameA);
    expect(body.owner_id).toBe(users.a.id);
    expect(body).not.toHaveProperty('isDefault');
    idA = body.id;

    const res2 = await request(server())
      .post('/exercises')
      .set(authOf(users.a))
      .send({ name: nameA2 })
      .expect(201);
    idA2 = (res2.body as ExerciseResponse).id;

    // 다른 유저는 같은 이름의 종목을 따로 만들 수 있다 (개인 종목은 소유자별로 이름이 유일)
    const resB = await request(server())
      .post('/exercises')
      .set(authOf(users.b))
      .send({ name: nameA })
      .expect(201);
    idB = (resB.body as ExerciseResponse).id;
    expect(idB).not.toBe(idA);
  });

  it('2. GET /exercises는 내 개인 종목만 id순으로 내려준다', async () => {
    const resA = await request(server())
      .get('/exercises')
      .set(authOf(users.a))
      .expect(200);
    const listA = resA.body as ExerciseResponse[];
    expect(listA.map((exercise) => exercise.id)).toEqual([idA, idA2]);
    expect(listA.every((exercise) => exercise.owner_id === users.a.id)).toBe(
      true,
    );

    const resB = await request(server())
      .get('/exercises')
      .set(authOf(users.b))
      .expect(200);
    expect((resB.body as ExerciseResponse[]).map((e) => e.id)).toEqual([idB]);
  });

  it('3. GET /exercises/selectable은 mine과 groups만 내려주고 defaults는 없다', async () => {
    const res = await request(server())
      .get('/exercises/selectable')
      .set(authOf(users.a))
      .expect(200);
    const body = res.body as SelectableResponse;

    expect(body.mine).toEqual([
      { id: idA, name: nameA },
      { id: idA2, name: nameA2 },
    ]);
    expect(body.groups).toEqual([]);
    expect(body).not.toHaveProperty('defaults');
  });

  it('4. 내 종목에 같은 이름이 이미 있으면 409이다 (기본 종목 개념은 없다)', async () => {
    await request(server())
      .post('/exercises')
      .set(authOf(users.a))
      .send({ name: nameA })
      .expect(409);
  });

  it('5. 남의 종목 삭제는 403, 없는 종목은 404, 숫자가 아닌 id도 404이다', async () => {
    await request(server())
      .delete(`/exercises/${idB}`)
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

  it('6. 내 개인 종목으로 기록을 만들 수 있고 응답에 exercise_id/exercise_type이 있다', async () => {
    const res = await createRecord(users.a, idA).expect(201);
    const body = res.body as RecordResponse;

    expect(body.exercise_id).toBe(idA);
    expect(body.exercise_type).toBe(nameA);
  });

  it('7. 남의 개인 종목은 403, 없는 종목은 404, exerciseId가 없으면 400이다', async () => {
    await createRecord(users.a, idB).expect(403);
    await createRecord(users.b, idA).expect(403);
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
      .delete(`/exercises/${idA}`)
      .set(authOf(users.a))
      .expect(409);

    expect((res.body as { message: string }).message).toBe(
      '기록이 있는 종목은 삭제할 수 없습니다.',
    );
  });

  it('9. 기록이 없는 개인 종목은 삭제할 수 있다 (204)', async () => {
    await request(server())
      .delete(`/exercises/${idA2}`)
      .set(authOf(users.a))
      .expect(204);

    const list = (
      await request(server()).get('/exercises').set(authOf(users.a)).expect(200)
    ).body as ExerciseResponse[];
    expect(list.map((exercise) => exercise.id)).toEqual([idA]);
  });
});
