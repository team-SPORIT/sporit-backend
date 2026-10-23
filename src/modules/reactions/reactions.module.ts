import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { ReactionsService } from './reactions.service';
import { ReactionsController } from './reactions.controller';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';

@Module({
  imports: [GroupsModule],
  controllers: [ReactionsController, CommentsController],
  providers: [ReactionsService, CommentsService],
})
export class ReactionsModule {}
