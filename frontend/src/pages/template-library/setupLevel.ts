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
type Rankable = Pick<
  Template,
  'graph' | 'requiredSecrets' | 'isOfficial' | 'isVerified' | 'popularity' | 'validation'
>;

function graphNodes(graph: Template['graph']): Record<string, unknown>[] {
  if (!graph || typeof graph !== 'object') return [];
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.filter(
    (node): node is Record<string, unknown> => Boolean(node) && typeof node === 'object',
  );
}

function nodeTypes(graph: Template['graph']): (string | undefined)[] {
  return graphNodes(graph)
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

export function isLiveVerifiedTemplate(template: Pick<Template, 'validation'>): boolean {
  return template.validation?.status === 'live-verified' && template.validation.isCurrent === true;
}

export function getTemplateRuntimeInputCount(template: Pick<Template, 'graph'>): number {
  for (const node of graphNodes(template.graph)) {
    if (node.type !== 'core.workflow.entrypoint') continue;
    const data = node.data;
    if (!data || typeof data !== 'object') continue;
    const config = (data as { config?: unknown }).config;
    if (!config || typeof config !== 'object') continue;
    const params = (config as { params?: unknown }).params;
    if (!params || typeof params !== 'object') continue;
    const runtimeInputs = (params as { runtimeInputs?: unknown }).runtimeInputs;
    if (Array.isArray(runtimeInputs)) return runtimeInputs.length;
  }
  return 0;
}

export function templateProducesArtifact(template: Pick<Template, 'graph'>): boolean {
  return nodeTypes(template.graph).includes('core.artifact.writer');
}

export function isRecommendedTemplate(template: Rankable): boolean {
  const hasNoLiveEvidence = !template.validation || template.validation.status === 'unknown';
  const hasTrustedValidation = template.validation
    ? isLiveVerifiedTemplate(template)
    : template.isVerified;
  const hasReviewedFallback = hasNoLiveEvidence && template.isVerified;

  return (
    getTemplateSetupLevel(template) === 'no-setup' &&
    template.isOfficial &&
    (hasTrustedValidation || hasReviewedFallback)
  );
}

/**
 * Put low-friction, proven templates first for users who have not chosen a
 * filter or their own manual card order.
 */
export function compareTemplatesForActivation(a: Rankable, b: Rankable): number {
  const score = (template: Rankable) => {
    let result = 0;
    if (isRecommendedTemplate(template)) result += 1_000;
    if (getTemplateSetupLevel(template) === 'no-setup') result += 400;
    if (isLiveVerifiedTemplate(template)) result += 200;
    if (template.isOfficial) result += 100;
    if (templateProducesArtifact(template)) result += 50;
    result += Math.max(0, 40 - getTemplateRuntimeInputCount(template) * 5);
    result += Math.min(template.popularity, 49);
    return result;
  };

  return score(b) - score(a);
}
