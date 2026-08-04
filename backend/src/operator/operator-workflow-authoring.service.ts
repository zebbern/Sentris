import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  OperatorProposeWorkflowEditsInputSchema,
  OperatorProposeWorkflowDraftInputSchema,
  OperatorReviseWorkflowDraftInputSchema,
  OperatorWorkflowDraftResultSchema,
  OperatorWorkflowGraphSchema,
  TERMINAL_STATUSES,
  type OperatorCommandInputMap,
  type OperatorWorkflowEditOperation,
  type OperatorWorkflowApplyResult,
  type OperatorWorkflowDraftDetail,
  type OperatorWorkflowDraftResult,
  type WorkflowGraph,
} from '@sentris/shared';
import {
  componentRegistry,
  extractPorts,
  getToolSchema,
  isAgentCallable,
} from '@sentris/component-sdk';

import '@sentris/worker/components';

import type { AuthContext } from '../auth/types';
import type { OperatorActionRecord } from '../database/schema';
import { compileWorkflowGraph } from '../dsl/compiler';
import { categorizeComponent } from '../components/utils/categorization';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowVersionRepository } from '../workflows/repository/workflow-version.repository';
import { OperatorRepository } from './operator.repository';

export const OPERATOR_PRESERVE_CREDENTIAL = '__SENTRIS_PRESERVE_CREDENTIAL__';

type JsonRecord = Record<string, unknown>;

type StoredWorkflowProposal =
  | {
      kind: 'graph';
      action: OperatorActionRecord;
      arguments: OperatorCommandInputMap['propose_workflow_draft'];
      result: OperatorWorkflowDraftResult;
    }
  | {
      kind: 'edits';
      action: OperatorActionRecord;
      arguments: OperatorCommandInputMap['propose_workflow_edits'];
      result: OperatorWorkflowDraftResult;
    }
  | {
      kind: 'revision';
      action: OperatorActionRecord;
      arguments: OperatorCommandInputMap['revise_workflow_draft'];
      result: OperatorWorkflowDraftResult;
    };

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (normalized.endsWith('id') || normalized.endsWith('ref')) return false;
  return [
    'apikey',
    'bearertoken',
    'accesstoken',
    'refreshtoken',
    'oauthtoken',
    'authheadervalue',
    'password',
    'passphrase',
    'secret',
    'clientsecret',
    'privatekey',
    'authorization',
  ].some((candidate) => normalized === candidate || normalized.endsWith(candidate));
}

function declaredComponentFields(node: WorkflowGraph['nodes'][number]): {
  fieldIds: Set<string>;
  secretIds: Set<string>;
} {
  const entry = componentRegistry.getMetadata(node.type);
  if (!entry) return { fieldIds: new Set(), secretIds: new Set() };
  let inputs = entry.inputs ?? extractPorts(entry.definition.inputs);
  if (entry.definition.resolvePorts) {
    try {
      const resolved = entry.definition.resolvePorts(node.data.config.params);
      if (resolved.inputs) inputs = extractPorts(resolved.inputs);
    } catch {
      // Static metadata is still useful when a draft has incomplete dynamic parameters.
    }
  }
  const fields = [...inputs, ...(entry.parameters ?? [])] as {
    id?: string;
    editor?: string;
  }[];
  const declared = fields.filter(
    (field): field is { id: string; editor?: string } => typeof field.id === 'string',
  );
  return {
    fieldIds: new Set(declared.map((field) => field.id)),
    secretIds: new Set(
      declared.filter((field) => field.editor === 'secret').map((field) => field.id),
    ),
  };
}

const OMIT_CREDENTIAL_VALUE = Symbol('omit-operator-credential-value');

function isBlankCredentialValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
  );
}

function projectUndeclaredCredentialValue(
  value: unknown,
  key = '',
): unknown | typeof OMIT_CREDENTIAL_VALUE {
  if (value === OPERATOR_PRESERVE_CREDENTIAL || isSensitiveKey(key)) {
    return OMIT_CREDENTIAL_VALUE;
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const projected = projectUndeclaredCredentialValue(entry);
      return projected === OMIT_CREDENTIAL_VALUE ? [] : [projected];
    });
  }
  if (!isRecord(value)) return value;

  const projected: JsonRecord = {};
  for (const [childKey, child] of Object.entries(value)) {
    const projectedChild = projectUndeclaredCredentialValue(child, childKey);
    if (projectedChild !== OMIT_CREDENTIAL_VALUE) projected[childKey] = projectedChild;
  }
  return projected;
}

function projectGenericCredentialValue(
  value: unknown,
  key = '',
): unknown | typeof OMIT_CREDENTIAL_VALUE {
  if (value === OPERATOR_PRESERVE_CREDENTIAL) {
    return isSensitiveKey(key) ? OPERATOR_PRESERVE_CREDENTIAL : OMIT_CREDENTIAL_VALUE;
  }
  if (isSensitiveKey(key)) {
    return isBlankCredentialValue(value) ? OMIT_CREDENTIAL_VALUE : OPERATOR_PRESERVE_CREDENTIAL;
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const projected = projectGenericCredentialValue(entry);
      return projected === OMIT_CREDENTIAL_VALUE ? [] : [projected];
    });
  }
  if (!isRecord(value)) return value;

  const projected: JsonRecord = {};
  for (const [childKey, child] of Object.entries(value)) {
    const projectedChild = projectGenericCredentialValue(child, childKey);
    if (projectedChild !== OMIT_CREDENTIAL_VALUE) projected[childKey] = projectedChild;
  }
  return projected;
}

function projectCredentialValues(
  graph: WorkflowGraph,
  base: WorkflowGraph | undefined,
): WorkflowGraph {
  const projected = OperatorWorkflowGraphSchema.parse(graph);
  const baseById = new Map((base?.nodes ?? []).map((node) => [node.id, node]));
  for (const node of projected.nodes) {
    const currentFields = declaredComponentFields(node);
    const baseCandidate = baseById.get(node.id);
    const baseSecretIds = baseCandidate
      ? declaredComponentFields(baseCandidate).secretIds
      : new Set<string>();
    for (const location of ['params', 'inputOverrides'] as const) {
      const values: JsonRecord = {};
      for (const [id, value] of Object.entries(node.data.config[location])) {
        if (currentFields.secretIds.has(id)) {
          if (!isBlankCredentialValue(value)) {
            values[id] = OPERATOR_PRESERVE_CREDENTIAL;
          }
          continue;
        }
        if (baseSecretIds.has(id)) continue;
        const projectedValue = currentFields.fieldIds.has(id)
          ? projectGenericCredentialValue(value, id)
          : projectUndeclaredCredentialValue(value, id);
        if (projectedValue !== OMIT_CREDENTIAL_VALUE) values[id] = projectedValue;
      }
      node.data.config[location] = values;
    }
  }
  return projected;
}

function restoreUndeclaredCredentialValue(
  value: unknown,
  path: string[],
  key = '',
): unknown | typeof OMIT_CREDENTIAL_VALUE {
  if (value === OPERATOR_PRESERVE_CREDENTIAL) return OMIT_CREDENTIAL_VALUE;
  if (isSensitiveKey(key)) {
    if (isBlankCredentialValue(value)) return OMIT_CREDENTIAL_VALUE;
    throw new ConflictException(
      `Operator drafts cannot set inline credential field ${path.join('.')}; configure it in the Builder`,
    );
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      const restored = restoreUndeclaredCredentialValue(entry, [...path, String(index)]);
      return restored === OMIT_CREDENTIAL_VALUE ? [] : [restored];
    });
  }
  if (!isRecord(value)) return value;

  const restored: JsonRecord = {};
  for (const [childKey, child] of Object.entries(value)) {
    const restoredChild = restoreUndeclaredCredentialValue(child, [...path, childKey], childKey);
    if (restoredChild !== OMIT_CREDENTIAL_VALUE) restored[childKey] = restoredChild;
  }
  return restored;
}

function restoreGenericCredentialValue(
  proposed: unknown,
  base: unknown,
  path: string[],
  key = '',
): unknown | typeof OMIT_CREDENTIAL_VALUE {
  if (proposed === OPERATOR_PRESERVE_CREDENTIAL) {
    if (
      isSensitiveKey(key) &&
      !isBlankCredentialValue(base) &&
      base !== OPERATOR_PRESERVE_CREDENTIAL
    ) {
      return cloneJsonValue(base);
    }
    return OMIT_CREDENTIAL_VALUE;
  }
  if (isSensitiveKey(key)) {
    if (isBlankCredentialValue(proposed)) return OMIT_CREDENTIAL_VALUE;
    throw new ConflictException(
      `Operator drafts cannot set inline credential field ${path.join('.')}; configure it in the Builder`,
    );
  }
  if (Array.isArray(proposed)) {
    const baseArray = Array.isArray(base) ? base : [];
    return proposed.flatMap((entry, index) => {
      const restored = restoreGenericCredentialValue(entry, baseArray[index], [
        ...path,
        String(index),
      ]);
      return restored === OMIT_CREDENTIAL_VALUE ? [] : [restored];
    });
  }
  if (!isRecord(proposed)) return proposed;

  const baseRecord = isRecord(base) ? base : {};
  const restored: JsonRecord = {};
  for (const [childKey, child] of Object.entries(proposed)) {
    const restoredChild = restoreGenericCredentialValue(
      child,
      baseRecord[childKey],
      [...path, childKey],
      childKey,
    );
    if (restoredChild !== OMIT_CREDENTIAL_VALUE) restored[childKey] = restoredChild;
  }
  return restored;
}

function restoreStaleDeclaredCredentialValue(
  proposed: unknown,
  path: string[],
): typeof OMIT_CREDENTIAL_VALUE {
  if (proposed === OPERATOR_PRESERVE_CREDENTIAL || isBlankCredentialValue(proposed)) {
    return OMIT_CREDENTIAL_VALUE;
  }
  throw new ConflictException(
    `Operator drafts cannot set credential input ${path.join('.')} because it is no longer declared secret`,
  );
}

function restoreDeclaredCredentialValue(
  proposed: unknown,
  base: unknown,
  path: string[],
): unknown | typeof OMIT_CREDENTIAL_VALUE {
  if (proposed === OPERATOR_PRESERVE_CREDENTIAL || isBlankCredentialValue(proposed)) {
    if (!isBlankCredentialValue(base) && base !== OPERATOR_PRESERVE_CREDENTIAL) {
      return cloneJsonValue(base);
    }
    return OMIT_CREDENTIAL_VALUE;
  }
  throw new ConflictException(
    `Operator drafts cannot set credential input ${path.join('.')}; configure it in the Builder`,
  );
}

function restoreCredentialValues(
  proposed: WorkflowGraph,
  base: WorkflowGraph | undefined,
): WorkflowGraph {
  const restored = OperatorWorkflowGraphSchema.parse(proposed);
  const baseById = new Map((base?.nodes ?? []).map((node) => [node.id, node]));

  for (const node of restored.nodes) {
    const baseCandidate = baseById.get(node.id);
    const baseNode = baseCandidate?.type === node.type ? baseCandidate : undefined;
    const currentFields = declaredComponentFields(node);
    const baseSecretIds = baseCandidate
      ? declaredComponentFields(baseCandidate).secretIds
      : new Set<string>();

    for (const location of ['params', 'inputOverrides'] as const) {
      const proposedValues = node.data.config[location];
      const baseValues = baseNode?.data.config[location] ?? {};
      const values: JsonRecord = {};

      for (const [id, value] of Object.entries(proposedValues)) {
        const path = ['nodes', node.id, 'data', 'config', location, id];
        let restoredValue: unknown | typeof OMIT_CREDENTIAL_VALUE;
        if (currentFields.secretIds.has(id)) {
          restoredValue = restoreDeclaredCredentialValue(value, baseValues[id], path);
        } else if (baseSecretIds.has(id)) {
          restoredValue = restoreStaleDeclaredCredentialValue(value, path);
        } else if (currentFields.fieldIds.has(id)) {
          restoredValue = restoreGenericCredentialValue(value, baseValues[id], path, id);
        } else {
          restoredValue = restoreUndeclaredCredentialValue(value, path, id);
        }
        if (restoredValue !== OMIT_CREDENTIAL_VALUE) values[id] = restoredValue;
      }

      for (const id of currentFields.secretIds) {
        if (id in proposedValues) continue;
        const baseValue = baseValues[id];
        if (!isBlankCredentialValue(baseValue) && baseValue !== OPERATOR_PRESERVE_CREDENTIAL) {
          values[id] = cloneJsonValue(baseValue);
        }
      }
      node.data.config[location] = values;
    }
  }

  return restored;
}

function comparableGraph(graph: WorkflowGraph): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        dynamicInputs: undefined,
        dynamicOutputs: undefined,
      },
    })),
  };
}

function diffById<T extends { id: string }>(base: T[], proposed: T[]) {
  const baseById = new Map(base.map((entry) => [entry.id, entry]));
  const proposedById = new Map(proposed.map((entry) => [entry.id, entry]));
  return {
    added: proposed.filter((entry) => !baseById.has(entry.id)).map((entry) => entry.id),
    removed: base.filter((entry) => !proposedById.has(entry.id)).map((entry) => entry.id),
    changed: proposed
      .filter((entry) => {
        const previous = baseById.get(entry.id);
        return previous !== undefined && !isDeepStrictEqual(previous, entry);
      })
      .map((entry) => entry.id),
  };
}

function buildGraphDiff(base: WorkflowGraph | null, proposed: WorkflowGraph) {
  const previous = comparableGraph(
    base ?? {
      name: '',
      description: undefined,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  );
  const next = comparableGraph(proposed);
  const nodes = diffById(previous.nodes, next.nodes);
  const edges = diffById(previous.edges, next.edges);
  return {
    metadataChanged: [
      ...(previous.name !== next.name ? (['name'] as const) : []),
      ...(previous.description !== next.description ? (['description'] as const) : []),
    ],
    successCriteriaChanged: !isDeepStrictEqual(
      previous.successCriteria ?? [],
      next.successCriteria ?? [],
    ),
    addedNodeIds: nodes.added,
    removedNodeIds: nodes.removed,
    changedNodeIds: nodes.changed,
    addedEdgeIds: edges.added,
    removedEdgeIds: edges.removed,
    changedEdgeIds: edges.changed,
  };
}

function graphDiffHasChanges(diff: ReturnType<typeof buildGraphDiff>): boolean {
  return (
    diff.metadataChanged.length > 0 ||
    diff.successCriteriaChanged ||
    diff.addedNodeIds.length > 0 ||
    diff.removedNodeIds.length > 0 ||
    diff.changedNodeIds.length > 0 ||
    diff.addedEdgeIds.length > 0 ||
    diff.removedEdgeIds.length > 0 ||
    diff.changedEdgeIds.length > 0
  );
}

function mergeJsonValue(base: unknown, patch: unknown): unknown {
  if (!isRecord(base) || !isRecord(patch)) return cloneJsonValue(patch);
  const keys = new Set([...Object.keys(base), ...Object.keys(patch)]);
  return Object.fromEntries(
    [...keys].map((key) => [
      key,
      Object.hasOwn(patch, key) ? mergeJsonValue(base[key], patch[key]) : cloneJsonValue(base[key]),
    ]),
  );
}

function requireWorkflowEditField<T>(
  value: T | undefined,
  operation: OperatorWorkflowEditOperation['operation'],
  field: string,
): T {
  if (value === undefined) throw new Error(`${operation} requires ${field}`);
  return value;
}

function applyWorkflowEdit(
  graph: WorkflowGraph,
  edit: OperatorWorkflowEditOperation,
): WorkflowGraph {
  const candidate = OperatorWorkflowGraphSchema.parse(graph);
  switch (edit.operation) {
    case 'set_workflow_metadata':
      if (edit.name !== undefined) candidate.name = edit.name;
      if (edit.description !== undefined) {
        candidate.description = edit.description ?? undefined;
      }
      return candidate;
    case 'set_success_criteria':
      candidate.successCriteria = requireWorkflowEditField(
        edit.successCriteria,
        edit.operation,
        'successCriteria',
      );
      return candidate;
    case 'patch_node': {
      const nodeId = requireWorkflowEditField(edit.nodeId, edit.operation, 'nodeId');
      const node = candidate.nodes.find((entry) => entry.id === nodeId);
      if (!node) throw new Error(`node ${nodeId} does not exist`);
      if (edit.label !== undefined) node.data.label = edit.label;
      if (edit.position !== undefined) node.position = edit.position;
      if (edit.setParameters) {
        for (const [id, value] of Object.entries(edit.setParameters)) {
          node.data.config.params[id] = mergeJsonValue(node.data.config.params[id], value);
        }
      }
      const removedParameterIds = new Set(edit.removeParameterIds ?? []);
      if (removedParameterIds.size > 0) {
        node.data.config.params = Object.fromEntries(
          Object.entries(node.data.config.params).filter(([id]) => !removedParameterIds.has(id)),
        );
      }
      if (edit.setInputOverrides) {
        for (const [id, value] of Object.entries(edit.setInputOverrides)) {
          node.data.config.inputOverrides[id] = mergeJsonValue(
            node.data.config.inputOverrides[id],
            value,
          );
        }
      }
      const removedInputOverrideIds = new Set(edit.removeInputOverrideIds ?? []);
      if (removedInputOverrideIds.size > 0) {
        node.data.config.inputOverrides = Object.fromEntries(
          Object.entries(node.data.config.inputOverrides).filter(
            ([id]) => !removedInputOverrideIds.has(id),
          ),
        );
      }
      return candidate;
    }
    case 'add_node': {
      const addedNode = requireWorkflowEditField(edit.node, edit.operation, 'node');
      if (candidate.nodes.some((node) => node.id === addedNode.id)) {
        throw new Error(`node ${addedNode.id} already exists`);
      }
      candidate.nodes.push(cloneJsonValue(addedNode) as WorkflowGraph['nodes'][number]);
      return candidate;
    }
    case 'replace_node': {
      const nodeId = requireWorkflowEditField(edit.nodeId, edit.operation, 'nodeId');
      const replacementNode = requireWorkflowEditField(edit.node, edit.operation, 'node');
      const index = candidate.nodes.findIndex((node) => node.id === nodeId);
      if (index === -1) throw new Error(`node ${nodeId} does not exist`);
      candidate.nodes[index] = cloneJsonValue(replacementNode) as WorkflowGraph['nodes'][number];
      return candidate;
    }
    case 'remove_node': {
      const nodeId = requireWorkflowEditField(edit.nodeId, edit.operation, 'nodeId');
      const index = candidate.nodes.findIndex((node) => node.id === nodeId);
      if (index === -1) throw new Error(`node ${nodeId} does not exist`);
      if (candidate.nodes.length === 1) {
        throw new Error('a workflow must retain at least one node');
      }
      candidate.nodes.splice(index, 1);
      candidate.edges = candidate.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      );
      return candidate;
    }
    case 'add_edge': {
      const addedEdge = requireWorkflowEditField(edit.edge, edit.operation, 'edge');
      if (candidate.edges.some((edge) => edge.id === addedEdge.id)) {
        throw new Error(`edge ${addedEdge.id} already exists`);
      }
      candidate.edges.push(cloneJsonValue(addedEdge) as WorkflowGraph['edges'][number]);
      return candidate;
    }
    case 'replace_edge': {
      const edgeId = requireWorkflowEditField(edit.edgeId, edit.operation, 'edgeId');
      const replacementEdge = requireWorkflowEditField(edit.edge, edit.operation, 'edge');
      const index = candidate.edges.findIndex((edge) => edge.id === edgeId);
      if (index === -1) throw new Error(`edge ${edgeId} does not exist`);
      candidate.edges[index] = cloneJsonValue(replacementEdge) as WorkflowGraph['edges'][number];
      return candidate;
    }
    case 'remove_edge': {
      const edgeId = requireWorkflowEditField(edit.edgeId, edit.operation, 'edgeId');
      const index = candidate.edges.findIndex((edge) => edge.id === edgeId);
      if (index === -1) throw new Error(`edge ${edgeId} does not exist`);
      candidate.edges.splice(index, 1);
      return candidate;
    }
    default: {
      const unsupported: never = edit.operation;
      throw new Error(`Unsupported workflow edit: ${String(unsupported)}`);
    }
  }
}

function materializeWorkflowEdits(
  base: WorkflowGraph,
  edits: OperatorWorkflowEditOperation[],
): { graph: WorkflowGraph; errors: string[] } {
  let graph = OperatorWorkflowGraphSchema.parse(base);
  const errors: string[] = [];
  for (const [index, edit] of edits.entries()) {
    try {
      const candidate = applyWorkflowEdit(graph, edit);
      const parsed = OperatorWorkflowGraphSchema.safeParse(candidate);
      if (!parsed.success) {
        errors.push(
          ...validationErrors(parsed.error).map((error) => `operations.${index}: ${error}`),
        );
        continue;
      }
      graph = parsed.data;
    } catch (error: unknown) {
      errors.push(`operations.${index}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (errors.length >= 50) break;
  }
  return { graph, errors: errors.slice(0, 50) };
}

function validationErrors(error: unknown): string[] {
  const issues = isRecord(error) && Array.isArray(error.issues) ? error.issues : [];
  const formattedIssues = issues.flatMap((issue) => {
    if (!isRecord(issue) || typeof issue.message !== 'string') return [];
    const path = Array.isArray(issue.path) ? issue.path.map(String).join('.') : '';
    return [`${path ? `${path}: ` : ''}${issue.message}`];
  });
  if (formattedIssues.length > 0) return formattedIssues.slice(0, 50);

  const message = error instanceof Error ? error.message : String(error);
  return message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== 'Workflow validation failed:')
    .slice(0, 50);
}

@Injectable()
export class OperatorWorkflowAuthoringService {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly workflowVersionRepository: WorkflowVersionRepository,
    private readonly operatorRepository: OperatorRepository,
  ) {}

  listComponents(input: OperatorCommandInputMap['list_components']): unknown {
    const search = input.search?.toLowerCase();
    return componentRegistry
      .listMetadata()
      .map((entry) => {
        const component = entry.definition;
        return {
          id: component.id,
          name: component.label,
          category: categorizeComponent(component),
          description: component.ui?.description ?? component.docs ?? '',
          runner: component.runner?.kind ?? 'inline',
          agentCallable: isAgentCallable(component),
          inputCount: (entry.inputs ?? []).length,
          outputCount: (entry.outputs ?? []).length,
        };
      })
      .filter(
        (component) =>
          (!input.category || component.category === input.category) &&
          (!search ||
            component.id.toLowerCase().includes(search) ||
            component.name.toLowerCase().includes(search) ||
            component.description.toLowerCase().includes(search)),
      )
      .slice(0, input.limit);
  }

  getComponent(input: OperatorCommandInputMap['get_component']): unknown {
    const entry = componentRegistry.getMetadata(input.componentId);
    if (!entry) throw new NotFoundException(`Component ${input.componentId} not found`);
    const component = entry.definition;
    return {
      id: component.id,
      name: component.label,
      category: categorizeComponent(component),
      description: component.ui?.description ?? component.docs ?? '',
      documentation: component.docs ?? null,
      runner: component.runner,
      inputs: entry.inputs ?? extractPorts(component.inputs),
      outputs: entry.outputs ?? extractPorts(component.outputs),
      parameters: entry.parameters ?? [],
      agentCallable: isAgentCallable(component),
      toolSchema: isAgentCallable(component) ? getToolSchema(component) : null,
      examples: component.ui?.examples ?? [],
    };
  }

  projectGraph(graph: WorkflowGraph, base?: WorkflowGraph): WorkflowGraph {
    return projectCredentialValues(graph, base);
  }

  private async assertSourceRunLineage(input: {
    sourceRunId: string | undefined;
    workflowId: string | undefined;
    auth: AuthContext;
  }): Promise<void> {
    if (!input.sourceRunId) return;
    if (!input.workflowId) {
      throw new ConflictException('Source-run lineage requires an existing workflow');
    }
    const sourceRun = await this.workflowsService.getRun(input.sourceRunId, input.auth);
    if (sourceRun.workflowId !== input.workflowId) {
      throw new ConflictException(
        `Workflow run ${input.sourceRunId} does not belong to workflow ${input.workflowId}`,
      );
    }
    if (!(TERMINAL_STATUSES as readonly string[]).includes(sourceRun.status)) {
      throw new ConflictException(
        `Workflow run ${input.sourceRunId} is still ${sourceRun.status}; wait for it to finish before proposing an improvement`,
      );
    }
  }

  private buildProposalResult(input: {
    actionId: string;
    parentDraftId?: string;
    workflowId: string | undefined;
    baseVersionId: string | undefined;
    sourceRunId: string | undefined;
    proposedGraph: WorkflowGraph;
    persistedBaseGraph: WorkflowGraph | undefined;
    initialErrors?: string[];
    requireChanges?: boolean;
  }): OperatorWorkflowDraftResult {
    const baseGraph = input.persistedBaseGraph ? this.projectGraph(input.persistedBaseGraph) : null;
    let errors = [...(input.initialErrors ?? [])];
    let effectiveGraph = input.proposedGraph;
    try {
      effectiveGraph = restoreCredentialValues(input.proposedGraph, input.persistedBaseGraph);
      compileWorkflowGraph(effectiveGraph);
    } catch (error: unknown) {
      errors.push(...validationErrors(error));
    }

    const projectedGraph = this.projectGraph(effectiveGraph, input.persistedBaseGraph);
    const diff = buildGraphDiff(baseGraph, projectedGraph);
    if (input.requireChanges && !graphDiffHasChanges(diff)) {
      errors.push('Workflow edit proposal does not change the workflow');
    }
    errors = errors.slice(0, 50);
    return OperatorWorkflowDraftResultSchema.parse({
      kind: 'workflow-draft',
      draftId: input.actionId,
      ...(input.parentDraftId ? { parentDraftId: input.parentDraftId } : {}),
      mode: input.workflowId ? 'update' : 'create',
      workflowId: input.workflowId ?? null,
      baseVersionId: input.baseVersionId ?? null,
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      name: projectedGraph.name,
      digest: createHash('sha256').update(JSON.stringify(projectedGraph)).digest('hex'),
      validation: { valid: errors.length === 0, errors },
      diff,
    });
  }

  async propose(input: {
    arguments: OperatorCommandInputMap['propose_workflow_draft'];
    auth: AuthContext;
    actionId: string;
  }): Promise<OperatorWorkflowDraftResult> {
    const parsed = OperatorProposeWorkflowDraftInputSchema.parse(input.arguments);
    const baseRecord = parsed.baseVersionId
      ? await this.workflowVersionRepository.findById(parsed.baseVersionId, {
          organizationId: input.auth.organizationId,
        })
      : undefined;
    if (parsed.workflowId && (!baseRecord || baseRecord.workflowId !== parsed.workflowId)) {
      throw new NotFoundException(
        `Workflow version ${parsed.baseVersionId} not found for workflow ${parsed.workflowId}`,
      );
    }
    await this.assertSourceRunLineage({
      sourceRunId: parsed.sourceRunId,
      workflowId: parsed.workflowId,
      auth: input.auth,
    });
    return this.buildProposalResult({
      actionId: input.actionId,
      workflowId: parsed.workflowId,
      baseVersionId: parsed.baseVersionId,
      sourceRunId: parsed.sourceRunId,
      proposedGraph: parsed.graph,
      persistedBaseGraph: baseRecord?.graph,
    });
  }

  async proposeEdits(input: {
    arguments: OperatorCommandInputMap['propose_workflow_edits'];
    auth: AuthContext;
    actionId: string;
  }): Promise<OperatorWorkflowDraftResult> {
    const parsed = OperatorProposeWorkflowEditsInputSchema.parse(input.arguments);
    const baseRecord = await this.workflowVersionRepository.findById(parsed.baseVersionId, {
      organizationId: input.auth.organizationId,
    });
    if (!baseRecord || baseRecord.workflowId !== parsed.workflowId) {
      throw new NotFoundException(
        `Workflow version ${parsed.baseVersionId} not found for workflow ${parsed.workflowId}`,
      );
    }
    await this.assertSourceRunLineage({
      sourceRunId: parsed.sourceRunId,
      workflowId: parsed.workflowId,
      auth: input.auth,
    });

    const baseGraph = this.projectGraph(baseRecord.graph);
    const materialized = materializeWorkflowEdits(baseGraph, parsed.operations);
    return this.buildProposalResult({
      actionId: input.actionId,
      workflowId: parsed.workflowId,
      baseVersionId: parsed.baseVersionId,
      sourceRunId: parsed.sourceRunId,
      proposedGraph: materialized.graph,
      persistedBaseGraph: baseRecord.graph,
      initialErrors: materialized.errors,
      requireChanges: true,
    });
  }

  async getDraftDetail(input: {
    draftId: string;
    sessionId: string;
    auth: AuthContext;
  }): Promise<OperatorWorkflowDraftDetail> {
    const context = await this.operatorRepository.getActionWithTurnSession(input.draftId);
    if (
      !context ||
      context.session.id !== input.sessionId ||
      context.session.organizationId !== input.auth.organizationId
    ) {
      throw new NotFoundException('Operator workflow draft not found');
    }
    const actions = await this.operatorRepository.listActions(input.sessionId);
    const details = await this.listDraftDetails(actions, input.auth);
    const detail = details.find((candidate) => candidate.draftId === input.draftId);
    if (!detail) throw new NotFoundException('Operator workflow draft not found');
    return detail;
  }

  async revise(input: {
    arguments: OperatorCommandInputMap['revise_workflow_draft'];
    auth: AuthContext;
    sessionId: string;
    actionId: string;
  }): Promise<OperatorWorkflowDraftResult> {
    const parsed = OperatorReviseWorkflowDraftInputSchema.parse(input.arguments);
    const parent = await this.getDraftDetail({
      draftId: parsed.draftId,
      sessionId: input.sessionId,
      auth: input.auth,
    });
    const baseRecord = parent.baseVersionId
      ? await this.workflowVersionRepository.findById(parent.baseVersionId, {
          organizationId: input.auth.organizationId,
        })
      : undefined;
    if (parent.workflowId && (!baseRecord || baseRecord.workflowId !== parent.workflowId)) {
      throw new NotFoundException(
        `Workflow version ${parent.baseVersionId} not found for workflow ${parent.workflowId}`,
      );
    }

    const materialized = materializeWorkflowEdits(parent.proposedGraph, parsed.operations);
    if (!graphDiffHasChanges(buildGraphDiff(parent.proposedGraph, materialized.graph))) {
      materialized.errors.push('Workflow draft revision does not change the draft');
    }
    return this.buildProposalResult({
      actionId: input.actionId,
      parentDraftId: parent.draftId,
      workflowId: parent.workflowId ?? undefined,
      baseVersionId: parent.baseVersionId ?? undefined,
      sourceRunId: parent.sourceRunId,
      proposedGraph: materialized.graph,
      persistedBaseGraph: baseRecord?.graph,
      initialErrors: materialized.errors,
    });
  }

  private materializeStoredDraftGraph(
    actions: OperatorActionRecord[],
    draftId: string,
    persistedBaseGraph: WorkflowGraph | undefined,
    visited = new Set<string>(),
  ): WorkflowGraph {
    if (visited.has(draftId)) {
      throw new ConflictException('Operator workflow draft revision lineage is cyclic');
    }
    visited.add(draftId);
    const action = actions.find((candidate) => candidate.id === draftId);
    if (!action || action.status !== 'succeeded') {
      throw new NotFoundException('Operator workflow draft not found');
    }

    if (action.commandName === 'propose_workflow_draft') {
      return OperatorProposeWorkflowDraftInputSchema.parse(action.arguments).graph;
    }
    if (action.commandName === 'propose_workflow_edits') {
      if (!persistedBaseGraph) {
        throw new NotFoundException('Operator workflow draft base version no longer exists');
      }
      const proposal = OperatorProposeWorkflowEditsInputSchema.parse(action.arguments);
      const materialized = materializeWorkflowEdits(
        this.projectGraph(persistedBaseGraph),
        proposal.operations,
      );
      if (materialized.errors.length > 0) {
        throw new ConflictException(
          `Operator workflow edits no longer materialize cleanly: ${materialized.errors.join('; ')}`,
        );
      }
      return materialized.graph;
    }
    if (action.commandName === 'revise_workflow_draft') {
      const revision = OperatorReviseWorkflowDraftInputSchema.parse(action.arguments);
      const parentGraph = this.materializeStoredDraftGraph(
        actions,
        revision.draftId,
        persistedBaseGraph,
        visited,
      );
      const materialized = materializeWorkflowEdits(parentGraph, revision.operations);
      if (materialized.errors.length > 0) {
        throw new ConflictException(
          `Operator workflow draft revision no longer materializes cleanly: ${materialized.errors.join('; ')}`,
        );
      }
      return materialized.graph;
    }
    throw new ConflictException('Operator workflow draft is not a completed proposal');
  }

  async apply(input: {
    arguments: OperatorCommandInputMap['apply_workflow_draft'];
    auth: AuthContext;
    sessionId: string;
  }): Promise<OperatorWorkflowApplyResult> {
    const context = await this.operatorRepository.getActionWithTurnSession(input.arguments.draftId);
    if (!context || context.session.id !== input.sessionId) {
      throw new NotFoundException('Operator workflow draft not found');
    }
    if (context.action.status !== 'succeeded') {
      throw new ConflictException('Operator workflow draft is not a completed proposal');
    }
    if (
      context.action.commandName !== 'propose_workflow_draft' &&
      context.action.commandName !== 'propose_workflow_edits' &&
      context.action.commandName !== 'revise_workflow_draft'
    ) {
      throw new ConflictException('Operator workflow draft is not a completed proposal');
    }
    const proposalResult = OperatorWorkflowDraftResultSchema.parse(context.action.result);
    if (!proposalResult.validation.valid) {
      throw new ConflictException('Operator workflow draft must validate before it can be applied');
    }

    const proposal = await this.getDraftDetail({
      draftId: input.arguments.draftId,
      sessionId: input.sessionId,
      auth: input.auth,
    });
    const baseRecord = proposal.baseVersionId
      ? await this.workflowVersionRepository.findById(proposal.baseVersionId, {
          organizationId: input.auth.organizationId,
        })
      : undefined;
    if (proposal.workflowId && (!baseRecord || baseRecord.workflowId !== proposal.workflowId)) {
      throw new NotFoundException('Operator workflow draft base version no longer exists');
    }
    const actions = await this.operatorRepository.listActions(input.sessionId);
    const proposedGraph = this.materializeStoredDraftGraph(
      actions,
      proposal.draftId,
      baseRecord?.graph,
    );
    const effectiveGraph = restoreCredentialValues(proposedGraph, baseRecord?.graph);
    compileWorkflowGraph(effectiveGraph);

    const idempotencyKey = `operator-draft:${context.action.id}`;
    const staged = Boolean(proposal.workflowId && proposal.sourceRunId);
    const saved = proposal.workflowId
      ? staged
        ? await this.workflowsService.stageVersion(
            proposal.workflowId,
            effectiveGraph,
            input.auth,
            {
              expectedVersionId: proposal.baseVersionId ?? undefined,
              idempotencyKey,
            },
          )
        : await this.workflowsService.update(proposal.workflowId, effectiveGraph, input.auth, {
            expectedVersionId: proposal.baseVersionId ?? undefined,
            idempotencyKey,
          })
      : await this.workflowsService.create(effectiveGraph, input.auth, { idempotencyKey });
    const versionId = 'currentVersionId' in saved ? saved.currentVersionId : saved.id;
    const version = 'currentVersion' in saved ? saved.currentVersion : saved.version;
    if (!versionId || !version)
      throw new Error('Workflow save did not return an immutable version');
    return {
      kind: 'workflow-applied',
      draftId: context.action.id,
      workflowId: proposal.workflowId ?? saved.id,
      versionId,
      version,
      created: !proposal.workflowId,
      staged,
      name: saved.name,
      ...(proposal.sourceRunId ? { sourceRunId: proposal.sourceRunId } : {}),
    };
  }

  async listDraftDetails(
    actions: OperatorActionRecord[],
    auth: AuthContext,
  ): Promise<OperatorWorkflowDraftDetail[]> {
    const proposals = actions.filter(
      (action) =>
        (action.commandName === 'propose_workflow_draft' ||
          action.commandName === 'propose_workflow_edits' ||
          action.commandName === 'revise_workflow_draft') &&
        action.status === 'succeeded',
    );
    const parsed: StoredWorkflowProposal[] = [];
    for (const action of proposals) {
      const result = OperatorWorkflowDraftResultSchema.safeParse(action.result);
      if (!result.success) continue;
      if (action.commandName === 'propose_workflow_draft') {
        const argumentsResult = OperatorProposeWorkflowDraftInputSchema.safeParse(action.arguments);
        if (argumentsResult.success) {
          parsed.push({
            kind: 'graph',
            action,
            arguments: argumentsResult.data,
            result: result.data,
          });
        }
        continue;
      }
      if (action.commandName === 'propose_workflow_edits') {
        const argumentsResult = OperatorProposeWorkflowEditsInputSchema.safeParse(action.arguments);
        if (argumentsResult.success) {
          parsed.push({
            kind: 'edits',
            action,
            arguments: argumentsResult.data,
            result: result.data,
          });
        }
        continue;
      }
      const argumentsResult = OperatorReviseWorkflowDraftInputSchema.safeParse(action.arguments);
      if (argumentsResult.success && result.data.parentDraftId === argumentsResult.data.draftId) {
        parsed.push({
          kind: 'revision',
          action,
          arguments: argumentsResult.data,
          result: result.data,
        });
      }
    }
    const baseVersionIds = parsed.flatMap(({ result }) =>
      result.baseVersionId ? [result.baseVersionId] : [],
    );
    const baseVersions = await this.workflowVersionRepository.findByIds(baseVersionIds, {
      organizationId: auth.organizationId,
    });
    const baseById = new Map(baseVersions.map((version) => [version.id, version]));

    const details: OperatorWorkflowDraftDetail[] = [];
    const detailsByDraftId = new Map<string, OperatorWorkflowDraftDetail>();
    for (const { kind, action, arguments: value, result } of parsed) {
      const baseVersion = result.baseVersionId ? baseById.get(result.baseVersionId) : undefined;
      if (kind === 'edits' && !baseVersion) continue;
      let proposedGraph: WorkflowGraph;
      if (kind === 'graph') {
        try {
          proposedGraph = this.projectGraph(
            restoreCredentialValues(value.graph, baseVersion?.graph),
            baseVersion?.graph,
          );
        } catch {
          // Invalid proposals still need a safe preview. Their validation result
          // prevents apply, so fall back to redacting the stored arguments.
          proposedGraph = this.projectGraph(value.graph, baseVersion?.graph);
        }
      } else if (kind === 'edits') {
        if (!baseVersion) continue;
        const projectedBase = this.projectGraph(baseVersion.graph);
        const materialized = materializeWorkflowEdits(projectedBase, value.operations);
        try {
          proposedGraph = this.projectGraph(
            restoreCredentialValues(materialized.graph, baseVersion.graph),
            baseVersion.graph,
          );
        } catch {
          proposedGraph = this.projectGraph(materialized.graph, baseVersion.graph);
        }
      } else {
        const parent = detailsByDraftId.get(value.draftId);
        if (!parent) continue;
        const materialized = materializeWorkflowEdits(parent.proposedGraph, value.operations);
        try {
          proposedGraph = this.projectGraph(
            restoreCredentialValues(materialized.graph, baseVersion?.graph),
            baseVersion?.graph,
          );
        } catch {
          proposedGraph = this.projectGraph(materialized.graph, baseVersion?.graph);
        }
      }
      const detail: OperatorWorkflowDraftDetail = {
        ...result,
        proposalActionId: action.id,
        sessionId: action.sessionId,
        proposedGraph,
        baseGraph: baseVersion ? this.projectGraph(baseVersion.graph) : null,
      };
      details.push(detail);
      detailsByDraftId.set(detail.draftId, detail);
    }
    return details;
  }
}
