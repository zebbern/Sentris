import { describe, expect, it } from 'bun:test';
import type { DockerRunnerConfig } from '@sentris/component-sdk';
import {
  mergeSecurityDockerRunner,
  SECURITY_DOCKER_RESOURCE_HEAVY,
  SECURITY_DOCKER_RESOURCE_LIGHT,
} from '../security-docker-resources';

describe('security-docker-resources', () => {
  it('mergeSecurityDockerRunner preserves resource limits from the base runner', () => {
    const baseRunner: DockerRunnerConfig = {
      kind: 'docker',
      ...SECURITY_DOCKER_RESOURCE_HEAVY,
      image: 'example:latest',
      network: 'bridge',
      command: [],
    };

    const merged = mergeSecurityDockerRunner(baseRunner, {
      command: ['scan'],
      volumes: [{ source: '/tmp/a', target: '/data' }],
    });

    expect(merged.memoryLimit).toBe('2g');
    expect(merged.cpuLimit).toBe('2');
    expect(merged.pidsLimit).toBe(1024);
    expect(merged.command).toEqual(['scan']);
  });

  it('defines distinct light and heavy profiles', () => {
    expect(SECURITY_DOCKER_RESOURCE_LIGHT.memoryLimit).not.toBe(
      SECURITY_DOCKER_RESOURCE_HEAVY.memoryLimit,
    );
  });
});
