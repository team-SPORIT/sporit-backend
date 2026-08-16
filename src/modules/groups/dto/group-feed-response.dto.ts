import { ApiProperty } from '@nestjs/swagger';

// 그룹 피드의 공유된 기록 작성자 정보
export class FeedAuthorDto {
  @ApiProperty({ description: '작성자 유저 ID' })
  id: string;

  @ApiProperty({ description: '닉네임' })
  nickname: string;

  @ApiProperty({ description: '프로필 이미지 URL', nullable: true })
  profileImage: string | null;
}

// 그룹 피드에 노출되는 공유 항목 (기록 + 작성자 + 리액션/댓글 수)
// shareId/recordId는 BigInt (main.ts의 전역 toJSON에 의해 응답 시 문자열로 직렬화됨)
export class FeedShareDto {
  @ApiProperty({ description: '공유 ID', type: String })
  shareId: bigint;

  @ApiProperty({ description: '기록 ID', type: String })
  recordId: bigint;

  @ApiProperty({ description: '운동 종류' })
  exerciseType: string;

  @ApiProperty({ description: '운동 시간(분)', nullable: true })
  durationMin: number | null;

  @ApiProperty({ description: '코멘트', nullable: true })
  comment: string | null;

  @ApiProperty({ description: '기록 사진 URL' })
  photoUrl: string;

  @ApiProperty({ description: '운동 날짜' })
  recordDate: Date;

  @ApiProperty({ description: '공유 시각' })
  sharedAt: Date;

  @ApiProperty({ description: '작성자 정보', type: FeedAuthorDto })
  author: FeedAuthorDto;

  @ApiProperty({ description: '리액션 수' })
  reactionCount: number;

  @ApiProperty({ description: '댓글 수' })
  commentCount: number;
}

// 그룹 피드 응답 (잠금 상태면 records는 빈 배열)
export class GroupFeedResponseDto {
  @ApiProperty({ description: '내가 해당 날짜에 공유하지 않아 잠긴 상태인지' })
  locked: boolean;

  @ApiProperty({ description: '공유 목록', type: [FeedShareDto] })
  records: FeedShareDto[];
}
