import { beforeAll, describe, expect, it } from 'bun:test';
import { componentRegistry, type DockerRunnerConfig } from '@sentris/component-sdk';
import {
  SECURITY_COMPONENT_IDS,
  buildSecurityComponentManifest,
  getSecurityComponentInvariantFailures,
} from '../security-component-manifest';
import {
  getSecurityDockerResourceProfile,
  SECURITY_DOCKER_COMPONENT_IDS,
} from '../security-docker-resources';

describe('security component catalog', () => {
  beforeAll(async () => {
    await import('../register-all');
  });

  it('registers all 28 security palette components', () => {
    for (const componentId of SECURITY_COMPONENT_IDS) {
      expect(componentRegistry.has(componentId), `${componentId} should be registered`).toBe(true);
    }
  });

  it('passes manifest invariants for every security component', () => {
    const failures = getSecurityComponentInvariantFailures(componentRegistry.listMetadata());
    expect(failures).toEqual([]);
  });

  it('builds a manifest entry for each security component id', () => {
    const manifest = buildSecurityComponentManifest(componentRegistry.listMetadata());
    expect(manifest).toHaveLength(SECURITY_COMPONENT_IDS.length);
    expect(manifest.map((entry) => entry.id).sort()).toEqual([...SECURITY_COMPONENT_IDS].sort());
  });

  it('assigns explicit docker resource profiles to every docker security component', () => {
    expect(SECURITY_DOCKER_COMPONENT_IDS.length).toBeGreaterThan(0);

    for (const componentId of SECURITY_DOCKER_COMPONENT_IDS) {
      const component = componentRegistry.get(componentId);
      expect(component, `${componentId} should be registered`).toBeDefined();
      expect(component!.runner.kind).toBe('docker');

      const profile = getSecurityDockerResourceProfile(componentId);
      const runner = component!.runner as DockerRunnerConfig;
      expect(runner.memoryLimit).toBe(profile.memoryLimit);
      expect(runner.cpuLimit).toBe(profile.cpuLimit);
      expect(runner.pidsLimit).toBe(profile.pidsLimit);

      const metadata = componentRegistry
        .listMetadata()
        .find((entry) => entry.definition.id === componentId);
      const parameterIds = metadata?.parameters.map((parameter) => parameter.id) ?? [];
      expect(parameterIds).toContain('overrideContainerResources');
      expect(parameterIds).toContain('containerMemoryLimit');
      expect(parameterIds).toContain('containerCpuLimit');
    }
  });
});
