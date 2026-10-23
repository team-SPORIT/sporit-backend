import { ApiProperty } from '@nestjs/swagger';

// 운동 기록 응답 (DB 컬럼 키 그대로 snake_case. id/exercise_id는 BigInt라 전역 toJSON에 의해 문자열로 직렬화됨)
export class RecordResponseDto {
  @ApiProperty({ description: '기록 ID', type: String })
  id: bigint;

  @ApiProperty({ description: '작성자 유저 ID' })
  user_id: string;

  @ApiProperty({ description: '종목 ID', type: String })
  exercise_id: bigint;

  @ApiProperty({ description: '종목 이름' })
  exercise_type: string;

  @ApiProperty({ description: '운동 시간(초)', nullable: true, type: Number })
  duration_sec: number | null;

  @ApiProperty({ description: '코멘트', nullable: true, type: String })
  comment: string | null;

  @ApiProperty({ description: '시작 사진 URL' })
  start_image_url: string;

  @ApiProperty({ description: '종료 사진 URL' })
  end_image_url: string;

  @ApiProperty({ description: '운동 날짜 (KST 기준 날짜)' })
  record_date: Date;

  @ApiProperty({ description: '기록 생성 시각' })
  created_at: Date;
}
