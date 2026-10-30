import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipeBuilder,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AVATAR_MAX_SIZE_BYTES } from './profiles.constants';

@ApiTags('profiles')
@ApiBearerAuth()
@Controller('profiles')
@UseGuards(SupabaseAuthGuard)
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  // 내 프로필 조회
  @Get('me')
  @ApiOperation({
    summary: '내 프로필 조회',
    description:
      '업로드한 프로필 이미지(profile_image)는 만료되는 임시 URL이다(기본 1시간). 저장해 두지 말고 만료되면 다시 조회한다.',
  })
  findMe(@CurrentUser() user: { id: string; email: string }) {
    return this.profilesService.findMe(user.id);
  }

  // 내 프로필 부분 수정
  @Patch('me')
  @ApiOperation({ summary: '내 프로필 부분 수정' })
  updateMe(
    @CurrentUser() user: { id: string; email: string },
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.profilesService.updateMe(user.id, updateProfileDto);
  }

  // 프로필 이미지 업로드 - multipart/form-data, 필드명 'file'
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: '프로필 이미지 업로드',
    description:
      '응답의 profile_image는 만료되는 임시 URL이다(기본 1시간). 만료되면 GET /profiles/me 로 새 URL을 받는다.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '프로필 이미지',
        },
      },
    },
  })
  uploadAvatar(
    @CurrentUser() user: { id: string; email: string },
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType: /^(image\/jpeg|image\/png|image\/webp)$/,
          fallbackToMimetype: true,
        })
        .addMaxSizeValidator({ maxSize: AVATAR_MAX_SIZE_BYTES })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    return this.profilesService.uploadAvatar(user.id, file);
  }

  // 회원 탈퇴 (계정과 관련 데이터 삭제, 본문 없음)
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '회원 탈퇴',
    description:
      '계정과 관련 데이터(기록, 댓글, 좋아요, 카테고리, 개인 종목 등)를 삭제한다. 내가 그룹장인 그룹은 다른 멤버가 있으면 가장 먼저 가입한 멤버에게 그룹장을 위임하고, 혼자뿐이면 그룹을 삭제한다. 여러 번 호출해도 안전하다(이미 삭제된 계정은 204). 탈퇴 후에는 기존 access token이 만료될 때까지 서버가 토큰 자체는 인정할 수 있으니, 프론트에서 로그아웃(세션/토큰 삭제) 처리를 해야 한다. 프로필/기록 사진 삭제는 계정 삭제 후 best-effort로 수행되며 실패해도 204를 반환한다.',
  })
  @ApiNoContentResponse({ description: '탈퇴 완료 (본문 없음)' })
  @ApiUnauthorizedResponse({ description: '토큰이 없거나 유효하지 않음' })
  @ApiInternalServerErrorResponse({
    description: '계정 삭제에 실패함 (다시 시도하면 이어서 처리된다)',
  })
  withdraw(@CurrentUser() user: { id: string; email: string }) {
    return this.profilesService.withdraw(user.id);
  }
}
