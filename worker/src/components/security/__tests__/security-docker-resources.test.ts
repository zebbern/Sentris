import { afterEach, describe, expect, it } from 'bun:test';
import { ValidationError, type DockerRunnerConfig } from '@sentris/component-sdk';
import {
  getSecurityDockerMaxCpus,
  getSecurityDockerMaxMemory,
  mergeSecurityDockerRunner,
  resolveSecurityDockerResourceOverrides,
  SECURITY_DOCKER_RESOURCE_HEAVY,
  SECURITY_DOCKER_RESOURCE_LIGHT,
} from '../security-docker-resources';

describe('security-docker-resources', () => {
  afterEach(() => {
    delete process.env.SENTRIS_DOCKER_MAX_MEMORY;
    delete process.env.SENTRIS_DOCKER_MAX_CPUS;
  });

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

  it('applies user memory override over tier defaults', () => {
    const baseRunner: DockerRunnerConfig = {
      kind: 'docker',
      ...SECURITY_DOCKER_RESOURCE_LIGHT,
      image: 'example:latest',
      network: 'bridge',
      command: [],
    };

    const merged = mergeSecurityDockerRunner(
      baseRunner,
      { command: ['scan'] },
      {
        overrideContainerResources: true,
        containerMemoryLimit: '4g',
      },
    );

    expect(merged.memoryLimit).toBe('4g');
    expect(merged.cpuLimit).toBe('1');
  });

  it('ignores overrides when toggle is disabled', () => {
    expect(
      resolveSecurityDockerResourceOverrides({
        overrideContainerResources: false,
        containerMemoryLimit: '4g',
      }),
    ).toEqual({});
  });

  it('requires at least one limit when override is enabled', () => {
    expect(() =>
      resolveSecurityDockerResourceOverrides({
        overrideContainerResources: true,
      }),
    ).toThrow(ValidationError);
  });

  it('rejects invalid memory format', () => {
    expect(() =>
      resolveSecurityDockerResourceOverrides({
        overrideContainerResources: true,
        containerMemoryLimit: 'lots-of-ram',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects memory above platform cap', () => {
    process.env.SENTRIS_DOCKER_MAX_MEMORY = '2g';

    expect(() =>
      resolveSecurityDockerResourceOverrides({
        overrideContainerResources: true,
        containerMemoryLimit: '4g',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects cpu above platform cap', () => {
    process.env.SENTRIS_DOCKER_MAX_CPUS = '2';

    expect(() =>
      resolveSecurityDockerResourceOverrides({
        overrideContainerResources: true,
        containerCpuLimit: '4',
      }),
    ).toThrow(ValidationError);
  });

  it('reads platform caps from env with defaults', () => {
    expect(getSecurityDockerMaxMemory()).toBe('8g');
    expect(getSecurityDockerMaxCpus()).toBe('4');

    process.env.SENTRIS_DOCKER_MAX_MEMORY = '6g';
    process.env.SENTRIS_DOCKER_MAX_CPUS = '3';
    expect(getSecurityDockerMaxMemory()).toBe('6g');
    expect(getSecurityDockerMaxCpus()).toBe('3');
  });

  it('defines distinct light and heavy profiles', () => {
    expect(SECURITY_DOCKER_RESOURCE_LIGHT.memoryLimit).not.toBe(
      SECURITY_DOCKER_RESOURCE_HEAVY.memoryLimit,
    );
  });
});
