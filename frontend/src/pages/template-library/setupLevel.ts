import type { Template } from '@/types/templates';

/**
 * Component `type` values (React Flow node.type === componentId) that run with
 * ONLY outbound internet — no Docker image pull, no local tooling, no target
 * infrastructure. This is an ALLOWLIST: any component NOT listed here is treated
 * as requiring setup. When a new inline/API-only component is added, add its id
 * here deliberately.
 *
 * Source of truth for a component's runtime is the worker component manifest
 * (worker/src/components/**). Keep this set in sync with the inline/API-only
 * security + core components.
 */
export const NET_ONLY_COMPONENT_TYPES: ReadonlySet<string> = new Set<string>([
  // core inline components
  'core.workflow.entrypoint',
  'core.logic.script',
  'core.http.request',
  'core.artifact.writer',
  // API-only intel components (no Docker)
  'sentris.nvd.cve.query',
  'sentris.osv.query',
  'sentris.npm.registry.intel',
]);

export type SetupLevel = 'no-setup' | 'needs-secrets' | 'needs-tooling';

type Classifiable = Pick<Template, 'graph' | 'requiredSecrets'>;

function nodeTypes(graph: Template['graph']): (string | undefined)[] {
  if (!graph || typeof graph !== 'object') return [];
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((n) => (n && typeof n === 'object' ? (n as { type?: unknown }).type : undefined))
    .map((t) => (typeof t === 'string' ? t : undefined));
}

/**
 * Classify how much setup a template needs before it can run locally.
 * - needs-secrets: has one or more required secrets.
 * - no-setup: zero secrets AND every graph node is a net-only component.
 * - needs-tooling: anything else (Docker scanner, unknown component, empty graph).
 */
export function getTemplateSetupLevel(template: Classifiable): SetupLevel {
  if (template.requiredSecrets && template.requiredSecrets.length > 0) {
    return 'needs-secrets';
  }
  const types = nodeTypes(template.graph);
  if (types.length === 0) return 'needs-tooling';
  const allNetOnly = types.every((t) => t !== undefined && NET_ONLY_COMPONENT_TYPES.has(t));
  return allNetOnly ? 'no-setup' : 'needs-tooling';
}

export function isNoSetupTemplate(template: Classifiable): boolean {
  return getTemplateSetupLevel(template) === 'no-setup';
}
