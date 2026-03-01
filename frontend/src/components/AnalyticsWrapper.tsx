import React, { useEffect, useState } from 'react';
import { isAnalyticsEnabled } from '@/features/analytics/config';
import { logger } from '@/lib/logger';

const hasPostHog = isAnalyticsEnabled();

// Print analytics status (dev-only)
if (import.meta.env.DEV) {
  if (hasPostHog) {
    logger.info('📊 Analytics enabled - PostHog is collecting usage data');
  } else {
    logger.info('📊 Analytics disabled - No usage data will be collected');
  }
}

// Dynamically initialize PostHog when analytics is enabled.
// The posthog-js bundle (~40 KB gzip) is only fetched when needed.
const posthogReadyPromise: Promise<{
  posthog: import('posthog-js').PostHog;
  PostHogProvider: typeof import('posthog-js/react').PostHogProvider;
}> | null = hasPostHog
  ? Promise.all([import('posthog-js'), import('posthog-js/react')]).then(
      ([{ default: posthog }, { PostHogProvider }]) => {
        const apiKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY!;
        const apiHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST!;
        posthog.init(apiKey, {
          api_host: apiHost,
          autocapture: true,
          capture_pageview: false, // we capture pageviews via a router listener
          capture_exceptions: true,
          session_recording: {
            maskAllText: false,
            maskAllInputs: true,
          },
          respect_dnt: true,
          debug: import.meta.env.DEV,
        });
        return { posthog, PostHogProvider };
      },
    )
  : null;

/**
 * Wrapper that renders children immediately and wraps with <PostHogProvider>
 * once the dynamic import resolves. No render delay for the user.
 */
export function AnalyticsWrapper({ children }: { children: React.ReactNode }) {
  const [analytics, setAnalytics] = useState<{
    posthog: import('posthog-js').PostHog;
    PostHogProvider: typeof import('posthog-js/react').PostHogProvider;
  } | null>(null);

  useEffect(() => {
    if (!posthogReadyPromise) return;
    posthogReadyPromise.then(setAnalytics);
  }, []);

  if (analytics) {
    const { PostHogProvider, posthog } = analytics;
    return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
  }
  return <>{children}</>;
}
