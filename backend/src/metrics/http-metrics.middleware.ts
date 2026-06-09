import { Injectable, NestMiddleware } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';

import { MetricsService } from './metrics.service';

/**
 * Counts every finished HTTP response for the admin "API requests" dashboard.
 * Runs as middleware (before guards) and hooks the response `finish` event, so
 * it captures everything — including 401/403/429 from guards and 404s — not
 * just requests that reach a controller.
 *
 * Skipped, by exact path prefix on the parsed pathname (so a route or query
 * value that merely contains the word "health" isn't dropped):
 *   - health probes and the socket.io transport, to keep the numbers meaningful;
 *   - the admin metrics endpoint itself, which the dashboard polls every few
 *     seconds and would otherwise dominate its own throughput chart.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const path = (req.originalUrl || req.url).split('?')[0];
    if (
      path.startsWith('/api/health') ||
      path.startsWith('/api/socket.io') ||
      path === '/api/admin/metrics'
    ) {
      next();
      return;
    }

    // Monotonic clock: immune to wall-clock steps that could otherwise record a
    // negative duration into the averages.
    const start = performance.now();
    res.on('finish', () => {
      this.metrics.recordHttp(req.method, res.statusCode, performance.now() - start);
    });
    next();
  }
}
