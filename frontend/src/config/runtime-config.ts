export const PUBLIC_RUNTIME_CONFIG_KEYS = [
  'VITE_API_URL',
  'VITE_APP_NAME',
  'VITE_APP_VERSION',
  'VITE_FRONTEND_BRANCH',
  'VITE_BACKEND_BRANCH',
  'VITE_GIT_SHA',
  'VITE_ENABLE_CONNECTIONS',
  'VITE_ENABLE_IT_OPS',
  'VITE_DEVTOOLS',
  'VITE_DISABLE_ANALYTICS',
  'VITE_LOGO_DEV_PUBLIC_KEY',
  'VITE_PUBLIC_POSTHOG_KEY',
  'VITE_PUBLIC_POSTHOG_HOST',
  'VITE_OPENSEARCH_DASHBOARDS_URL',
  'VITE_AUTH_PROVIDER',
  'VITE_CLERK_PUBLISHABLE_KEY',
  'VITE_CLERK_JWT_TEMPLATE',
  'VITE_API_AUTH_PROVIDER',
  'VITE_DEFAULT_ORG_ID',
  'VITE_DEFAULT_ORG',
  'VITE_DEFAULT_USER_ID',
  'VITE_GITHUB_TEMPLATE_REPO',
  'VITE_GITHUB_TEMPLATE_BRANCH',
  'VITE_COMMUNITY_TEMPLATES_INDEX_URL',
] as const;

export type PublicRuntimeConfigKey = (typeof PUBLIC_RUNTIME_CONFIG_KEYS)[number];
export type RawFrontendConfig = Record<string, unknown>;
export type PublicRuntimeConfig = Partial<Record<PublicRuntimeConfigKey, string>>;

type RuntimeConfigGlobal = typeof globalThis & {
  __SENTRIS_RUNTIME_CONFIG__?: unknown;
};

function isRecord(value: unknown): value is RawFrontendConfig {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readRuntimeConfig(): RawFrontendConfig {
  const runtimeConfig = (globalThis as RuntimeConfigGlobal).__SENTRIS_RUNTIME_CONFIG__;
  if (runtimeConfig === undefined) {
    return {};
  }
  if (!isRecord(runtimeConfig)) {
    throw new Error('Frontend runtime config must be an object');
  }
  return runtimeConfig;
}

export function mergeFrontendEnv(
  buildConfig: RawFrontendConfig,
  runtimeConfig: unknown,
): RawFrontendConfig {
  if (runtimeConfig === undefined) {
    return { ...buildConfig };
  }
  if (!isRecord(runtimeConfig)) {
    throw new Error('Frontend runtime config must be an object');
  }

  const merged = { ...buildConfig };
  for (const key of PUBLIC_RUNTIME_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(runtimeConfig, key)) {
      merged[key] = runtimeConfig[key];
    }
  }
  return merged;
}

export function selectPublicRuntimeConfig(
  source: Record<string, string | undefined>,
): PublicRuntimeConfig {
  const selected: PublicRuntimeConfig = {};
  for (const key of PUBLIC_RUNTIME_CONFIG_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      selected[key] = value;
    }
  }
  return selected;
}

export function serializeRuntimeConfig(source: Record<string, string | undefined>): string {
  const json = JSON.stringify(selectPublicRuntimeConfig(source))
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return `globalThis.__SENTRIS_RUNTIME_CONFIG__ = Object.freeze(${json});\n`;
}

export function resolveApiBaseUrl(
  configuredUrl: string | undefined,
  browserOrigin: string | undefined,
): string {
  const candidate = configuredUrl?.trim() || browserOrigin?.trim() || '';
  return candidate.replace(/\/+$/, '');
}

export function resolveApiUrl(
  path: string,
  configuredUrl: string | undefined,
  browserOrigin: string | undefined,
): string {
  const normalizedPath = `/${path.replace(/^\/+/, '')}`;
  return `${resolveApiBaseUrl(configuredUrl, browserOrigin)}${normalizedPath}`;
}
