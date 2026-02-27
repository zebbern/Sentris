import type { Request } from 'express';

import type { AuthContext } from '../types';

export interface AuthProviderStrategy {
  readonly name: string;
  authenticate(request: Request): Promise<AuthContext>;
}
