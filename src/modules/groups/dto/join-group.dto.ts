import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

// 초대 코드 참여용 DTO
export class JoinGroupDto {
  @ApiProperty({ description: '초대 코드', minLength: 8, maxLength: 8 })
  @IsString()
  @Length(8, 8)
  code: string;
}
