import { z } from 'zod';

/**
 * Explicit string→boolean for VITE_* flags.
 * Accepts 'true', 'false', '', or undefined. Never uses z.coerce.boolean().
 */
function viteBoolean(defaultValue = false) {
  return z
    .enum(['true', 'false', ''])
    .optional()
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => v === 'true');
}

function publicHttpUrl(defaultValue = '') {
  return z
    .string()
    .optional()
    .default(defaultValue)
    .superRefine((value, ctx) => {
      if (!value || (value.startsWith('/') && !value.startsWith('//'))) {
        return;
      }

      try {
        const url = new URL(value);
        if (
          (url.protocol === 'http:' || url.protocol === 'https:') &&
          !url.username &&
          !url.password
        ) {
          return;
        }
      } catch {
        // Report one consistent validation issue below.
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'must be empty, root-relative, or an absolute HTTP(S) URL without embedded credentials',
      });
    });
}

export const frontendEnvSchema = z
  .object({
    // An empty API URL resolves to window.location.origin at runtime.
    VITE_API_URL: publicHttpUrl(),

    // Application metadata
    VITE_APP_NAME: z.string().optional().default(''),
    VITE_APP_VERSION: z.string().optional().default(''),
    VITE_FRONTEND_BRANCH: z.string().optional().default(''),
    VITE_BACKEND_BRANCH: z.string().optional().default(''),
    VITE_GIT_SHA: z.string().optional().default(''),

    // Feature flags
    VITE_ENABLE_CONNECTIONS: viteBoolean(true),
    VITE_ENABLE_IT_OPS: viteBoolean(false),
    VITE_DEVTOOLS: viteBoolean(false),
    VITE_DISABLE_ANALYTICS: viteBoolean(false),

    // Third-party integrations
    VITE_LOGO_DEV_PUBLIC_KEY: z.string().optional().default(''),
    VITE_PUBLIC_POSTHOG_KEY: z.string().optional().default(''),
    VITE_PUBLIC_POSTHOG_HOST: publicHttpUrl(),
    VITE_OPENSEARCH_DASHBOARDS_URL: publicHttpUrl(),

    // Auth
    VITE_AUTH_PROVIDER: z.enum(['', 'local', 'clerk']).optional().default(''),
    VITE_CLERK_PUBLISHABLE_KEY: z.string().optional().default(''),
    VITE_CLERK_JWT_TEMPLATE: z.string().optional().default(''),
    VITE_API_AUTH_PROVIDER: z.enum(['', 'local', 'clerk']).optional().default(''),

    // Local defaults and template publishing
    VITE_DEFAULT_ORG_ID: z.string().optional().default(''),
    VITE_DEFAULT_ORG: z.string().optional().default(''),
    VITE_DEFAULT_USER_ID: z.string().optional().default(''),
    VITE_GITHUB_TEMPLATE_REPO: z.string().optional().default(''),
    VITE_GITHUB_TEMPLATE_BRANCH: z.string().optional().default(''),
    VITE_COMMUNITY_TEMPLATES_INDEX_URL: publicHttpUrl(
      'https://raw.githubusercontent.com/zebbern/Sentris/main/community/template/index.json',
    ),
  })
  .superRefine((data, ctx) => {
    // If auth provider is clerk, VITE_CLERK_PUBLISHABLE_KEY is required
    const provider = data.VITE_AUTH_PROVIDER.trim().toLowerCase();
    if (provider === 'clerk' && !data.VITE_CLERK_PUBLISHABLE_KEY.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VITE_CLERK_PUBLISHABLE_KEY'],
        message: 'VITE_CLERK_PUBLISHABLE_KEY is required when VITE_AUTH_PROVIDER=clerk',
      });
    }
  });

export type FrontendEnvConfig = z.infer<typeof frontendEnvSchema>;
