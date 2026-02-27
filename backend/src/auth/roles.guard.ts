import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AUTH_ROLES_KEY } from './roles.decorator';
import type { AuthContext, AuthRole } from './types';
import type { RequestWithAuthContext } from './auth.guard';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<AuthRole[]>(AUTH_ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuthContext>();
    if (!request?.auth) {
      return false;
    }

    return this.hasRequiredRole(request.auth, requiredRoles);
  }

  private hasRequiredRole(auth: AuthContext, requiredRoles: AuthRole[]): boolean {
    if (!auth.roles || auth.roles.length === 0) {
      return false;
    }
    return requiredRoles.some((role) => auth.roles.includes(role));
  }
}
