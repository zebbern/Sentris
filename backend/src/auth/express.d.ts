import type { AuthContext } from './types';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}
