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
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AVATAR_MAX_SIZE_BYTES } from './profiles.constants';

@Controller('profiles')
@UseGuards(SupabaseAuthGuard)
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  // 내 프로필 조회
  @Get('me')
  findMe(@CurrentUser() user: { id: string; email: string }) {
    return this.profilesService.findMe(user.id);
  }

  // 내 프로필 부분 수정
  @Patch('me')
  updateMe(
    @CurrentUser() user: { id: string; email: string },
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.profilesService.updateMe(user.id, updateProfileDto);
  }

  // 프로필 이미지 업로드 - multipart/form-data, 필드명 'file'
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file'))
  uploadAvatar(
    @CurrentUser() user: { id: string; email: string },
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^(image\/jpeg|image\/png|image\/webp)$/ })
        .addMaxSizeValidator({ maxSize: AVATAR_MAX_SIZE_BYTES })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    return this.profilesService.uploadAvatar(user.id, file);
  }
}
