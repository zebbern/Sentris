import type { WorkflowGraphDto, WorkflowNodeDto } from '../workflows/dto/workflow-graph.dto';
import type {
  WorkflowAction,
  WorkflowDefinitionCore,
  WorkflowEdge,
  WorkflowNodeMetadata,
  LoopBodyDefinition,
} from './types';

const FOR_EACH_COMPONENT_ID = 'core.workflow.for-each';
const LOOP_BODY_SOURCE_HANDLE = 'body';
const LOOP_BACK_TARGET_HANDLE = 'loopBack';

type GraphEdge = WorkflowGraphDto['edges'][number];

export interface LoopExtractionResult {
  mainNodeIds: string[];
  mainEdges: GraphEdge[];
  loopBodies: Record<string, LoopBodyDefinition>;
}

function isForEachNode(node: WorkflowNodeDto): boolean {
  return node.type === FOR_EACH_COMPONENT_ID;
}

function collectBodyNodeIds(
  forEachId: string,
  bodyEntryRef: string,
  graphEdges: GraphEdge[],
): Set<string> {
  const bodyNodeIds = new Set<string>();
  const queue = [bodyEntryRef];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === forEachId || bodyNodeIds.has(current)) {
      continue;
    }

    bodyNodeIds.add(current);

    for (const edge of graphEdges) {
      if (edge.source !== current) {
        continue;
      }
      if (edge.target === forEachId) {
        continue;
      }
      if (!bodyNodeIds.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }

  return bodyNodeIds;
}

function findBodyEntryEdge(
  forEachId: string,
  graphEdges: GraphEdge[],
): { edge: GraphEdge; bodyEntryRef: string } | null {
  const candidates = graphEdges.filter(
    (edge) => edge.source === forEachId && edge.sourceHandle === LOOP_BODY_SOURCE_HANDLE,
  );

  if (candidates.length === 0) {
    const fallback = graphEdges.filter(
      (edge) => edge.source === forEachId && edge.target !== forEachId,
    );
    if (fallback.length === 1) {
      return { edge: fallback[0], bodyEntryRef: fallback[0].target };
    }
    return null;
  }

  if (candidates.length > 1) {
    throw new Error(
      `For Each node '${forEachId}' has multiple '${LOOP_BODY_SOURCE_HANDLE}' edges; connect exactly one body entry.`,
    );
  }

  return { edge: candidates[0], bodyEntryRef: candidates[0].target };
}

function findLoopBackEdges(
  forEachId: string,
  bodyNodeIds: Set<string>,
  graphEdges: GraphEdge[],
): GraphEdge[] {
  return graphEdges.filter(
    (edge) =>
      edge.target === forEachId &&
      edge.targetHandle === LOOP_BACK_TARGET_HANDLE &&
      bodyNodeIds.has(edge.source),
  );
}

function buildLoopBodyDefinition(options: {
  forEachId: string;
  bodyNodeIds: Set<string>;
  bodyEntryRef: string;
  loopBackEdges: GraphEdge[];
  bodyEntryEdge: GraphEdge;
  graphEdges: GraphEdge[];
  nodesMetadata: Record<string, WorkflowNodeMetadata>;
  actionsByRef: Map<string, WorkflowAction>;
}): LoopBodyDefinition {
  const {
    forEachId,
    bodyNodeIds,
    bodyEntryRef,
    loopBackEdges,
    bodyEntryEdge,
    graphEdges,
    nodesMetadata,
    actionsByRef,
  } = options;

  if (loopBackEdges.length === 0) {
    throw new Error(
      `For Each node '${forEachId}' loop body must connect back with targetHandle '${LOOP_BACK_TARGET_HANDLE}'.`,
    );
  }

  const exitRefs = [...new Set(loopBackEdges.map((edge) => edge.source))];
  const primaryLoopBack = loopBackEdges[0];
  const iterationCapture = {
    sourceRef: primaryLoopBack.source,
    sourceHandle: primaryLoopBack.sourceHandle ?? '__self__',
  };

  const bodyEdges = graphEdges.filter((edge) => {
    const sourceInBody = bodyNodeIds.has(edge.source);
    const targetInBody = bodyNodeIds.has(edge.target);
    const isLoopBack = edge.target === forEachId && edge.targetHandle === LOOP_BACK_TARGET_HANDLE;
    const isBodyEntry = edge.source === forEachId && edge.sourceHandle === LOOP_BODY_SOURCE_HANDLE;
    if (isLoopBack || isBodyEntry) {
      return false;
    }
    return sourceInBody && targetInBody;
  });

  const bodyActions: WorkflowAction[] = [];
  for (const nodeId of bodyNodeIds) {
    const action = actionsByRef.get(nodeId);
    if (!action) {
      throw new Error(`Loop body references unknown node '${nodeId}'.`);
    }

    bodyActions.push({
      ...action,
      dependsOn: action.dependsOn.filter((dep) => bodyNodeIds.has(dep)),
    });
  }

  const bodyNodes: Record<string, WorkflowNodeMetadata> = {};
  for (const nodeId of bodyNodeIds) {
    const metadata = nodesMetadata[nodeId];
    if (metadata) {
      bodyNodes[nodeId] = metadata;
    }
  }

  const dependencyCounts: Record<string, number> = {};
  for (const action of bodyActions) {
    dependencyCounts[action.ref] = action.dependsOn.length;
  }

  const definition: WorkflowDefinitionCore = {
    version: 2,
    title: `Loop body for ${forEachId}`,
    entrypoint: { ref: bodyEntryRef },
    nodes: bodyNodes,
    edges: bodyEdges.map(
      (edge): WorkflowEdge => ({
        id: edge.id,
        sourceRef: edge.source,
        targetRef: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        kind: edge.kind ?? 'success',
      }),
    ),
    dependencyCounts,
    actions: bodyActions,
    config: { environment: 'default', timeoutSeconds: 0 },
  };

  return {
    forEachRef: forEachId,
    bodyEntryRef,
    exitRefs,
    iterationCapture,
    itemBinding: {
      targetRef: bodyEntryEdge.target,
      targetHandle: bodyEntryEdge.targetHandle ?? 'currentItem',
    },
    definition,
  };
}

export function extractLoopBodies(
  executableNodes: WorkflowNodeDto[],
  graphEdges: GraphEdge[],
  nodesMetadata: Record<string, WorkflowNodeMetadata>,
  actionsByRef: Map<string, WorkflowAction>,
): LoopExtractionResult {
  const forEachNodes = executableNodes.filter(isForEachNode);
  if (forEachNodes.length === 0) {
    return {
      mainNodeIds: executableNodes.map((node) => node.id),
      mainEdges: graphEdges,
      loopBodies: {},
    };
  }

  if (forEachNodes.length > 1) {
    throw new Error('Workflows currently support at most one For Each node.');
  }

  const forEachNode = forEachNodes[0];
  const forEachId = forEachNode.id;
  const bodyEntry = findBodyEntryEdge(forEachId, graphEdges);
  if (!bodyEntry) {
    throw new Error(
      `For Each node '${forEachId}' requires a '${LOOP_BODY_SOURCE_HANDLE}' edge to the loop body entry node.`,
    );
  }

  const bodyNodeIds = collectBodyNodeIds(forEachId, bodyEntry.bodyEntryRef, graphEdges);
  if (bodyNodeIds.size === 0) {
    throw new Error(`For Each node '${forEachId}' loop body is empty.`);
  }

  const loopBackEdges = findLoopBackEdges(forEachId, bodyNodeIds, graphEdges);
  const loopBody = buildLoopBodyDefinition({
    forEachId,
    bodyNodeIds,
    bodyEntryRef: bodyEntry.bodyEntryRef,
    loopBackEdges,
    bodyEntryEdge: bodyEntry.edge,
    graphEdges,
    nodesMetadata,
    actionsByRef,
  });

  const mainNodeIds = executableNodes
    .map((node) => node.id)
    .filter((nodeId) => nodeId === forEachId || !bodyNodeIds.has(nodeId));

  const mainEdges = graphEdges.filter((edge) => {
    const sourceInBody = bodyNodeIds.has(edge.source);
    const targetInBody = bodyNodeIds.has(edge.target);
    const isLoopBack = edge.target === forEachId && edge.targetHandle === LOOP_BACK_TARGET_HANDLE;
    const isBodyEntry =
      edge.source === forEachId &&
      (edge.sourceHandle === LOOP_BODY_SOURCE_HANDLE || bodyNodeIds.has(edge.target));
    if (isLoopBack || isBodyEntry) {
      return false;
    }
    return !(sourceInBody && targetInBody);
  });

  return {
    mainNodeIds,
    mainEdges,
    loopBodies: { [forEachId]: loopBody },
  };
}

export function topoSortWithoutLoopBackCycles(
  nodes: string[],
  edges: { source: string; target: string }[],
  loopBodies: Record<string, LoopBodyDefinition>,
): string[] {
  const loopBackPairs = new Set<string>();
  for (const loopBody of Object.values(loopBodies)) {
    for (const exitRef of loopBody.exitRefs) {
      loopBackPairs.add(`${exitRef}->${loopBody.forEachRef}`);
    }
  }

  const filteredEdges = edges.filter(
    (edge) => !loopBackPairs.has(`${edge.source}->${edge.target}`),
  );

  const incoming = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  nodes.forEach((id) => {
    incoming.set(id, 0);
    adjacency.set(id, []);
  });

  for (const edge of filteredEdges) {
    if (!incoming.has(edge.target) || !incoming.has(edge.source)) {
      continue;
    }
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    adjacency.get(edge.source)?.push(edge.target);
  }

  const queue: string[] = nodes.filter((id) => (incoming.get(id) ?? 0) === 0);
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      incoming.set(neighbor, (incoming.get(neighbor) ?? 1) - 1);
      if ((incoming.get(neighbor) ?? 0) === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (result.length !== nodes.length) {
    throw new Error('Workflow graph contains a cycle');
  }

  return result;
}

export { FOR_EACH_COMPONENT_ID, LOOP_BODY_SOURCE_HANDLE, LOOP_BACK_TARGET_HANDLE };
