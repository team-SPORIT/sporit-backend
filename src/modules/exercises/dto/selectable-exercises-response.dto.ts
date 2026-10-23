import { ApiProperty } from '@nestjs/swagger';
import { ExerciseSummaryDto } from '../../groups/dto/group-exercises-response.dto';

// 허용 종목이 설정된(제한 있는) 그룹과 그 그룹의 허용 종목
export class SelectableGroupDto {
  @ApiProperty({ description: '그룹 ID', type: String })
  groupId: bigint;

  @ApiProperty({ description: '그룹 이름' })
  groupName: string;

  @ApiProperty({
    description: '그룹의 허용 종목 (id순)',
    type: ExerciseSummaryDto,
    isArray: true,
  })
  exercises: ExerciseSummaryDto[];
}

// 기록 작성 화면에서 선택 가능한 종목 목록
export class SelectableExercisesResponseDto {
  @ApiProperty({
    description:
      '기본 종목 전체 (id 오름차순). 그룹 제한과 무관하게 항상 내려온다',
    type: ExerciseSummaryDto,
    isArray: true,
  })
  defaults: ExerciseSummaryDto[];

  @ApiProperty({
    description: '내 개인 종목 (등록순)',
    type: ExerciseSummaryDto,
    isArray: true,
  })
  mine: ExerciseSummaryDto[];

  @ApiProperty({
    description:
      '내가 속한 그룹 중 허용 종목이 설정된(제한 있는) 그룹. 제한 없는 그룹은 포함하지 않는다',
    type: SelectableGroupDto,
    isArray: true,
  })
  groups: SelectableGroupDto[];
}
