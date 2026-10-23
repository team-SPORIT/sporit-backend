import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

// 댓글 작성용 DTO
export class CreateCommentDto {
  @ApiProperty({ description: '댓글 내용', minLength: 1, maxLength: 300 })
  @IsString()
  @Length(1, 300)
  content: string;
}
