import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { ExercisesModule } from './modules/exercises/exercises.module';
import { GroupsModule } from './modules/groups/groups.module';
import { RecordsModule } from './modules/records/records.module';
import { SharesModule } from './modules/shares/shares.module';
import { ReactionsModule } from './modules/reactions/reactions.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [PrismaModule, AuthModule, ProfilesModule, ExercisesModule, GroupsModule, RecordsModule, SharesModule, ReactionsModule, NotificationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
