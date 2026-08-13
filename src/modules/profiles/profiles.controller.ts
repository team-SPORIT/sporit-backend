import {
  Controller,
  Get,
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
  ApiOperation,
  ApiTags,
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
  @ApiOperation({ summary: '내 프로필 조회' })
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
  @ApiOperation({ summary: '프로필 이미지 업로드' })
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
        })
        .addMaxSizeValidator({ maxSize: AVATAR_MAX_SIZE_BYTES })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    return this.profilesService.uploadAvatar(user.id, file);
  }
}
