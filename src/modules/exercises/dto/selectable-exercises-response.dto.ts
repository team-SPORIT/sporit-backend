import { ApiProperty } from '@nestjs/swagger';
import { PALETTE_KEYS } from '../../../common/constants/palette.constants';
import { ExerciseSummaryDto } from '../../groups/dto/group-exercises-response.dto';

// 허용 종목이 제한된(allow_all_exercises=false) 그룹과 그 그룹의 허용 종목
export class SelectableGroupDto {
  @ApiProperty({ description: '그룹 ID', type: String })
  groupId: bigint;

  @ApiProperty({ description: '그룹 이름' })
  groupName: string;

  @ApiProperty({
    description: '그룹 색상 팔레트 키',
    enum: PALETTE_KEYS,
    example: 'blue',
  })
  color: string;

  @ApiProperty({
    description: '그룹 색상 hex 값 (color 키에 대응)',
    type: String,
    nullable: true,
    example: '#0079FF',
  })
  colorHex: string | null;

  @ApiProperty({
    description: '그룹의 허용 종목 (그룹 전용 종목, id순)',
    type: ExerciseSummaryDto,
    isArray: true,
  })
  exercises: ExerciseSummaryDto[];
}

// 기록 작성 화면에서 선택 가능한 종목 목록
export class SelectableExercisesResponseDto {
  @ApiProperty({
    description: '내 개인 종목 (id순)',
    type: ExerciseSummaryDto,
    isArray: true,
  })
  mine: ExerciseSummaryDto[];

  @ApiProperty({
    description:
      '내가 속한 그룹 중 허용 종목이 제한된(allow_all_exercises=false) 그룹. 모든 종목을 허용하는 그룹은 포함하지 않는다',
    type: SelectableGroupDto,
    isArray: true,
  })
  groups: SelectableGroupDto[];
}
