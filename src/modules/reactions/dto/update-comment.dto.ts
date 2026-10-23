import { CreateCommentDto } from './create-comment.dto';

// 댓글 수정용 DTO (작성과 동일하게 content 필수, 1~300자)
export class UpdateCommentDto extends CreateCommentDto {}
