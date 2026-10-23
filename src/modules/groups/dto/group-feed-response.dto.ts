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

// 그룹 피드에 노출되는 공유 항목 (기록 + 작성자 + 좋아요/댓글 수 + 내 좋아요 여부)
// shareId/recordId는 BigInt (main.ts의 전역 toJSON에 의해 응답 시 문자열로 직렬화됨)
export class FeedShareDto {
  @ApiProperty({ description: '공유 ID', type: String })
  shareId: bigint;

  @ApiProperty({ description: '기록 ID', type: String })
  recordId: bigint;

  @ApiProperty({ description: '종목 ID', type: String })
  exerciseId: bigint;

  @ApiProperty({ description: '종목 이름' })
  exerciseType: string;

  @ApiProperty({ description: '운동 시간(초)', nullable: true })
  durationSec: number | null;

  @ApiProperty({ description: '코멘트', nullable: true })
  comment: string | null;

  @ApiProperty({ description: '시작 사진 URL' })
  startImageUrl: string;

  @ApiProperty({ description: '종료 사진 URL' })
  endImageUrl: string;

  @ApiProperty({ description: '운동 날짜' })
  recordDate: Date;

  @ApiProperty({ description: '공유 시각' })
  sharedAt: Date;

  @ApiProperty({ description: '작성자 정보', type: FeedAuthorDto })
  author: FeedAuthorDto;

  @ApiProperty({ description: '좋아요 수' })
  likeCount: number;

  @ApiProperty({ description: '댓글 수' })
  commentCount: number;

  @ApiProperty({ description: '내가 좋아요를 눌렀는지 여부' })
  likedByMe: boolean;
}

// 그룹 피드 응답 (잠금 상태면 records는 빈 배열)
export class GroupFeedResponseDto {
  @ApiProperty({ description: '내가 해당 날짜에 공유하지 않아 잠긴 상태인지' })
  locked: boolean;

  @ApiProperty({ description: '공유 목록', type: [FeedShareDto] })
  records: FeedShareDto[];
}
