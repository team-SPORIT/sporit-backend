import { Module } from '@nestjs/common';
import { ExercisesModule } from '../exercises/exercises.module';
import { RecordsService } from './records.service';
import { RecordsController } from './records.controller';

@Module({
  imports: [ExercisesModule],
  controllers: [RecordsController],
  providers: [RecordsService],
})
export class RecordsModule {}
