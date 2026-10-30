import { ApiProperty } from '@nestjs/swagger';

// 댓글 작성자 정보
export class CommentAuthorDto {
  @ApiProperty({ description: '작성자 유저 ID' })
  id: string;

  @ApiProperty({ description: '닉네임' })
  nickname: string;

  @ApiProperty({
    description:
      '프로필 이미지 URL (업로드한 이미지는 만료되는 임시 URL: 임시 URL이라 일정 시간(기본 1시간) 후 만료된다. 저장해 두지 말고 만료되면 API를 다시 호출해 새 URL을 받는다)',
    nullable: true,
  })
  profile_image: string | null;
}

// 댓글 응답 (id/share_id는 BigInt: 전역 toJSON에 의해 문자열로 직렬화됨)
export class CommentResponseDto {
  @ApiProperty({ description: '댓글 ID', type: String })
  id: bigint;

  @ApiProperty({ description: '공유 ID', type: String })
  share_id: bigint;

  @ApiProperty({ description: '작성자 유저 ID' })
  user_id: string;

  @ApiProperty({ description: '댓글 내용', maxLength: 300 })
  content: string;

  @ApiProperty({ description: '작성 시각' })
  created_at: Date;

  @ApiProperty({ description: '수정 시각' })
  updated_at: Date;

  @ApiProperty({ description: '작성자 정보', type: CommentAuthorDto })
  profiles: CommentAuthorDto;
}
