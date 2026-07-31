import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { RequestWithAuthContext } from './auth.guard';

@Injectable()
export class InternalOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuthContext>();
    if (
      request.auth?.provider !== 'internal' ||
      request.auth.userId !== 'internal-service' ||
      request.auth.isAuthenticated !== true
    ) {
      throw new ForbiddenException('Internal service authentication required');
    }
    return true;
  }
}
