import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..', '..');
const dockerfile = readFileSync(resolve(repositoryRoot, 'Dockerfile'), 'utf8');
const compose = readFileSync(resolve(repositoryRoot, 'docker', 'docker-compose.full.yml'), 'utf8');
const release = readFileSync(
  resolve(repositoryRoot, '.github', 'workflows', 'release.yml'),
  'utf8',
);
const justfile = readFileSync(resolve(repositoryRoot, 'justfile'), 'utf8');
const backendEnvironmentExample = readFileSync(
  resolve(repositoryRoot, 'backend', '.env.example'),
  'utf8',
);
const selfHosting = readFileSync(resolve(repositoryRoot, 'docs', 'self-hosting.mdx'), 'utf8');
const commandReference = readFileSync(
  resolve(repositoryRoot, 'docs', 'command-reference.mdx'),
  'utf8',
);

const backendStage = dockerfile
  .split('# BACKEND SERVICE')[1]!
  .split('# WORKER SERVICE')[0]!;
const workerStage = dockerfile
  .split('# WORKER SERVICE')[1]!
  .split('# FRONTEND SERVICE')[0]!;
const composeBackendService = compose.split('\n  backend:')[1]!.split('\n  frontend:')[0]!;
const releaseBackendAndWorkerSteps = release
  .split('- name: Build and push backend image')[1]!
  .split('- name: Build and push frontend image')[0]!;
const productionImageCommands = justfile.split('prod-images action="start":')[1]!;

describe('self-hosted server runtime configuration', () => {
  it('keeps optional server analytics out of generic release image layers', () => {
    for (const stage of [backendStage, workerStage]) {
      expect(stage).not.toContain('ARG POSTHOG_API_KEY');
      expect(stage).not.toContain('ARG POSTHOG_HOST');
      expect(stage).not.toContain('ENV POSTHOG_API_KEY');
      expect(stage).not.toContain('ENV POSTHOG_HOST');
    }
    expect(releaseBackendAndWorkerSteps).not.toContain('POSTHOG_API_KEY=');
    expect(releaseBackendAndWorkerSteps).not.toContain('POSTHOG_HOST=');
    expect(productionImageCommands).not.toContain('--build-arg POSTHOG_API_KEY');
    expect(productionImageCommands).not.toContain('--build-arg POSTHOG_HOST');
    expect(productionImageCommands).not.toContain('--build-arg VITE_PUBLIC_POSTHOG_KEY');
    expect(productionImageCommands).not.toContain('--build-arg VITE_PUBLIC_POSTHOG_HOST');
  });

  it('lets the backend operator opt into analytics and a separate frontend origin at runtime', () => {
    expect(composeBackendService).toContain('- POSTHOG_API_KEY=${POSTHOG_API_KEY:-}');
    expect(composeBackendService).toContain('- POSTHOG_HOST=${POSTHOG_HOST:-}');
    expect(composeBackendService).toContain('- DISABLE_ANALYTICS=${DISABLE_ANALYTICS:-false}');
    expect(composeBackendService).toContain(
      '- CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS:-}',
    );
  });

  it('documents the runtime-only, opt-in contract and matching environment names', () => {
    for (const variable of [
      'POSTHOG_API_KEY',
      'POSTHOG_HOST',
      'DISABLE_ANALYTICS',
      'CORS_ALLOWED_ORIGINS',
    ]) {
      expect(backendEnvironmentExample).toContain(variable);
      expect(selfHosting).toContain(variable);
    }
    expect(selfHosting).toContain('disabled unless both');
    expect(commandReference).not.toContain('PostHog analytics baked in');
  });
});
