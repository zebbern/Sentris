import { SetMetadata } from '@nestjs/common';

import type { AuthRole } from './types';

export const AUTH_ROLES_KEY = 'sentris:auth:roles';

export const Roles = (...roles: AuthRole[]) => SetMetadata(AUTH_ROLES_KEY, roles);
