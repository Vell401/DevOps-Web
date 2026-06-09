import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { MetricsService } from './metrics.service';

/**
 * Counts every finished HTTP response for the admin "API requests" dashboard.
 * Runs as middleware (before guards) and hooks the response `finish` event, so
 * it captures everything — including 401/403/429 from guards and 404s — not
 * just requests that reach a controller. Health probes and the socket.io
 * transport are skipped to keep the numbers meaningful.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const url = req.originalUrl || req.url;
    if (url.includes('/health') || url.includes('/socket.io')) {
      next();
      return;
    }

    const start = Date.now();
    res.on('finish', () => {
      this.metrics.recordHttp(req.method, res.statusCode, Date.now() - start);
    });
    next();
  }
}
