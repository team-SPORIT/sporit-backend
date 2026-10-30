import { ApiProperty } from '@nestjs/swagger';

// 기록을 공유한 그룹 (groupId는 BigInt라 전역 toJSON에 의해 문자열로 직렬화됨)
export class SharedGroupDto {
  @ApiProperty({ description: '그룹 ID', type: String, example: '3' })
  groupId: bigint;

  @ApiProperty({ description: '그룹 이름', example: '아침 러닝 모임' })
  groupName: string;
}

// 최근 기록 항목 (키는 camelCase. id/exerciseId는 BigInt라 전역 toJSON에 의해 문자열로 직렬화됨)
export class RecentRecordItemDto {
  @ApiProperty({ description: '기록 ID', type: String, example: '101' })
  id: bigint;

  @ApiProperty({ description: '종목 ID', type: String, example: '12' })
  exerciseId: bigint;

  @ApiProperty({ description: '종목 이름', example: '러닝' })
  exerciseType: string;

  @ApiProperty({
    description: '운동 시간(초). 입력하지 않았으면 null',
    nullable: true,
    type: Number,
    example: 1800,
  })
  durationSec: number | null;

  @ApiProperty({
    description: '코멘트',
    nullable: true,
    type: String,
    example: '오늘은 가볍게 뛰었어요',
  })
  comment: string | null;

  @ApiProperty({
    description:
      '시작 사진 URL (만료되는 임시 URL: 임시 URL이라 일정 시간(기본 1시간) 후 만료된다. 저장해 두지 말고 만료되면 API를 다시 호출해 새 URL을 받는다)',
    example:
      'https://storage.example.com/bucket/records/uid/uuid-start.jpg?X-Amz-Expires=3600&X-Amz-Signature=...',
  })
  startImageUrl: string;

  @ApiProperty({
    description:
      '종료 사진 URL (만료되는 임시 URL: 임시 URL이라 일정 시간(기본 1시간) 후 만료된다. 저장해 두지 말고 만료되면 API를 다시 호출해 새 URL을 받는다)',
    example:
      'https://storage.example.com/bucket/records/uid/uuid-end.jpg?X-Amz-Expires=3600&X-Amz-Signature=...',
  })
  endImageUrl: string;

  @ApiProperty({
    description: '운동 날짜 (KST 기준, YYYY-MM-DD)',
    example: '2026-10-24',
  })
  recordDate: string;

  @ApiProperty({ description: '기록 생성 시각 (ISO 문자열)' })
  createdAt: Date;

  @ApiProperty({
    description: '이 기록을 공유한 그룹 목록 (공유하지 않았으면 빈 배열)',
    type: SharedGroupDto,
    isArray: true,
  })
  sharedGroups: SharedGroupDto[];
}

// 종목(이름) 단위로 묶은 최근 기록
export class RecentExerciseRecordsDto {
  @ApiProperty({
    description: '종목 이름 (같은 이름이면 종목 ID가 달라도 한 종목으로 묶임)',
    example: '러닝',
  })
  exerciseType: string;

  @ApiProperty({ description: '이 기간 내 기록 횟수', example: 3 })
  count: number;

  @ApiProperty({
    description: '이 기간 내 운동 시간 합계(초). durationSec가 null이면 0',
    example: 5400,
  })
  totalSeconds: number;

  @ApiProperty({
    description: '기록 목록 (record_date 내림차순, 같으면 created_at 내림차순)',
    type: RecentRecordItemDto,
    isArray: true,
  })
  records: RecentRecordItemDto[];
}

// 최근 7일 내 기록 응답
export class RecentRecordsResponseDto {
  @ApiProperty({
    description: '조회 시작일 (KST, 오늘 포함 7일의 첫날)',
    example: '2026-10-18',
  })
  from: string;

  @ApiProperty({ description: '조회 종료일 (KST 오늘)', example: '2026-10-24' })
  to: string;

  @ApiProperty({
    description:
      '종목별 기록. 가장 최근 기록이 최신인 종목 순. 기록이 없으면 빈 배열',
    type: RecentExerciseRecordsDto,
    isArray: true,
  })
  exercises: RecentExerciseRecordsDto[];
}
