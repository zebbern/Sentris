import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import type { AuditRequestMeta } from './audit-log.service';

const auditRequestStorage = new AsyncLocalStorage<AuditRequestMeta>();

export function currentAuditRequestMeta(): AuditRequestMeta | undefined {
  return auditRequestStorage.getStore();
}

@Injectable()
export class AuditRequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const correlationId = (req as Request & { correlationId?: unknown }).correlationId;
    const userAgent = req.headers['user-agent'];

    auditRequestStorage.run(
      {
        // Express' req.ip reflects the directly connected socket unless an operator
        // explicitly configures trusted proxies. Do not consume X-Forwarded-For here.
        ip: typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : null,
        userAgent: typeof userAgent === 'string' ? userAgent : null,
        correlationId: typeof correlationId === 'string' ? correlationId : null,
      },
      next,
    );
  }
}
