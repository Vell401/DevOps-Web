import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { AppConfigService } from '../config/app-config.service';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    private readonly cfg: AppConfigService,
    private readonly metrics: MetricsService,
  ) {
    super();

    // Surface slow queries in the admin metrics panel. We capture only the
    // model + action + duration — never the query parameters — so no personal
    // data is retained. ($use is deprecated in Prisma 6; it remains the
    // supported middleware hook in the Prisma 5 line this project pins.)
    this.$use(async (params, next) => {
      const start = Date.now();
      const result = await next(params);
      const durationMs = Date.now() - start;
      if (durationMs >= this.cfg.slowQueryMs) {
        this.metrics.recordSlowQuery({
          model: params.model ?? 'raw',
          action: params.action,
          durationMs,
        });
      }
      return result;
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
