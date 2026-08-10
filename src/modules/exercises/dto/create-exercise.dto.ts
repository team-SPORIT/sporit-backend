import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// 종목 추가용 DTO
export class CreateExerciseDto {
  @ApiProperty({ description: '종목 이름', maxLength: 30 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  name: string;
}
