import { ApiProperty } from '@nestjs/swagger';
import { PALETTE_KEYS } from '../../../common/constants/palette.constants';

// 그룹 기본 정보 (DB 컬럼 키 그대로 snake_case. id는 BigInt라 전역 toJSON에 의해 문자열로 직렬화됨)
export class GroupResponseDto {
  @ApiProperty({ description: '그룹 ID', type: String })
  id: bigint;

  @ApiProperty({ description: '그룹 이름' })
  name: string;

  @ApiProperty({ description: '초대 코드 (대문자 영문+숫자 8자)' })
  invite_code: string;

  @ApiProperty({ description: '최대 인원' })
  max_members: number;

  @ApiProperty({ description: '그룹장 유저 ID' })
  owner_id: string;

  @ApiProperty({ description: '그룹 생성 시각' })
  created_at: Date;

  @ApiProperty({
    description: '그룹 색상 팔레트 키',
    enum: PALETTE_KEYS,
    example: 'blue',
  })
  color: string;

  @ApiProperty({
    description:
      '그룹 색상 hex 값 (color 키에 대응, 이전 팔레트의 키면 null). 이 필드는 camelCase로 추가된 필드이다',
    type: String,
    nullable: true,
    example: '#0079FF',
  })
  colorHex: string | null;

  @ApiProperty({
    description:
      '마지막으로 기록이 공유된 시각 (ISO 문자열, 공유가 없으면 null)',
    type: String,
    format: 'date-time',
    nullable: true,
  })
  last_shared_at: Date | null;
}

// 그룹 생성 응답: 그룹 기본 정보 + 모든 종목 허용 여부
export class CreateGroupResponseDto extends GroupResponseDto {
  @ApiProperty({
    description:
      '모든 종목 허용 여부 (allow_all_exercises와 같은 값을 camelCase로 추가한 필드). false면 names로 만든 그룹 전용 종목만 공유할 수 있다',
  })
  allowAll: boolean;
}

// 내 그룹 목록 항목: 그룹 기본 정보 + 멤버 수
export class GroupListItemDto extends GroupResponseDto {
  @ApiProperty({ description: '현재 멤버 수' })
  memberCount: number;
}

// 그룹 상세의 멤버 항목
export class GroupMemberDto {
  @ApiProperty({ description: '그룹 ID', type: String })
  group_id: bigint;

  @ApiProperty({ description: '멤버 유저 ID' })
  user_id: string;

  @ApiProperty({ description: '가입 시각' })
  joined_at: Date;

  @ApiProperty({
    description: '멤버 프로필 (닉네임/프로필 이미지)',
    example: { nickname: '닉네임', profile_image: null },
  })
  profiles: { nickname: string; profile_image: string | null };
}

// 그룹 상세: 그룹 기본 정보 + 멤버 목록
export class GroupDetailResponseDto extends GroupResponseDto {
  @ApiProperty({ type: GroupMemberDto, isArray: true })
  group_members: GroupMemberDto[];
}
