import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Response, NextFunction } from 'express';
import { RequestWithId } from './request-id.middleware.js';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    const { method, originalUrl } = req;

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      const { statusCode } = res;
      const requestId = req.requestId || (req.headers['x-request-id'] as string) || '-';

      const logPayload = {
        timestamp: new Date().toISOString(),
        level: statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info',
        method,
        path: originalUrl,
        statusCode,
        requestId,
        duration: `${durationMs}ms`,
      };

      const formattedLog = `[${logPayload.method}] ${logPayload.path} ${logPayload.statusCode} - ${logPayload.duration} - RequestId: ${logPayload.requestId}`;

      if (statusCode >= 500) {
        this.logger.error(formattedLog);
      } else if (statusCode >= 400) {
        this.logger.warn(formattedLog);
      } else {
        this.logger.log(formattedLog);
      }
    });

    next();
  }
}
