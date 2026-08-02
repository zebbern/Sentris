import type { WorkflowGraph } from '@sentris/shared';

export const OPERATOR_CREDENTIAL_PLACEHOLDER = '__SENTRIS_PRESERVE_CREDENTIAL__';

type DraftMode = 'create' | 'update';
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (normalized.endsWith('id') || normalized.endsWith('ref')) return false;
  return [
    'apikey',
    'accesstoken',
    'refreshtoken',
    'oauthtoken',
    'password',
    'passphrase',
    'secret',
    'clientsecret',
    'privatekey',
    'authorization',
  ].some((candidate) => normalized === candidate || normalized.endsWith(candidate));
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
  );
}

function materializeValue(
  proposed: unknown,
  base: unknown,
  mode: DraftMode,
  path: string[],
  key = '',
): unknown {
  if (proposed === OPERATOR_CREDENTIAL_PLACEHOLDER) {
    if (mode === 'create') return '';
    if (base === undefined || base === OPERATOR_CREDENTIAL_PLACEHOLDER) {
      throw new Error(`Credential placeholder at ${path.join('.')} has no saved base value.`);
    }
    return cloneJsonValue(base);
  }

  if (
    mode === 'create' &&
    key &&
    isSensitiveKey(key) &&
    proposed !== undefined &&
    proposed !== null &&
    proposed !== ''
  ) {
    throw new Error(
      `Operator create drafts cannot contain inline credentials at ${path.join('.')}. Configure the credential in the Builder.`,
    );
  }

  if (Array.isArray(proposed)) {
    const baseArray = Array.isArray(base) ? base : [];
    return proposed.map((child, index) =>
      materializeValue(child, baseArray[index], mode, [...path, String(index)]),
    );
  }

  if (!isRecord(proposed)) return proposed;

  const baseRecord = isRecord(base) ? base : {};
  const materialized: JsonRecord = {};
  for (const [childKey, child] of Object.entries(proposed)) {
    materialized[childKey] = materializeValue(
      child,
      baseRecord[childKey],
      mode,
      [...path, childKey],
      childKey,
    );
  }

  return materialized;
}

/**
 * Converts a redacted durable Operator proposal into an editable Builder graph.
 * Update credentials come only from the freshly fetched persisted graph, never
 * from the durable draft. Create drafts keep credential fields empty.
 */
export function materializeOperatorDraftGraph(
  proposed: WorkflowGraph,
  base: WorkflowGraph | null,
  mode: DraftMode,
): WorkflowGraph {
  const baseNodes = new Map((base?.nodes ?? []).map((node) => [node.id, node]));
  return {
    ...proposed,
    nodes: proposed.nodes.map((node) => {
      const baseNode = baseNodes.get(node.id);
      const matchingBaseNode = baseNode?.type === node.type ? baseNode : undefined;
      return materializeValue(node, matchingBaseNode, mode, [
        'nodes',
        node.id,
      ]) as WorkflowGraph['nodes'][number];
    }),
    edges: proposed.edges.map((edge) => ({ ...edge })),
    viewport: { ...proposed.viewport },
  };
}
