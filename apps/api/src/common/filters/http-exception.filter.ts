import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { RequestWithId } from '../middleware/request-id.middleware.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const requestId =
      request.requestId || (request.headers['x-request-id'] as string) || '-';

    let message: string | object = 'Internal server error';
    let errorName = 'InternalServerError';

    if (exception instanceof HttpException) {
      const errorResponse = exception.getResponse();
      errorName = exception.name;
      if (typeof errorResponse === 'string') {
        message = errorResponse;
      } else if (typeof errorResponse === 'object' && errorResponse !== null) {
        message = (errorResponse as Record<string, unknown>).message || errorResponse;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      errorName = exception.name;
    }

    const errorBody = {
      statusCode: status,
      error: errorName,
      message,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
      requestId,
    };

    this.logger.error(
      `[${request.method}] ${request.originalUrl} ${status} - Error: ${JSON.stringify(message)} - RequestId: ${requestId}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json(errorBody);
  }
}
