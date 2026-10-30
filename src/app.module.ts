import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TimingInterceptor } from './common/interceptors/timing.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { SupabaseModule } from './common/supabase/supabase.module';
import { StorageModule } from './common/storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { ExercisesModule } from './modules/exercises/exercises.module';
import { GroupsModule } from './modules/groups/groups.module';
import { RecordsModule } from './modules/records/records.module';
import { SharesModule } from './modules/shares/shares.module';
import { ReactionsModule } from './modules/reactions/reactions.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { StatsModule } from './modules/stats/stats.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CalendarModule } from './modules/calendar/calendar.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // .env를 전역에서 읽을 수 있게
    PrismaModule,
    SupabaseModule,
    StorageModule,
    AuthModule,
    ProfilesModule,
    ExercisesModule,
    GroupsModule,
    RecordsModule,
    SharesModule,
    ReactionsModule,
    NotificationsModule,
    StatsModule,
    CategoriesModule,
    CalendarModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // 모든 요청의 응답 시간 로그 (전역 적용)
    { provide: APP_INTERCEPTOR, useClass: TimingInterceptor },
  ],
})
export class AppModule {}
