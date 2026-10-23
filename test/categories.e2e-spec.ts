import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PALETTE } from '../src/common/constants/palette.constants';
import { MAX_CATEGORIES_PER_USER } from '../src/modules/categories/categories.constants';
import { createTestApp } from './helpers/app.helper';
import { createTestUser, getAccessToken } from './helpers/auth.helper';
import {
  cleanupTestData,
  disconnectPrisma,
  prisma,
} from './helpers/cleanup.helper';

const runId = Date.now();

interface CategoryResponse {
  id: string;
  name: string;
  color: string;
  colorHex: string | null;
  exerciseNames: string[];
}

// 종목 카테고리(이름 + 팔레트 색): 생성/조회/수정/삭제, 종목 이름 매핑(이동/교체), 권한, 제한
describe('종목 카테고리 (e2e)', () => {
  let app: INestApplication<App>;

  const users = {
    a: { email: `sporit-e2e-cat-a-${runId}@example.com`, id: '', token: '' },
    b: { email: `sporit-e2e-cat-b-${runId}@example.com`, id: '', token: '' },
    c: { email: `sporit-e2e-cat-c-${runId}@example.com`, id: '', token: '' },
  };
  const password = 'Test1234!';

  let cardioId: string; // A의 '유산소' 카테고리
  let strengthId: string; // A의 '근력' 카테고리

  const server = () => app.getHttpServer();
  const authOf = (user: { token: string }) => ({
    Authorization: `Bearer ${user.token}`,
  });

  const listOf = async (user: { token: string }) =>
    (await request(server()).get('/categories').set(authOf(user)).expect(200))
      .body as CategoryResponse[];

  const find = (list: CategoryResponse[], id: string) =>
    list.find((category) => category.id === id);

  const sorted = (names: string[]) => [...names].sort();

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
    await cleanupTestData({ userIds: Object.values(users).map((u) => u.id) });
    // 유저 삭제 시 카테고리와 매핑이 CASCADE로 함께 정리되어야 한다
    const userIds = Object.values(users).map((u) => u.id);
    const [categories, mappings] = await Promise.all([
      prisma.exercise_categories.count({ where: { user_id: { in: userIds } } }),
      prisma.exercise_category_map.count({
        where: { user_id: { in: userIds } },
      }),
    ]);
    expect(categories).toBe(0);
    expect(mappings).toBe(0);
    await disconnectPrisma();
  });

  it('1. 카테고리를 만들면(exerciseNames 포함) 201이고 목록 조회에 종목 이름이 들어간다', async () => {
    const res = await request(server())
      .post('/categories')
      .set(authOf(users.a))
      .send({
        name: '  유산소  ',
        color: 'blue',
        exerciseNames: ['러닝', '사이클', '러닝'],
      })
      .expect(201);
    const body = res.body as CategoryResponse;

    expect(body.name).toBe('유산소'); // trim
    expect(body.color).toBe('blue');
    expect(body.colorHex).toBe('#0079FF'); // 새 팔레트의 hex
    expect(sorted(body.exerciseNames)).toEqual(sorted(['러닝', '사이클'])); // 중복 제거
    cardioId = body.id;

    const strengthRes = await request(server())
      .post('/categories')
      .set(authOf(users.a))
      .send({ name: '근력', color: 'red', exerciseNames: ['스쿼트'] })
      .expect(201);
    strengthId = (strengthRes.body as CategoryResponse).id;

    const list = await listOf(users.a);
    expect(list.map((category) => category.id)).toEqual([cardioId, strengthId]); // 생성순
    expect(sorted(find(list, cardioId)!.exerciseNames)).toEqual(
      sorted(['러닝', '사이클']),
    );
    expect(find(list, strengthId)!.exerciseNames).toEqual(['스쿼트']);
  });

  it('2. 같은 이름은 409, 잘못된 색/이름은 400이다', async () => {
    const post = (body: object) =>
      request(server()).post('/categories').set(authOf(users.a)).send(body);

    await post({ name: '유산소', color: 'lime' }).expect(409);
    await post({ name: ' 유산소 ', color: 'lime' }).expect(409); // trim 후 같은 이름

    await post({ name: '새 카테고리', color: 'neon' }).expect(400);
    // 이전 팔레트의 키는 더 이상 유효하지 않다
    for (const oldKey of ['pink', 'green', 'teal', 'indigo', 'gray']) {
      await post({ name: '새 카테고리', color: oldKey }).expect(400);
    }
    await post({ name: '새 카테고리' }).expect(400); // color 누락
    await post({ name: '   ', color: 'blue' }).expect(400);
    await post({ name: 'a'.repeat(21), color: 'blue' }).expect(400);
    await post({
      name: '새 카테고리',
      color: 'blue',
      exerciseNames: ['a'.repeat(31)],
    }).expect(400);

    // 다른 유저는 같은 이름의 카테고리를 만들 수 있다
    await request(server())
      .post('/categories')
      .set(authOf(users.b))
      .send({ name: '유산소', color: 'lime' })
      .expect(201);
  });

  it('2-1. 새 팔레트의 12개 키로 모두 카테고리를 만들 수 있고 colorHex가 팔레트와 일치한다', async () => {
    for (const { key, hex } of PALETTE) {
      const res = await request(server())
        .post('/categories')
        .set(authOf(users.b))
        .send({ name: `색상 ${key}`, color: key })
        .expect(201);
      const body = res.body as CategoryResponse;
      expect(body.color).toBe(key);
      expect(body.colorHex).toBe(hex);
    }
  });

  it('3. 사용자당 최대 개수를 넘으면 409이다 (21번째)', async () => {
    for (let i = 1; i <= MAX_CATEGORIES_PER_USER; i++) {
      await request(server())
        .post('/categories')
        .set(authOf(users.c))
        .send({ name: `카테고리${i}`, color: 'black' })
        .expect(201);
    }

    await request(server())
      .post('/categories')
      .set(authOf(users.c))
      .send({ name: '카테고리 초과', color: 'black' })
      .expect(409);

    expect(await listOf(users.c)).toHaveLength(MAX_CATEGORIES_PER_USER);
  });

  it('4. PATCH로 이름만/색만 수정하면 보내지 않은 필드는 그대로이고, 빈 body는 400이다', async () => {
    const nameOnly = await request(server())
      .patch(`/categories/${strengthId}`)
      .set(authOf(users.a))
      .send({ name: '  근력 운동  ' })
      .expect(200);
    expect(nameOnly.body).toEqual({
      id: strengthId,
      name: '근력 운동',
      color: 'red',
      colorHex: '#D21417',
      exerciseNames: ['스쿼트'],
    });

    const colorOnly = await request(server())
      .patch(`/categories/${strengthId}`)
      .set(authOf(users.a))
      .send({ color: 'purple' })
      .expect(200);
    expect(colorOnly.body).toEqual({
      id: strengthId,
      name: '근력 운동',
      color: 'purple',
      colorHex: '#7B2CBF',
      exerciseNames: ['스쿼트'],
    });

    await request(server())
      .patch(`/categories/${strengthId}`)
      .set(authOf(users.a))
      .send({})
      .expect(400);
    await request(server())
      .patch(`/categories/${strengthId}`)
      .set(authOf(users.a))
      .send({ color: 'neon' })
      .expect(400);
    // 내 다른 카테고리와 이름이 같으면 409
    await request(server())
      .patch(`/categories/${strengthId}`)
      .set(authOf(users.a))
      .send({ name: '유산소' })
      .expect(409);

    await request(server())
      .patch('/categories/999999999')
      .set(authOf(users.a))
      .send({ name: 'x' })
      .expect(404);
    await request(server())
      .patch('/categories/abc')
      .set(authOf(users.a))
      .send({ name: 'x' })
      .expect(404);
  });

  it('5. PUT으로 종목을 교체하고, 다른 카테고리에 있던 종목은 이동하며, 빈 배열이면 비운다', async () => {
    // '러닝'은 유산소에 있었지만 근력으로 이동하고, 근력에 있던 '스쿼트'는 목록에서 빠져 매핑이 삭제된다
    const res = await request(server())
      .put(`/categories/${strengthId}/exercises`)
      .set(authOf(users.a))
      .send({ exerciseNames: ['러닝', '데드리프트'] })
      .expect(200);
    expect(sorted((res.body as CategoryResponse).exerciseNames)).toEqual(
      sorted(['러닝', '데드리프트']),
    );

    const list = await listOf(users.a);
    expect(find(list, strengthId)!.exerciseNames).toEqual(
      expect.arrayContaining(['러닝', '데드리프트']),
    );
    expect(find(list, strengthId)!.exerciseNames).not.toContain('스쿼트');
    expect(find(list, cardioId)!.exerciseNames).toEqual(['사이클']); // 러닝이 빠졌다

    // 한 종목 이름은 한 사용자에게 하나의 카테고리에만 속한다
    const mappingCount = await prisma.exercise_category_map.count({
      where: { user_id: users.a.id, exercise_name: '러닝' },
    });
    expect(mappingCount).toBe(1);

    // 빈 배열이면 비운다
    const emptied = await request(server())
      .put(`/categories/${strengthId}/exercises`)
      .set(authOf(users.a))
      .send({ exerciseNames: [] })
      .expect(200);
    expect((emptied.body as CategoryResponse).exerciseNames).toEqual([]);

    // 검증: 배열이 아님, 이름 길이, 100개 초과
    const put = (body: object) =>
      request(server())
        .put(`/categories/${strengthId}/exercises`)
        .set(authOf(users.a))
        .send(body);
    await put({}).expect(400);
    await put({ exerciseNames: '러닝' }).expect(400);
    await put({ exerciseNames: [''] }).expect(400);
    await put({ exerciseNames: ['a'.repeat(31)] }).expect(400);
    await put({
      exerciseNames: Array.from({ length: 101 }, (_, i) => `종목${i}`),
    }).expect(400);
    // 100개는 허용
    const hundred = await put({
      exerciseNames: Array.from({ length: 100 }, (_, i) => `종목${i}`),
    }).expect(200);
    expect((hundred.body as CategoryResponse).exerciseNames).toHaveLength(100);
    await put({ exerciseNames: [] }).expect(200);
  });

  it('6. 종목 이름은 공백이 정리된다 (앞뒤 공백 제거, 연속 공백 1개)', async () => {
    const res = await request(server())
      .put(`/categories/${strengthId}/exercises`)
      .set(authOf(users.a))
      .send({ exerciseNames: ['  러닝  ', '플랭크   운동', '러닝'] })
      .expect(200);

    expect(sorted((res.body as CategoryResponse).exerciseNames)).toEqual(
      sorted(['러닝', '플랭크 운동']),
    );
  });

  it('7. 다른 유저의 카테고리 PATCH/DELETE/PUT은 404이고 데이터는 그대로이다', async () => {
    const before = find(await listOf(users.a), strengthId)!;

    await request(server())
      .patch(`/categories/${strengthId}`)
      .set(authOf(users.b))
      .send({ name: '해킹' })
      .expect(404);
    await request(server())
      .put(`/categories/${strengthId}/exercises`)
      .set(authOf(users.b))
      .send({ exerciseNames: ['해킹'] })
      .expect(404);
    await request(server())
      .delete(`/categories/${strengthId}`)
      .set(authOf(users.b))
      .expect(404);

    expect(find(await listOf(users.a), strengthId)).toEqual(before);
    // B의 목록에는 A의 카테고리가 보이지 않는다
    const listB = await listOf(users.b);
    expect(find(listB, strengthId)).toBeUndefined();
    expect(find(listB, cardioId)).toBeUndefined();
  });

  it('8. DELETE 후 매핑이 사라지고 같은 종목을 새 카테고리에 다시 넣을 수 있다', async () => {
    await request(server())
      .delete(`/categories/${cardioId}`)
      .set(authOf(users.a))
      .expect(204);

    const list = await listOf(users.a);
    expect(find(list, cardioId)).toBeUndefined();
    expect(
      await prisma.exercise_category_map.count({
        where: { category_id: BigInt(cardioId) },
      }),
    ).toBe(0);

    // 유산소에 있던 '사이클'을 새 카테고리에 다시 넣을 수 있다
    const res = await request(server())
      .post('/categories')
      .set(authOf(users.a))
      .send({ name: '새 유산소', color: 'sky', exerciseNames: ['사이클'] })
      .expect(201);
    expect((res.body as CategoryResponse).exerciseNames).toEqual(['사이클']);

    // 이미 지운 카테고리는 404
    await request(server())
      .delete(`/categories/${cardioId}`)
      .set(authOf(users.a))
      .expect(404);
  });

  it('9. GET /categories/colors는 팔레트 키 목록을 내려주고, 토큰이 없으면 401이다', async () => {
    const res = await request(server())
      .get('/categories/colors')
      .set(authOf(users.a))
      .expect(200);
    const colors = (res.body as { colors: { key: string; hex: string }[] })
      .colors;
    expect(colors).toHaveLength(12);
    expect(colors).toEqual(PALETTE.map(({ key, hex }) => ({ key, hex })));
    expect(colors.map((color) => color.key)).toEqual([
      'rose',
      'coral',
      'red',
      'crimson',
      'orange',
      'amber',
      'yellow',
      'lime',
      'sky',
      'blue',
      'purple',
      'black',
    ]);
    expect(colors.find((color) => color.key === 'blue')!.hex).toBe('#0079FF');

    await request(server()).get('/categories/colors').expect(401);
    await request(server()).get('/categories').expect(401);
    await request(server())
      .post('/categories')
      .send({ name: 'x', color: 'blue' })
      .expect(401);
  });
});
