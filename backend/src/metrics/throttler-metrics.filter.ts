import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { MetricsService } from './metrics.service';

/**
 * Catches the 429 thrown by ThrottlerGuard so we can tally rate-limit hits per
 * route for the admin metrics panel, then reproduces the standard throttler
 * response so client behaviour is unchanged.
 */
@Catch(ThrottlerException)
export class ThrottlerMetricsFilter implements ExceptionFilter {
  constructor(private readonly metrics: MetricsService) {}

  catch(exception: ThrottlerException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { route?: { path?: string } }>();
    const res = ctx.getResponse<Response>();

    const route = `${req.method} ${req.route?.path ?? req.path ?? req.url}`;
    this.metrics.recordThrottle(route);

    res.status(429).json({
      statusCode: 429,
      message: exception.message || 'ThrottlerException: Too Many Requests',
    });
  }
}
