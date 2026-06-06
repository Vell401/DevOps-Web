import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { TasksModule } from '../tasks/tasks.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [TasksModule, ActivityModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
