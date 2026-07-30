import { env } from '@/config/env';

export function isAnalyticsEnabled(): boolean {
  return Boolean(
    env.VITE_PUBLIC_POSTHOG_KEY && env.VITE_PUBLIC_POSTHOG_HOST && !env.VITE_DISABLE_ANALYTICS,
  );
}
