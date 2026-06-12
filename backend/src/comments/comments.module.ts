import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { TasksModule } from '../tasks/tasks.module';
import { ActivityModule } from '../activity/activity.module';
import { ProjectsModule } from '../projects/projects.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    TasksModule,
    ActivityModule,
    ProjectsModule,
    RealtimeModule,
    NotificationsModule,
    StorageModule,
  ],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
