import { randomUUID } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

export const CORRELATION_ID_HEADER = 'x-request-id';

/**
 * Ensures every request has a correlation ID (X-Request-Id).
 *
 * - Reads an existing `X-Request-Id` header from the incoming request.
 * - If absent, generates a new UUID v4.
 * - Sets the header on the response so callers can correlate log entries.
 * - Attaches the value to `req['correlationId']` for downstream consumption
 *   (logging interceptor, Kafka headers, Temporal memo, etc.).
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[CORRELATION_ID_HEADER];
    const correlationId =
      typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();

    // Attach to request for downstream use
    (req as unknown as Record<string, unknown>)['correlationId'] = correlationId;

    // Echo back on response
    res.setHeader('X-Request-Id', correlationId);

    next();
  }
}
