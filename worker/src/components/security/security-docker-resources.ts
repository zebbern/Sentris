import type { DockerRunnerConfig } from '@sentris/component-sdk';
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
  'sentris.osv.query': null,
  'sentris.nvd.cve.query': null,
  'sentris.yara.run': SECURITY_DOCKER_RESOURCE_LIGHT,
};

export const SECURITY_DOCKER_COMPONENT_IDS = Object.entries(
  SECURITY_DOCKER_COMPONENT_RESOURCE_PROFILES,
)
  .filter((entry): entry is [SecurityComponentId, SecurityDockerResourceProfile] => entry[1] !== null)
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
): DockerRunnerConfig {
  return {
    ...baseRunner,
    ...overrides,
    env: { ...(baseRunner.env ?? {}), ...(overrides.env ?? {}) },
  };
}
