import {
  BadRequestException,
  Injectable,
  PipeTransform,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MIME_TO_EXT, RECORD_IMAGE_MAX_SIZE_BYTES } from '../records.constants';

export interface RecordImageFiles {
  startFile: Express.Multer.File;
  endFile: Express.Multer.File;
}

type RawFiles = Partial<Record<'startFile' | 'endFile', Express.Multer.File[]>>;

// startFile/endFile 둘 다 필수(없으면 400), 각 파일의 타입/용량 검증(위반 시 422)
@Injectable()
export class RecordImagesPipe implements PipeTransform<
  RawFiles | undefined,
  RecordImageFiles
> {
  transform(files: RawFiles | undefined): RecordImageFiles {
    const startFile = files?.startFile?.[0];
    const endFile = files?.endFile?.[0];

    if (!startFile || !endFile) {
      throw new BadRequestException(
        'startFile과 endFile 이미지를 모두 업로드해야 합니다.',
      );
    }

    for (const file of [startFile, endFile]) {
      if (!MIME_TO_EXT[file.mimetype]) {
        throw new UnprocessableEntityException(
          '이미지는 jpeg, png, webp 형식만 업로드할 수 있습니다.',
        );
      }
      if (file.size > RECORD_IMAGE_MAX_SIZE_BYTES) {
        throw new UnprocessableEntityException(
          '이미지 용량은 5MB 이하여야 합니다.',
        );
      }
    }

    return { startFile, endFile };
  }
}
