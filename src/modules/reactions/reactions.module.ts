import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { ReactionsService } from './reactions.service';
import { ReactionsController } from './reactions.controller';

@Module({
  imports: [GroupsModule],
  controllers: [ReactionsController],
  providers: [ReactionsService],
})
export class ReactionsModule {}
