import type { CachedComponentMetadata, ComponentParameterType } from '@sentris/component-sdk';
import { SECURITY_DOCKER_RESOURCE_PARAMETER_IDS } from './security-docker-resources';

/** Canonical security palette components (34). Includes mcp.group.aws from security folder. */
export const SECURITY_COMPONENT_IDS = [
  'sentris.subfinder.run',
  'sentris.amass.enum',
  'sentris.naabu.scan',
  'sentris.dnsx.run',
  'sentris.httpx.scan',
  'sentris.nuclei.scan',
  'sentris.supabase.scanner',
  'sentris.notify.dispatch',
  'security.prowler.scan',
  'sentris.shuffledns.massdns',
  'sentris.trufflehog.scan',
  'sentris.security.terminal-demo',
  'security.virustotal.lookup',
  'security.abuseipdb.check',
  'mcp.group.aws',
  'sentris.testssl.run',
  'sentris.checkov.run',
  'sentris.theharvester.run',
  'sentris.wafw00f.run',
  'sentris.katana.run',
  'sentris.ffuf.run',
  'sentris.trivy.run',
  'sentris.semgrep.run',
  'sentris.opengrep.run',
  'sentris.codeql.run',
  'sentris.jazzer-js.run',
  'sentris.repository.files.extract',
  'sentris.github.repository.clone',
  'sentris.repository.manifest.extract',
  'sentris.osv.query',
  'sentris.npm.registry.intel',
  'sentris.npm.package.source',
  'sentris.nvd.cve.query',
  'sentris.yara.run',
] as const;

export type SecurityComponentId = (typeof SECURITY_COMPONENT_IDS)[number];

export const PARAMETER_FIELD_RENDERABLE_TYPES: ComponentParameterType[] = [
  'text',
  'textarea',
  'number',
  'boolean',
  'select',
  'multi-select',
  'json',
  'secret',
  'artifact',
  'variable-list',
  'form-fields',
  'selection-options',
  'analytics-inputs',
];

export interface SecurityComponentFieldSummary {
  id: string;
  label: string;
  type?: string;
  required?: boolean;
  default?: unknown;
}

export interface SecurityComponentManifestEntry {
  id: SecurityComponentId;
  label: string;
  runnerKind: 'inline' | 'docker' | 'remote';
  runnerImage?: string | null;
  inputs: SecurityComponentFieldSummary[];
  outputs: SecurityComponentFieldSummary[];
  parameters: SecurityComponentFieldSummary[];
}

export interface SecurityComponentInvariantFailure {
  componentId: string;
  message: string;
}

export function summarizeField(field: {
  id: string;
  label?: string;
  type?: string;
  required?: boolean;
  default?: unknown;
}): SecurityComponentFieldSummary {
  return {
    id: field.id,
    label: field.label ?? field.id,
    type: field.type,
    required: field.required,
    default: field.default,
  };
}

export function buildSecurityComponentManifest(
  entries: CachedComponentMetadata[],
): SecurityComponentManifestEntry[] {
  const byId = new Map(entries.map((entry) => [entry.definition.id, entry]));

  return SECURITY_COMPONENT_IDS.map((id) => {
    const entry = byId.get(id);
    if (!entry) {
      throw new Error(`Security component not registered: ${id}`);
    }

    const runner = entry.definition.runner;
    const runnerKind = runner?.kind ?? 'inline';

    return {
      id,
      label: entry.definition.label,
      runnerKind,
      runnerImage: runnerKind === 'docker' ? ((runner as { image?: string }).image ?? null) : null,
      inputs: entry.inputs.map(summarizeField),
      outputs: entry.outputs.map(summarizeField),
      parameters: entry.parameters.map(summarizeField),
    };
  });
}

export function getSecurityComponentInvariantFailures(
  entries: CachedComponentMetadata[],
): SecurityComponentInvariantFailure[] {
  const failures: SecurityComponentInvariantFailure[] = [];
  const byId = new Map(entries.map((entry) => [entry.definition.id, entry]));

  for (const id of SECURITY_COMPONENT_IDS) {
    const entry = byId.get(id);
    if (!entry) {
      failures.push({ componentId: id, message: 'Component is not registered' });
      continue;
    }

    const { definition, inputs, outputs, parameters } = entry;

    if (!definition.label?.trim()) {
      failures.push({ componentId: id, message: 'Missing component label' });
    }

    if (inputs.length === 0 && parameters.length === 0) {
      failures.push({ componentId: id, message: 'Component has no inputs or parameters' });
    }

    if (outputs.length === 0) {
      failures.push({ componentId: id, message: 'Component has no outputs' });
    }

    for (const port of inputs) {
      if (!port.label?.trim()) {
        failures.push({ componentId: id, message: `Input "${port.id}" missing label` });
      }
    }

    for (const port of outputs) {
      if (!port.label?.trim()) {
        failures.push({ componentId: id, message: `Output "${port.id}" missing label` });
      }
    }

    for (const parameter of parameters) {
      if (!parameter.label?.trim()) {
        failures.push({ componentId: id, message: `Parameter "${parameter.id}" missing label` });
      }
      if (
        parameter.type &&
        !PARAMETER_FIELD_RENDERABLE_TYPES.includes(parameter.type as ComponentParameterType)
      ) {
        failures.push({
          componentId: id,
          message: `Parameter "${parameter.id}" has unsupported UI type "${parameter.type}"`,
        });
      }
    }

    const runnerKind = definition.runner?.kind ?? 'inline';
    if (runnerKind === 'docker') {
      const image = (definition.runner as { image?: string }).image;
      if (!image?.trim()) {
        failures.push({ componentId: id, message: 'Docker runner missing image' });
      }

      for (const parameterId of SECURITY_DOCKER_RESOURCE_PARAMETER_IDS) {
        if (!parameters.some((parameter) => parameter.id === parameterId)) {
          failures.push({
            componentId: id,
            message: `Docker component missing resource override parameter "${parameterId}"`,
          });
        }
      }
    }

    const hasCustomFlagsInput = inputs.some((port) => port.id === 'customFlags');
    const hasCustomFlagsParam = parameters.some((parameter) => parameter.id === 'customFlags');
    if (hasCustomFlagsInput || hasCustomFlagsParam) {
      const customFlagsField = hasCustomFlagsInput
        ? inputs.find((port) => port.id === 'customFlags')
        : parameters.find((parameter) => parameter.id === 'customFlags');
      const description = customFlagsField?.description?.toLowerCase() ?? '';
      if (!description.includes('cli') && !description.includes('flag')) {
        failures.push({
          componentId: id,
          message: 'customFlags should document CLI override behavior',
        });
      }
    }
  }

  return failures;
}
