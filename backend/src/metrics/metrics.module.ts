import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Global so the Prisma layer (slow queries), the realtime gateway (connection
 * counts) and the throttler filter (rate-limit hits) can all feed the same
 * in-memory store that the admin panel reads.
 */
@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
