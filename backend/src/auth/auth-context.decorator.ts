import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { AuthContext } from './types';
import type { RequestWithAuthContext } from './auth.guard';

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext | null => {
    const request = ctx.switchToHttp().getRequest<RequestWithAuthContext>();
    return request?.auth ?? null;
  },
);
