import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumberString } from 'class-validator';

// 기록 공유용 DTO
export class CreateShareDto {
  @ApiProperty({ description: '공유할 기록 ID' })
  @IsNotEmpty()
  @IsNumberString({ no_symbols: true })
  recordId: string;

  @ApiProperty({ description: '공유 대상 그룹 ID' })
  @IsNotEmpty()
  @IsNumberString({ no_symbols: true })
  groupId: string;
}
