import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

interface ComposeService {
  command?: string[];
  entrypoint?: string[];
  environment?: string[];
  networks?: string[];
  ports?: string[];
  expose?: string[];
  volumes?: string[];
  healthcheck?: { test?: string[] };
  depends_on?: Record<string, { condition?: string }>;
}

interface ComposeDocument {
  services: Record<string, ComposeService>;
  networks: Record<string, { internal?: boolean }>;
  volumes: Record<string, unknown>;
}

const composePath = fileURLToPath(
  new URL('../../../../docker/docker-compose.full.yml', import.meta.url),
);
const infraComposePath = fileURLToPath(
  new URL('../../../../docker/docker-compose.infra.yml', import.meta.url),
);
const dockerfilePath = fileURLToPath(new URL('../../../../Dockerfile', import.meta.url));

function environmentOf(service: ComposeService): Record<string, string> {
  return Object.fromEntries(
    (service.environment ?? []).map((entry) => {
      const separator = entry.indexOf('=');
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
}

describe('production worker and DIND topology', () => {
  it('bootstraps the production Temporal namespace before application services start', async () => {
    const compose = yaml.load(await readFile(composePath, 'utf8')) as ComposeDocument;
    const temporal = compose.services.temporal;
    const temporalEnv = environmentOf(temporal);
    const temporalHealthcheck = temporal.healthcheck?.test?.join(' ') ?? '';

    expect(temporalEnv.DEFAULT_NAMESPACE).toBe('sentris-prod');
    expect(temporalHealthcheck).toContain('namespace describe');
    expect(temporalHealthcheck).toContain('sentris-prod');
    expect(compose.services.backend.depends_on?.temporal?.condition).toBe('service_healthy');
    expect(compose.services.worker.depends_on?.temporal?.condition).toBe('service_healthy');
    expect(environmentOf(compose.services['temporal-ui']).TEMPORAL_NAMESPACE).toBe('sentris-prod');
  });

  it('keeps the Docker API on an egress-capable worker-only control network', async () => {
    const compose = yaml.load(await readFile(composePath, 'utf8')) as ComposeDocument;
    const { dind, worker } = compose.services;

    expect(dind.networks).toEqual(['docker-control']);
    expect(worker.networks).toEqual(expect.arrayContaining(['default', 'docker-control']));
    expect(compose.networks['docker-control'].internal).not.toBe(true);
    expect(dind.ports).toBeUndefined();

    const unauthorizedMembers = Object.entries(compose.services)
      .filter(([name]) => name !== 'worker' && name !== 'dind')
      .filter(([, service]) => service.networks?.includes('docker-control'))
      .map(([name]) => name);
    expect(unauthorizedMembers).toEqual([]);
  });

  it('shares only the generated client TLS directory and the run-scoped exchange volume', async () => {
    const compose = yaml.load(await readFile(composePath, 'utf8')) as ComposeDocument;
    const { dind, worker } = compose.services;
    const dindEnv = environmentOf(dind);

    expect(dind.volumes).toEqual(
      expect.arrayContaining([
        'dind_ca:/certs/ca',
        'dind_client_certs:/certs/client',
        'dind_io:/sentris-docker-io',
      ]),
    );
    expect(worker.volumes).toEqual(
      expect.arrayContaining(['dind_client_certs:/certs/client:ro', 'dind_io:/sentris-docker-io']),
    );
    expect(worker.volumes).not.toContain('dind_ca:/certs/ca:ro');
    expect(dindEnv.DOCKER_TLS_CERTDIR).toBe('/certs');
    expect(dind.entrypoint?.join('\n')).toContain('/usr/local/bin/dockerd-entrypoint.sh');
    expect(dind.command).not.toEqual(expect.arrayContaining([expect.stringContaining('--host=')]));
    expect(compose.volumes).toHaveProperty('dind_ca');
    expect(compose.volumes).toHaveProperty('dind_client_certs');
    expect(compose.volumes).toHaveProperty('dind_io');

    const exchangeMountUsers = Object.entries(compose.services)
      .filter(([, service]) => service.volumes?.some((volume) => volume.startsWith('dind_io:')))
      .map(([name]) => name)
      .sort();
    expect(exchangeMountUsers).toEqual(['dind', 'worker']);
  });

  it('uses worker configuration names that match runtime consumers', async () => {
    const compose = yaml.load(await readFile(composePath, 'utf8')) as ComposeDocument;
    const worker = compose.services.worker;
    const env = environmentOf(worker);

    expect(env.MINIO_ACCESS_KEY).toBe('minioadmin');
    expect(env.MINIO_SECRET_KEY).toBe('minioadmin');
    expect(env.MINIO_ROOT_USER).toBeUndefined();
    expect(env.MINIO_ROOT_PASSWORD).toBeUndefined();
    expect(env.SECRET_STORE_MASTER_KEY).toContain('SECRET_STORE_MASTER_KEY');
    expect(env.DOCKER_HOST).toBe('tcp://dind:2376');
    expect(env.DOCKER_TLS_VERIFY).toBe('1');
    expect(env.DOCKER_CERT_PATH).toBe('/certs/client');
    expect(env.SENTRIS_DOCKER_SHARED_IO_ROOT).toBe('/sentris-docker-io');
    expect(env.SENTRIS_DIND_HOST).toBe('dind');
    expect(env.SENTRIS_DEPLOYMENT_ID).toBe('${SENTRIS_DEPLOYMENT_ID:-sentris}');
    expect(env.SENTRIS_INSTANCE).toBe('${SENTRIS_INSTANCE:-0}');
    expect(env.TEMPORAL_NAMESPACE).toBe('sentris-prod');
    expect(env.TEMPORAL_TASK_QUEUE).toBe('sentris-prod');
    expect(env.SENTRIS_PUBLIC_API_BASE_URL).toBe(
      '${SENTRIS_PUBLIC_API_BASE_URL:?SENTRIS_PUBLIC_API_BASE_URL is required}',
    );
    expect(env.MCP_DOCKER_PROXY_PORT).toBe('9101');
    expect(env.MCP_DOCKER_PROXY_PUBLIC_BASE_URL).toBe('http://worker:9101');
    expect(env.MCP_DOCKER_PROXY_TOKEN).toBe('${MCP_DOCKER_PROXY_TOKEN:-}');
    expect(env.MCP_RUNTIME_REDIS_URL).toBe('redis://redis:6379');
    expect(env.MCP_RUNTIME_OWNER_ID).toBe('sentris-worker-${SENTRIS_INSTANCE:-0}');
    expect(env.MCP_RUNTIME_OWNER_URL).toBe('http://sentris-worker:9301');
    expect(env.MCP_RUNTIME_LISTEN_HOST).toBe('0.0.0.0');
    expect(env.MCP_RUNTIME_LISTEN_PORT).toBe('9301');
    expect(env.WORKER_ORPHAN_MIN_AGE_MS).toBe('${WORKER_ORPHAN_MIN_AGE_MS:-3600000}');
    expect(env.WORKER_ORPHAN_INTERVAL_MS).toBe('${WORKER_ORPHAN_INTERVAL_MS:-900000}');
    expect(env.WORKER_ORPHAN_MAX_RESOURCES).toBe('${WORKER_ORPHAN_MAX_RESOURCES:-100}');
    expect(env.WORKER_ORPHAN_MAX_INVENTORY).toBe('${WORKER_ORPHAN_MAX_INVENTORY:-500}');
    expect(env.WORKER_ORPHAN_DOCKER_TIMEOUT_MS).toBe('${WORKER_ORPHAN_DOCKER_TIMEOUT_MS:-10000}');
    expect(env.WORKER_ORPHAN_RUN_STATE_TIMEOUT_MS).toBe(
      '${WORKER_ORPHAN_RUN_STATE_TIMEOUT_MS:-3000}',
    );
    expect(env.BACKEND_URL).toBe('http://backend:3211');
    expect(worker.depends_on?.backend?.condition).toBe('service_healthy');
  });

  it('routes every backend Redis consumer to the production Redis service', async () => {
    const compose = yaml.load(await readFile(composePath, 'utf8')) as ComposeDocument;
    const backend = compose.services.backend;
    const backendEnv = environmentOf(backend);
    const workerEnv = environmentOf(compose.services.worker);

    expect(backendEnv.REDIS_URL).toBe('redis://redis:6379');
    expect(backendEnv.TERMINAL_REDIS_URL).toBe(backendEnv.REDIS_URL);
    expect(workerEnv.TERMINAL_REDIS_URL).toBe(backendEnv.REDIS_URL);
    expect(backend.depends_on?.redis?.condition).toBe('service_healthy');
  });

  it('resolves identical instance-scoped telemetry topics and identities on both sides', async () => {
    const compose = yaml.load(await readFile(composePath, 'utf8')) as ComposeDocument;
    const backendEnv = environmentOf(compose.services.backend);
    const workerEnv = environmentOf(compose.services.worker);
    const topicKeys = [
      'LOG_KAFKA_TOPIC',
      'EVENT_KAFKA_TOPIC',
      'AGENT_TRACE_KAFKA_TOPIC',
      'NODE_IO_KAFKA_TOPIC',
    ] as const;

    expect(backendEnv.SENTRIS_INSTANCE).toBe('${SENTRIS_INSTANCE:-0}');
    expect(workerEnv.SENTRIS_INSTANCE).toBe(backendEnv.SENTRIS_INSTANCE);
    for (const topicKey of topicKeys) {
      expect(backendEnv[topicKey]).toBeTruthy();
      expect(workerEnv[topicKey]).toBeTruthy();
      expect(`${backendEnv[topicKey]}.instance-${backendEnv.SENTRIS_INSTANCE}`).toBe(
        `${workerEnv[topicKey]}.instance-${workerEnv.SENTRIS_INSTANCE}`,
      );
    }

    for (const clientIdKey of [
      'LOG_KAFKA_CLIENT_ID',
      'EVENT_KAFKA_CLIENT_ID',
      'AGENT_TRACE_KAFKA_CLIENT_ID',
      'NODE_IO_KAFKA_CLIENT_ID',
    ]) {
      expect(backendEnv[clientIdKey]).toContain('${SENTRIS_INSTANCE:-0}');
      expect(workerEnv[clientIdKey]).toContain('${SENTRIS_INSTANCE:-0}');
    }
  });

  it('defers production local-credential requirements to auth-aware backend validation', async () => {
    const compose = yaml.load(await readFile(composePath, 'utf8')) as ComposeDocument;
    const backendEnv = environmentOf(compose.services.backend);

    expect(backendEnv.AUTH_PROVIDER).toBe('${AUTH_PROVIDER:-local}');
    expect(backendEnv.ADMIN_USERNAME).toBe('${ADMIN_USERNAME:-}');
    expect(backendEnv.ADMIN_PASSWORD).toBe('${ADMIN_PASSWORD:-}');
    expect(compose.services.nginx.ports).toContain('80:80');
  });

  it('keeps Redpanda replay retention aligned with backend receipt pruning', async () => {
    const fullCompose = yaml.load(await readFile(composePath, 'utf8')) as ComposeDocument;
    const infraCompose = yaml.load(await readFile(infraComposePath, 'utf8')) as ComposeDocument;
    const retentionArgument = 'redpanda.log_retention_ms=604800000';

    expect(fullCompose.services.redpanda.command).toEqual(
      expect.arrayContaining(['--set', retentionArgument]),
    );
    expect(infraCompose.services.redpanda.command).toEqual(
      expect.arrayContaining(['--set', retentionArgument]),
    );
    expect(environmentOf(fullCompose.services.backend).TELEMETRY_KAFKA_REPLAY_RETENTION_DAYS).toBe(
      '7',
    );
  });

  it('routes image and compose healthchecks to real worker readiness', async () => {
    const compose = yaml.load(await readFile(composePath, 'utf8')) as ComposeDocument;
    const worker = compose.services.worker;
    const dockerfile = await readFile(dockerfilePath, 'utf8');

    expect(worker.expose).toEqual(expect.arrayContaining(['9100', '9101', '9301']));
    expect(worker.ports).toBeUndefined();
    expect(worker.healthcheck?.test).toEqual([
      'CMD',
      'curl',
      '-sf',
      'http://localhost:9100/health/ready',
    ]);
    expect(dockerfile).toContain('EXPOSE 9100 9101 9301');
    expect(dockerfile).toContain('curl -sf http://localhost:9100/health/ready');
    expect(dockerfile).toContain('curl -sf http://localhost:3211/api/v1/health');
  });
});
