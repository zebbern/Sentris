import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Global HTTP logging interceptor.
 *
 * Logs every completed request with method, path, status code, and response
 * time in milliseconds. Request/response bodies are intentionally omitted to
 * avoid logging sensitive data.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { method, url } = request;
    const correlationId: string | undefined = (request as unknown as Record<string, unknown>)[
      'correlationId'
    ] as string | undefined;
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const cid = correlationId ? ` [${correlationId}]` : '';
          this.logger.log(`${method} ${url} ${response.statusCode} — ${duration}ms${cid}`);
        },
        error: (err) => {
          const duration = Date.now() - startTime;
          const status = err instanceof HttpException ? err.getStatus() : 500;
          const cid = correlationId ? ` [${correlationId}]` : '';
          this.logger.warn(`${method} ${url} ${status} — ${duration}ms${cid}`);
        },
      }),
    );
  }
}
