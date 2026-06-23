import { z } from 'zod';
import { param, ValidationError, type DockerRunnerConfig } from '@sentris/component-sdk';
import type { SecurityComponentId } from './security-component-manifest';

export type SecurityDockerResourceProfile = Pick<
  DockerRunnerConfig,
  'memoryLimit' | 'cpuLimit' | 'pidsLimit'
>;

/** Fast network/DNS probes and lightweight scanners. */
export const SECURITY_DOCKER_RESOURCE_LIGHT: SecurityDockerResourceProfile = {
  memoryLimit: '768m',
  cpuLimit: '1',
  pidsLimit: 512,
};

/** Static analysis, crawling, and medium-sized target batches. */
export const SECURITY_DOCKER_RESOURCE_STANDARD: SecurityDockerResourceProfile = {
  memoryLimit: '1g',
  cpuLimit: '1',
  pidsLimit: 512,
};

/** Template engines, git clones, vuln DBs, and deep enumeration. */
export const SECURITY_DOCKER_RESOURCE_HEAVY: SecurityDockerResourceProfile = {
  memoryLimit: '2g',
  cpuLimit: '2',
  pidsLimit: 1024,
};

export const SECURITY_DOCKER_RESOURCE_PARAMETER_IDS = [
  'overrideContainerResources',
  'containerMemoryLimit',
  'containerCpuLimit',
] as const;

export type SecurityDockerResourceParameterId =
  (typeof SECURITY_DOCKER_RESOURCE_PARAMETER_IDS)[number];

const DOCKER_MEMORY_PATTERN = /^\d+(\.\d+)?[bkmgt]?$/i;
const DOCKER_CPU_PATTERN = /^\d+(\.\d+)?$/;

const DEFAULT_MAX_MEMORY = '8g';
const DEFAULT_MAX_CPUS = '4';

function readEnvLimit(raw: string | undefined, fallback: string): string {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function getSecurityDockerMaxMemory(): string {
  return readEnvLimit(process.env.SENTRIS_DOCKER_MAX_MEMORY, DEFAULT_MAX_MEMORY);
}

export function getSecurityDockerMaxCpus(): string {
  return readEnvLimit(process.env.SENTRIS_DOCKER_MAX_CPUS, DEFAULT_MAX_CPUS);
}

function parseMemoryToBytes(value: string): number {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)([bkmgt]?)$/);
  if (!match) {
    throw new ValidationError(`Invalid memory limit: ${value}`, {
      fieldErrors: { containerMemoryLimit: ['Use Docker format such as 512m, 2g, or 1.5g'] },
    });
  }

  const amount = Number.parseFloat(match[1]!);
  const unit = match[2] ?? 'b';
  const multipliers: Record<string, number> = {
    b: 1,
    k: 1024,
    m: 1024 ** 2,
    g: 1024 ** 3,
    t: 1024 ** 4,
  };

  const multiplier = multipliers[unit];
  if (!Number.isFinite(amount) || amount <= 0 || !multiplier) {
    throw new ValidationError(`Invalid memory limit: ${value}`, {
      fieldErrors: { containerMemoryLimit: ['Use Docker format such as 512m, 2g, or 1.5g'] },
    });
  }

  return Math.floor(amount * multiplier);
}

function parseCpuLimit(value: string): number {
  const trimmed = value.trim();
  if (!DOCKER_CPU_PATTERN.test(trimmed)) {
    throw new ValidationError(`Invalid CPU limit: ${value}`, {
      fieldErrors: { containerCpuLimit: ['Use a positive number such as 1, 2, or 0.5'] },
    });
  }

  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ValidationError(`Invalid CPU limit: ${value}`, {
      fieldErrors: { containerCpuLimit: ['Use a positive number such as 1, 2, or 0.5'] },
    });
  }

  return parsed;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface SecurityDockerResourceParams {
  overrideContainerResources?: boolean;
  containerMemoryLimit?: string;
  containerCpuLimit?: string;
}

export function securityDockerResourceParameterShape() {
  return {
    overrideContainerResources: param(
      z.boolean().default(false).describe('Enable custom Docker memory/CPU limits for this step'),
      {
        label: 'Override container resources',
        description:
          'Use custom Docker memory and CPU limits for heavy scans. Leave disabled to use component defaults.',
        editor: 'boolean',
      },
    ),
    containerMemoryLimit: param(
      z.string().trim().optional().describe('Docker memory limit (e.g. 4g, 512m)'),
      {
        label: 'Container memory limit',
        description:
          'Docker --memory value for this step only. Host Docker must have enough RAM. OOM kills use exit code 137.',
        editor: 'text',
        placeholder: '4g',
        visibleWhen: { overrideContainerResources: true },
      },
    ),
    containerCpuLimit: param(
      z.string().trim().optional().describe('Docker CPU limit (e.g. 2, 0.5)'),
      {
        label: 'Container CPU limit',
        description: 'Docker --cpus value for this step only.',
        editor: 'text',
        placeholder: '2',
        visibleWhen: { overrideContainerResources: true },
      },
    ),
  } as const;
}

export function resolveSecurityDockerResourceOverrides(
  params: SecurityDockerResourceParams | undefined,
): Pick<DockerRunnerConfig, 'memoryLimit' | 'cpuLimit'> {
  if (!params?.overrideContainerResources) {
    return {};
  }

  const memoryLimit = normalizeOptionalString(params.containerMemoryLimit);
  const cpuLimit = normalizeOptionalString(params.containerCpuLimit);

  if (!memoryLimit && !cpuLimit) {
    throw new ValidationError(
      'Provide a container memory and/or CPU limit when overriding resources',
      {
        fieldErrors: {
          containerMemoryLimit: ['Required when override is enabled unless CPU limit is set'],
          containerCpuLimit: ['Required when override is enabled unless memory limit is set'],
        },
      },
    );
  }

  const resolved: Pick<DockerRunnerConfig, 'memoryLimit' | 'cpuLimit'> = {};

  if (memoryLimit) {
    if (!DOCKER_MEMORY_PATTERN.test(memoryLimit)) {
      throw new ValidationError(`Invalid memory limit: ${memoryLimit}`, {
        fieldErrors: {
          containerMemoryLimit: ['Use Docker format such as 512m, 2g, or 1.5g'],
        },
      });
    }

    const bytes = parseMemoryToBytes(memoryLimit);
    const maxBytes = parseMemoryToBytes(getSecurityDockerMaxMemory());
    if (bytes > maxBytes) {
      throw new ValidationError(
        `Memory limit exceeds platform maximum (${getSecurityDockerMaxMemory()})`,
        {
          fieldErrors: {
            containerMemoryLimit: [`Maximum allowed memory is ${getSecurityDockerMaxMemory()}`],
          },
        },
      );
    }

    resolved.memoryLimit = memoryLimit;
  }

  if (cpuLimit) {
    const cpus = parseCpuLimit(cpuLimit);
    const maxCpus = parseCpuLimit(getSecurityDockerMaxCpus());
    if (cpus > maxCpus) {
      throw new ValidationError(
        `CPU limit exceeds platform maximum (${getSecurityDockerMaxCpus()})`,
        {
          fieldErrors: {
            containerCpuLimit: [`Maximum allowed CPUs is ${getSecurityDockerMaxCpus()}`],
          },
        },
      );
    }

    resolved.cpuLimit = cpuLimit;
  }

  return resolved;
}

export const SECURITY_DOCKER_COMPONENT_RESOURCE_PROFILES: Record<
  SecurityComponentId,
  SecurityDockerResourceProfile | null
> = {
  'sentris.subfinder.run': SECURITY_DOCKER_RESOURCE_LIGHT,
  'sentris.amass.enum': SECURITY_DOCKER_RESOURCE_HEAVY,
  'sentris.naabu.scan': SECURITY_DOCKER_RESOURCE_LIGHT,
  'sentris.dnsx.run': SECURITY_DOCKER_RESOURCE_LIGHT,
  'sentris.httpx.scan': SECURITY_DOCKER_RESOURCE_STANDARD,
  'sentris.nuclei.scan': SECURITY_DOCKER_RESOURCE_HEAVY,
  'sentris.supabase.scanner': SECURITY_DOCKER_RESOURCE_STANDARD,
  'sentris.notify.dispatch': SECURITY_DOCKER_RESOURCE_LIGHT,
  'security.prowler.scan': SECURITY_DOCKER_RESOURCE_HEAVY,
  'sentris.shuffledns.massdns': SECURITY_DOCKER_RESOURCE_LIGHT,
  'sentris.trufflehog.scan': SECURITY_DOCKER_RESOURCE_HEAVY,
  'sentris.security.terminal-demo': SECURITY_DOCKER_RESOURCE_LIGHT,
  'security.virustotal.lookup': null,
  'security.abuseipdb.check': null,
  'mcp.group.aws': null,
  'sentris.testssl.run': SECURITY_DOCKER_RESOURCE_LIGHT,
  'sentris.checkov.run': SECURITY_DOCKER_RESOURCE_STANDARD,
  'sentris.theharvester.run': SECURITY_DOCKER_RESOURCE_LIGHT,
  'sentris.wafw00f.run': SECURITY_DOCKER_RESOURCE_LIGHT,
  'sentris.katana.run': SECURITY_DOCKER_RESOURCE_STANDARD,
  'sentris.ffuf.run': SECURITY_DOCKER_RESOURCE_STANDARD,
  'sentris.trivy.run': SECURITY_DOCKER_RESOURCE_HEAVY,
  'sentris.semgrep.run': SECURITY_DOCKER_RESOURCE_STANDARD,
  'sentris.repository.files.extract': null,
  'sentris.repository.manifest.extract': null,
  'sentris.npm.registry.intel': null,
  'sentris.osv.query': null,
  'sentris.nvd.cve.query': null,
  'sentris.yara.run': SECURITY_DOCKER_RESOURCE_LIGHT,
};

export const SECURITY_DOCKER_COMPONENT_IDS = Object.entries(
  SECURITY_DOCKER_COMPONENT_RESOURCE_PROFILES,
)
  .filter(
    (entry): entry is [SecurityComponentId, SecurityDockerResourceProfile] => entry[1] !== null,
  )
  .map(([componentId]) => componentId);

export function getSecurityDockerResourceProfile(
  componentId: SecurityComponentId,
): SecurityDockerResourceProfile {
  const profile = SECURITY_DOCKER_COMPONENT_RESOURCE_PROFILES[componentId];
  if (!profile) {
    throw new Error(`Component ${componentId} is not a Docker security component`);
  }
  return profile;
}

export function mergeSecurityDockerRunner(
  baseRunner: DockerRunnerConfig,
  overrides: Partial<DockerRunnerConfig>,
  resourceParams?: SecurityDockerResourceParams,
): DockerRunnerConfig {
  const resourceOverrides = resolveSecurityDockerResourceOverrides(resourceParams);

  return {
    ...baseRunner,
    ...overrides,
    ...resourceOverrides,
    env: { ...(baseRunner.env ?? {}), ...(overrides.env ?? {}) },
  };
}
