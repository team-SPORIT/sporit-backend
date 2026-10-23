import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

// 초대 코드 참여용 DTO
export class JoinGroupDto {
  @ApiProperty({ description: '초대 코드', minLength: 8, maxLength: 8 })
  // 앞뒤 공백 제거 + 대문자로 정규화 (문자열이 아니면 그대로 두어 아래 검증이 400 처리)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(8, 8)
  code: string;
}
