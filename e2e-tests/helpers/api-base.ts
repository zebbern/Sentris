const DEFAULT_INSTANCE = 0;
const BACKEND_BASE_PORT = 3211;
type E2eEnvironment = Record<string, string | undefined>;

function readInstance(env: E2eEnvironment = process.env): number {
  const raw = env.SENTRIS_INSTANCE ?? env.E2E_INSTANCE ?? String(DEFAULT_INSTANCE);
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return DEFAULT_INSTANCE;
  }
  return parsed;
}

export function getE2EInstance(): number {
  return readInstance();
}

export function getBackendPortForInstance(instance: number): number {
  return BACKEND_BASE_PORT + instance * 100;
}

export function getApiBaseUrl(env: E2eEnvironment = process.env): string {
  const override = env.E2E_API_BASE_URL?.trim();
  if (override) {
    const parsed = new URL(override);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('E2E_API_BASE_URL must use http or https');
    }
    return parsed.toString().replace(/\/+$/, '');
  }

  const instance = readInstance(env);
  const port = getBackendPortForInstance(instance);
  return `http://127.0.0.1:${port}/api/v1`;
}

