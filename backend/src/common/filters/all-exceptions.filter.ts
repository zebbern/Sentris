import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { AppConfig } from '../../config';

/**
 * Global exception filter — catches any unhandled exception that escapes
 * controller-level try/catch or route-level filters.
 *
 * For HttpException instances the original status + response body are preserved.
 * For unknown errors a generic 500 is returned (with full details only in
 * non-production environments).
 *
 * SSE endpoints that have already started writing (`res.headersSent`) are
 * terminated gracefully instead of attempting to send JSON.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly isProduction: boolean;

  constructor(private readonly configService: ConfigService) {
    const appCfg = this.configService.get<AppConfig>('app');
    this.isProduction = appCfg?.nodeEnv === 'production';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { status, body } = this.buildResponse(exception, request, this.isProduction);

    this.logException(exception, status, request);

    // SSE or streaming endpoints may have already flushed headers.
    // Attempting to send a JSON response would throw, so end the stream instead.
    if (response.headersSent) {
      this.logger.warn(
        `Headers already sent for ${request.method} ${request.url} — ending response`,
      );
      response.end();
      return;
    }

    response.status(status).json(body);
  }

  private buildResponse(
    exception: unknown,
    request: Request,
    isProduction: boolean,
  ): { status: number; body: Record<string, unknown> } {
    const timestamp = new Date().toISOString();
    const path = request.url;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // NestJS HttpException responses can be a string or an object.
      const body =
        typeof exceptionResponse === 'string'
          ? {
              statusCode: status,
              message: exceptionResponse,
              error: exceptionResponse,
              timestamp,
              path,
            }
          : { ...(exceptionResponse as Record<string, unknown>), timestamp, path };

      return { status, body };
    }

    // Unknown / unexpected error — never leak internals in production.
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    const body: Record<string, unknown> = {
      statusCode: status,
      message: 'Internal server error',
      error: 'Internal Server Error',
      timestamp,
      path,
    };

    if (!isProduction && exception instanceof Error) {
      body.message = exception.message;
      body.stack = exception.stack;
    }

    return { status, body };
  }

  private logException(exception: unknown, status: number, request: Request): void {
    const context = `${request.method} ${request.url}`;
    const message = this.getLogMessage(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${status}] ${context}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (this.isExpectedAuthValidationMiss(exception, status, request, message)) {
      this.logger.debug(`[${status}] ${context} - ${message}`);
    } else {
      this.logger.warn(`[${status}] ${context} — ${message}`);
    }
  }

  private getLogMessage(exception: unknown): string {
    if (exception instanceof HttpException || exception instanceof Error) {
      return exception.message;
    }

    return String(exception);
  }

  private isExpectedAuthValidationMiss(
    exception: unknown,
    status: number,
    request: Request,
    message: string,
  ): boolean {
    const path = request.path ?? request.url;

    return (
      status === HttpStatus.UNAUTHORIZED &&
      request.method === 'GET' &&
      path.split('?')[0].endsWith('/auth/validate') &&
      exception instanceof HttpException &&
      message.startsWith('Missing authentication')
    );
  }
}
