// 기록을 공유한 그룹
export class SharedGroupDto {
  groupId: bigint;
  groupName: string;
}

// 최근 기록 항목 (키는 camelCase. id/exerciseId는 BigInt라 전역 toJSON에 의해 문자열로 직렬화됨)
export class RecentRecordItemDto {
  id: bigint;
  exerciseId: bigint;
  exerciseType: string;
  durationSec: number | null;
  comment: string | null;
  startImageUrl: string;
  endImageUrl: string;
  recordDate: string;
  createdAt: Date;
  sharedGroups: SharedGroupDto[];
}

// 종목(이름) 단위로 묶은 최근 기록
export class RecentExerciseRecordsDto {
  exerciseType: string;
  count: number;
  totalSeconds: number;
  records: RecentRecordItemDto[];
}

// 최근 7일 내 기록 응답
export class RecentRecordsResponseDto {
  from: string;
  to: string;
  exercises: RecentExerciseRecordsDto[];
}
