import { env } from '@/config/env';

const FALLBACK_USER_ID = 'demo-user';

export function getCurrentUserId(): string {
  const envUser = env.VITE_DEFAULT_USER_ID;
  if (typeof envUser === 'string' && envUser.trim().length > 0) {
    return envUser.trim();
  }
  return FALLBACK_USER_ID;
}
