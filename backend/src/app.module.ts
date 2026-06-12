import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { MetricsModule } from './metrics/metrics.module';
import { ThrottlerMetricsFilter } from './metrics/throttler-metrics.filter';
import { HttpMetricsMiddleware } from './metrics/http-metrics.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { CommentsModule } from './comments/comments.module';
import { LabelsModule } from './labels/labels.module';
import { ActivityModule } from './activity/activity.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { RealtimeModule } from './realtime/realtime.module';
import { StorageModule } from './storage/storage.module';
import { AttachmentsModule } from './attachments/attachments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AppConfigModule,
    RedisModule,
    MetricsModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => ({
        pinoHttp: {
          level: cfg.logLevel,
          transport: undefined,
          redact: ['req.headers.authorization', 'req.headers.cookie'],
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule, RedisModule],
      inject: [AppConfigService, RedisService],
      useFactory: (cfg: AppConfigService, redis: RedisService) => ({
        throttlers: [{ ttl: cfg.throttleTtl * 1000, limit: cfg.throttleLimit }],
        // Redis-backed counters give one shared rate-limit budget across all
        // backend replicas; without Redis each process keeps its own (the old
        // in-memory behaviour).
        storage: redis.connection
          ? new ThrottlerStorageRedisService(redis.connection)
          : undefined,
      }),
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    TasksModule,
    CommentsModule,
    LabelsModule,
    ActivityModule,
    NotificationsModule,
    AdminModule,
    RealtimeModule,
    StorageModule,
    AttachmentsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ThrottlerMetricsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
