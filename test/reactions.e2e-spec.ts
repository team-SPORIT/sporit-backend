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

interface IdResponse {
  id: string;
}

interface CommentResponse {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  profiles: { id: string; nickname: string; profile_image: string | null };
}

interface FeedShare {
  shareId: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
}

interface FeedResponse {
  locked: boolean;
  records: FeedShare[];
}

// 좋아요/댓글: A(공유함), B(그룹 멤버지만 아직 공유 전), C(그룹 비멤버)로 권한/잠금 규칙까지 검증한다
describe('좋아요/댓글 (e2e)', () => {
  let app: INestApplication<App>;

  const users = {
    a: { email: `sporit-e2e-react-a-${runId}@example.com`, id: '', token: '' },
    b: { email: `sporit-e2e-react-b-${runId}@example.com`, id: '', token: '' },
    c: { email: `sporit-e2e-react-c-${runId}@example.com`, id: '', token: '' },
  };
  const password = 'Test1234!';

  let groupId: string;
  let shareId: string;
  let commentId: string;

  const server = () => app.getHttpServer();

  async function createRecordAndShare(token: string): Promise<string> {
    // 기본 종목이 없으므로 유저마다 개인 종목을 만들어 기록에 사용한다
    const exerciseRes = await request(server())
      .post('/exercises')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '러닝' })
      .expect(201);
    const recordRes = await request(server())
      .post('/records')
      .set('Authorization', `Bearer ${token}`)
      .field('exerciseId', (exerciseRes.body as IdResponse).id)
      .attach('startFile', TEST_IMAGE_PATH)
      .attach('endFile', TEST_IMAGE_PATH)
      .expect(201);
    const shareRes = await request(server())
      .post('/shares')
      .set('Authorization', `Bearer ${token}`)
      .send({ recordId: (recordRes.body as IdResponse).id, groupId })
      .expect(201);
    return (shareRes.body as IdResponse).id;
  }

  async function getMyFeedShare(token: string): Promise<FeedShare> {
    const res = await request(server())
      .get(`/groups/${groupId}/feed`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const share = (res.body as FeedResponse).records.find(
      (record) => record.shareId === shareId,
    );
    if (!share) throw new Error('피드에서 공유를 찾을 수 없습니다.');
    return share;
  }

  beforeAll(async () => {
    app = await createTestApp();

    for (const user of Object.values(users)) {
      user.id = (await createTestUser(user.email, password)).id;
      user.token = await getAccessToken(user.email, password);
      await request(server())
        .post('/auth/sync')
        .set('Authorization', `Bearer ${user.token}`);
    }

    const groupRes = await request(server())
      .post('/groups')
      .set('Authorization', `Bearer ${users.a.token}`)
      .send({ name: `E2E 리액션 그룹 ${runId}` })
      .expect(201);
    const group = groupRes.body as IdResponse & { invite_code: string };
    groupId = group.id;

    await request(server())
      .post('/groups/join')
      .set('Authorization', `Bearer ${users.b.token}`)
      .send({ code: group.invite_code })
      .expect(201);

    shareId = await createRecordAndShare(users.a.token);
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestData({
      userIds: Object.values(users).map((user) => user.id),
      groupIds: groupId ? [BigInt(groupId)] : [],
    });
    await disconnectPrisma();
  });

  it('1. 좋아요 PUT을 두 번 해도 성공하고 피드의 likeCount=1, likedByMe=true이다', async () => {
    for (let i = 0; i < 2; i++) {
      await request(server())
        .put(`/shares/${shareId}/reaction`)
        .set('Authorization', `Bearer ${users.a.token}`)
        .expect(204);
    }

    const share = await getMyFeedShare(users.a.token);
    expect(share.likeCount).toBe(1);
    expect(share.likedByMe).toBe(true);
  });

  it('2. 좋아요 DELETE 후에는 likeCount=0, likedByMe=false이고 한 번 더 취소해도 성공한다', async () => {
    for (let i = 0; i < 2; i++) {
      await request(server())
        .delete(`/shares/${shareId}/reaction`)
        .set('Authorization', `Bearer ${users.a.token}`)
        .expect(204);
    }

    const share = await getMyFeedShare(users.a.token);
    expect(share.likeCount).toBe(0);
    expect(share.likedByMe).toBe(false);
  });

  it('3. 댓글을 작성하고 목록 조회하면 작성자 정보와 함께 시간순으로 나온다', async () => {
    const createRes = await request(server())
      .post(`/shares/${shareId}/comments`)
      .set('Authorization', `Bearer ${users.a.token}`)
      .send({ content: '첫 댓글' })
      .expect(201);
    const created = createRes.body as CommentResponse;
    commentId = created.id;
    expect(created.user_id).toBe(users.a.id);

    await request(server())
      .post(`/shares/${shareId}/comments`)
      .set('Authorization', `Bearer ${users.a.token}`)
      .send({ content: '두 번째 댓글' })
      .expect(201);

    const listRes = await request(server())
      .get(`/shares/${shareId}/comments`)
      .set('Authorization', `Bearer ${users.a.token}`)
      .expect(200);
    const list = listRes.body as CommentResponse[];
    expect(list.map((comment) => comment.content)).toEqual([
      '첫 댓글',
      '두 번째 댓글',
    ]);
    expect(list[0].profiles.id).toBe(users.a.id);
    expect(list[0].profiles).toHaveProperty('nickname');
    expect(list[0].profiles).toHaveProperty('profile_image');
  });

  it('4. 피드의 commentCount에 댓글 수가 반영된다', async () => {
    const share = await getMyFeedShare(users.a.token);
    expect(share.commentCount).toBe(2);
  });

  it('5. 작성자는 PATCH /comments/:id로 댓글을 수정하고 updated_at이 갱신된다', async () => {
    const res = await request(server())
      .patch(`/comments/${commentId}`)
      .set('Authorization', `Bearer ${users.a.token}`)
      .send({ content: '수정된 댓글' })
      .expect(200);

    const body = res.body as CommentResponse;
    expect(body.content).toBe('수정된 댓글');
    expect(new Date(body.updated_at).getTime()).toBeGreaterThan(
      new Date(body.created_at).getTime(),
    );
  });

  it('6. 301자 댓글과 빈 댓글은 400이다', async () => {
    await request(server())
      .post(`/shares/${shareId}/comments`)
      .set('Authorization', `Bearer ${users.a.token}`)
      .send({ content: 'a'.repeat(301) })
      .expect(400);

    await request(server())
      .post(`/shares/${shareId}/comments`)
      .set('Authorization', `Bearer ${users.a.token}`)
      .send({ content: '' })
      .expect(400);

    await request(server())
      .patch(`/comments/${commentId}`)
      .set('Authorization', `Bearer ${users.a.token}`)
      .send({ content: 'a'.repeat(301) })
      .expect(400);
  });

  it('7. 그룹 비멤버(C)는 좋아요/댓글 모두 403이다', async () => {
    const auth = { Authorization: `Bearer ${users.c.token}` };
    await request(server())
      .put(`/shares/${shareId}/reaction`)
      .set(auth)
      .expect(403);
    await request(server())
      .delete(`/shares/${shareId}/reaction`)
      .set(auth)
      .expect(403);
    await request(server())
      .get(`/shares/${shareId}/comments`)
      .set(auth)
      .expect(403);
    await request(server())
      .post(`/shares/${shareId}/comments`)
      .set(auth)
      .send({ content: '비멤버 댓글' })
      .expect(403);
  });

  it('8. 아직 공유 전(잠금 상태)인 멤버(B)는 좋아요/댓글 모두 403이다', async () => {
    const auth = { Authorization: `Bearer ${users.b.token}` };
    await request(server())
      .put(`/shares/${shareId}/reaction`)
      .set(auth)
      .expect(403);
    await request(server())
      .get(`/shares/${shareId}/comments`)
      .set(auth)
      .expect(403);
    await request(server())
      .post(`/shares/${shareId}/comments`)
      .set(auth)
      .send({ content: '잠금 상태 댓글' })
      .expect(403);
  });

  it('9. 존재하지 않는 공유/댓글 ID는 404이다', async () => {
    const auth = { Authorization: `Bearer ${users.a.token}` };
    await request(server())
      .put('/shares/999999999/reaction')
      .set(auth)
      .expect(404);
    await request(server()).get('/shares/abc/comments').set(auth).expect(404);
    await request(server())
      .patch('/comments/999999999')
      .set(auth)
      .send({ content: 'x' })
      .expect(404);
    await request(server()).delete('/comments/999999999').set(auth).expect(404);
  });

  it('10. B가 공유하면 잠금이 풀려 댓글을 쓸 수 있지만, 남의 댓글 수정/삭제는 403이다', async () => {
    await createRecordAndShare(users.b.token);
    const auth = { Authorization: `Bearer ${users.b.token}` };

    await request(server())
      .post(`/shares/${shareId}/comments`)
      .set(auth)
      .send({ content: 'B의 댓글' })
      .expect(201);

    await request(server())
      .patch(`/comments/${commentId}`)
      .set(auth)
      .send({ content: '남의 댓글 수정' })
      .expect(403);
    await request(server())
      .delete(`/comments/${commentId}`)
      .set(auth)
      .expect(403);
  });

  it('11. 작성자는 DELETE /comments/:id로 댓글을 삭제한다 (204)', async () => {
    await request(server())
      .delete(`/comments/${commentId}`)
      .set('Authorization', `Bearer ${users.a.token}`)
      .expect(204);

    const share = await getMyFeedShare(users.a.token);
    expect(share.commentCount).toBe(2); // 남은 2개: A의 두 번째 + B의 댓글
  });

  it('12. 그룹을 삭제하면 공유/좋아요/댓글이 cascade로 함께 정리된다', async () => {
    await request(server())
      .put(`/shares/${shareId}/reaction`)
      .set('Authorization', `Bearer ${users.a.token}`)
      .expect(204);

    await prisma.groups.delete({ where: { id: BigInt(groupId) } });

    const [reactions, comments] = await Promise.all([
      prisma.record_reactions.count({ where: { share_id: BigInt(shareId) } }),
      prisma.record_comments.count({ where: { share_id: BigInt(shareId) } }),
    ]);
    expect(reactions).toBe(0);
    expect(comments).toBe(0);
  });
});
