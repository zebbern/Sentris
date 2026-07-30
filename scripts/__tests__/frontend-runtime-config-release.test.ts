import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { serializeRuntimeConfig } from '../../frontend/src/config/runtime-config';
import { writeRuntimeConfigFile } from '../../frontend/src/scripts/generate-runtime-config';

const repositoryRoot = resolve(import.meta.dir, '..', '..');
const dockerfile = readFileSync(resolve(repositoryRoot, 'Dockerfile'), 'utf8');
const compose = readFileSync(resolve(repositoryRoot, 'docker', 'docker-compose.full.yml'), 'utf8');
const release = readFileSync(
  resolve(repositoryRoot, '.github', 'workflows', 'release.yml'),
  'utf8',
);
const indexHtml = readFileSync(resolve(repositoryRoot, 'frontend', 'index.html'), 'utf8');
const backendEnvironmentExample = readFileSync(
  resolve(repositoryRoot, 'backend', '.env.example'),
  'utf8',
);
const productionNginx = readFileSync(
  resolve(repositoryRoot, 'docker', 'nginx', 'nginx.prod.conf'),
  'utf8',
);
const authProvider = readFileSync(
  resolve(repositoryRoot, 'frontend', 'src', 'auth', 'AuthProvider.tsx'),
  'utf8',
);
const adminLoginForm = readFileSync(
  resolve(repositoryRoot, 'frontend', 'src', 'components', 'auth', 'AdminLoginForm.tsx'),
  'utf8',
);

const productionFrontendStage = dockerfile
  .split('# FRONTEND SERVICE')[1]!
  .split('# FRONTEND DEBUG SERVICE')[0]!;
const composeBackendService = compose.split('\n  backend:')[1]!.split('\n  frontend:')[0]!;
const composeFrontendService = compose.split('\n  frontend:')[1]!.split('\n  worker:')[0]!;
const releaseFrontendStep = release
  .split('- name: Build and push frontend image')[1]!
  .split('- name: Generate changelog')[0]!;

function hashFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function hashDistExceptRuntimeConfig(
  directory: string,
  currentDirectory = directory,
): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
    const entryPath = resolve(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(hashes, hashDistExceptRuntimeConfig(directory, entryPath));
      continue;
    }
    if (!entry.isFile() || entry.name === 'runtime-config.js') {
      continue;
    }
    hashes[relative(directory, entryPath).replace(/\\/g, '/')] = hashFile(entryPath);
  }
  return Object.fromEntries(
    Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right)),
  );
}

describe('released frontend runtime config wiring', () => {
  it('loads runtime config synchronously before the application bundle', () => {
    const configIndex = indexHtml.indexOf('src="/runtime-config.js"');
    const appIndex = indexHtml.indexOf('src="/src/main.tsx"');

    expect(configIndex).toBeGreaterThan(-1);
    expect(configIndex).toBeLessThan(appIndex);
  });

  it('prevents stale runtime configuration at the public production proxy', () => {
    const runtimeConfigLocation = productionNginx.match(
      /location = \/runtime-config\.js \{[\s\S]*?\n\s{8}\}/,
    )?.[0];

    expect(runtimeConfigLocation).toBeDefined();
    expect(runtimeConfigLocation).toContain('proxy_pass http://frontend/runtime-config.js;');
    expect(runtimeConfigLocation).toContain('proxy_hide_header Cache-Control;');
    expect(runtimeConfigLocation).toContain('add_header Cache-Control "no-store" always;');
    expect(productionNginx.indexOf('location = /runtime-config.js')).toBeLessThan(
      productionNginx.indexOf('location / {'),
    );
  });

  it('allows runtime-selected API and auth provider origins through production CSP', () => {
    const contentSecurityPolicies =
      productionNginx.match(/add_header Content-Security-Policy "[^"]+" always;/g) ?? [];

    expect(productionNginx).toContain('Deliberate runtime-provider capability tradeoff');
    expect(contentSecurityPolicies.length).toBeGreaterThan(0);
    for (const policy of contentSecurityPolicies) {
      expect(policy).toContain("script-src 'self' 'unsafe-inline' https:;");
      expect(policy).toContain("img-src 'self' data: blob: https: http:;");
      expect(policy).toContain("connect-src 'self' http: https: ws: wss:;");
      expect(policy).toContain("frame-src 'self' https:;");
      expect(policy).toContain("frame-ancestors 'none';");
    }
  });

  it('routes every local-auth request through the runtime API URL resolver', () => {
    expect(authProvider).toContain("buildFrontendApiUrl('/api/v1/auth/validate')");
    expect(authProvider).toContain("buildFrontendApiUrl('/api/v1/auth/logout')");
    expect(adminLoginForm).toContain("buildFrontendApiUrl('/api/v1/auth/login')");
    expect(authProvider).not.toMatch(/fetch\(['"]\/api\/v1\/auth/);
    expect(adminLoginForm).not.toMatch(/fetch\(['"]\/api\/v1\/auth/);
  });

  it('generates runtime config after the one production build instead of rebuilding per profile', () => {
    expect(productionFrontendStage.match(/RUN bun run build/g)).toHaveLength(1);
    expect(productionFrontendStage).toContain('bun src/scripts/generate-runtime-config.ts');

    for (const profileSpecificArg of [
      'ARG VITE_API_URL',
      'ARG VITE_AUTH_PROVIDER',
      'ARG VITE_CLERK_PUBLISHABLE_KEY',
      'ARG VITE_PUBLIC_POSTHOG_KEY',
      'ARG VITE_PUBLIC_POSTHOG_HOST',
      'ARG VITE_OPENSEARCH_DASHBOARDS_URL',
    ]) {
      expect(productionFrontendStage).not.toContain(profileSpecificArg);
    }

    const trustedLocalConfig = serializeRuntimeConfig({
      VITE_AUTH_PROVIDER: 'local',
      VITE_API_URL: '',
    });
    const hardenedConfig = serializeRuntimeConfig({
      VITE_AUTH_PROVIDER: 'clerk',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_runtime',
      VITE_API_URL: 'https://api.example',
    });

    expect(trustedLocalConfig).not.toBe(hardenedConfig);
  });

  it('passes operator settings at container runtime and not as Compose build arguments', () => {
    expect(composeFrontendService).not.toMatch(/\n\s+args:/);
    for (const variable of [
      'VITE_API_URL',
      'VITE_AUTH_PROVIDER',
      'VITE_DEFAULT_ORG_ID',
      'VITE_DEFAULT_ORG',
      'VITE_CLERK_PUBLISHABLE_KEY',
      'VITE_CLERK_JWT_TEMPLATE',
      'VITE_PUBLIC_POSTHOG_KEY',
      'VITE_PUBLIC_POSTHOG_HOST',
      'VITE_DISABLE_ANALYTICS',
      'VITE_OPENSEARCH_DASHBOARDS_URL',
    ]) {
      expect(composeFrontendService).toContain(`- ${variable}=`);
    }
  });

  it('forwards the CORS allowlist required by a separately hosted API', () => {
    expect(composeBackendService).toContain('- CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS:-}');
    expect(backendEnvironmentExample).toContain('CORS_ALLOWED_ORIGINS=""');
    expect(backendEnvironmentExample).toContain('Local session auth supports same-site origins');
    expect(backendEnvironmentExample).toContain('use HTTPS in production');
  });

  it('does not publish profile-specific frontend values as release build arguments', () => {
    expect(releaseFrontendStep).not.toContain('VITE_PUBLIC_POSTHOG_KEY=');
    expect(releaseFrontendStep).not.toContain('VITE_PUBLIC_POSTHOG_HOST=');
    expect(releaseFrontendStep).not.toContain('VITE_AUTH_PROVIDER=');
    expect(releaseFrontendStep).not.toContain('VITE_API_URL=');
  });

  it('changes two runtime profiles on one real built dist without changing any other asset', () => {
    const build = Bun.spawnSync([process.execPath, '--cwd=frontend', 'run', 'build'], {
      cwd: repositoryRoot,
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (build.exitCode !== 0) {
      throw new Error(
        `Frontend build failed:\n${build.stderr.toString()}\n${build.stdout.toString()}`,
      );
    }

    const distDirectory = resolve(repositoryRoot, 'frontend', 'dist');
    const runtimeConfigPath = resolve(distDirectory, 'runtime-config.js');
    expect(statSync(runtimeConfigPath).isFile()).toBe(true);

    const originalRuntimeConfig = readFileSync(runtimeConfigPath);
    const originalAssets = hashDistExceptRuntimeConfig(distDirectory);
    try {
      writeRuntimeConfigFile(runtimeConfigPath, {
        VITE_AUTH_PROVIDER: 'local',
        VITE_API_URL: '',
      });
      const trustedLocalRuntimeHash = hashFile(runtimeConfigPath);
      const assetsAfterTrustedLocal = hashDistExceptRuntimeConfig(distDirectory);

      writeRuntimeConfigFile(runtimeConfigPath, {
        VITE_AUTH_PROVIDER: 'clerk',
        VITE_CLERK_PUBLISHABLE_KEY: 'pk_runtime_hash_proof',
        VITE_API_URL: 'https://api.example',
      });
      const hardenedRuntimeHash = hashFile(runtimeConfigPath);
      const assetsAfterHardened = hashDistExceptRuntimeConfig(distDirectory);

      expect(hardenedRuntimeHash).not.toBe(trustedLocalRuntimeHash);
      expect(assetsAfterTrustedLocal).toEqual(originalAssets);
      expect(assetsAfterHardened).toEqual(originalAssets);
    } finally {
      writeFileSync(runtimeConfigPath, originalRuntimeConfig);
    }
  }, 300_000);
});
