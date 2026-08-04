import {
  WorkflowGraphSchema,
  WorkflowRuntimeInputDefinitionsSchema,
  type OperatorWorkflowApplyResult,
} from '@sentris/shared';
import type { Edge, Node } from '@xyflow/react';
import { useCallback, useMemo } from 'react';

import {
  RunWorkflowDialog,
  type RuntimeInputDefinition,
} from '@/components/workflow/RunWorkflowDialog';
import {
  evaluateWorkflowRunReadiness,
  hasConnectedWorkflowMcpCustom,
} from '@/features/agent-readiness/workflowAdapter';
import { useComponents } from '@/hooks/queries/useComponentQueries';
import { useMcpAllTools, useMcpServers } from '@/hooks/queries/useMcpServerQueries';
import { useSecrets } from '@/hooks/queries/useSecretQueries';
import { useWorkflowVersion } from '@/hooks/queries/useWorkflowQueries';
import type { FrontendNodeData } from '@/schemas/node';
import { isEntryPointComponentRef } from '@/utils/entryPointUtils';

interface OperatorWorkflowRunDialogProps {
  workflow: OperatorWorkflowApplyResult | null;
  onOpenChange: (open: boolean) => void;
  onRun: (
    workflow: OperatorWorkflowApplyResult,
    inputs: Record<string, unknown>,
    scopeId?: string | null,
  ) => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function OperatorWorkflowRunDialog({
  workflow,
  onOpenChange,
  onRun,
}: OperatorWorkflowRunDialogProps) {
  const open = workflow !== null;
  const versionQuery = useWorkflowVersion(workflow?.workflowId, workflow?.versionId);
  const componentsQuery = useComponents();
  const secretsQuery = useSecrets({ enabled: open });

  const parsedGraph = useMemo(
    () => (versionQuery.data ? WorkflowGraphSchema.safeParse(versionQuery.data.graph) : null),
    [versionQuery.data],
  );
  const graph = parsedGraph?.success ? parsedGraph.data : null;
  const nodes = useMemo<Node<FrontendNodeData>[]>(
    () =>
      graph
        ? graph.nodes.map((node) => {
            const {
              dynamicInputs: _dynamicInputs,
              dynamicOutputs: _dynamicOutputs,
              ...data
            } = node.data;
            return {
              ...node,
              data: {
                ...data,
                componentId: node.type,
              },
            };
          })
        : [],
    [graph],
  );
  const edges = useMemo<Edge[]>(() => (graph ? graph.edges : []), [graph]);
  const getComponent = useCallback(
    (ref: string | undefined) => {
      const componentIndex = componentsQuery.data;
      if (!componentIndex || !ref) return null;
      if (componentIndex.byId[ref]) return componentIndex.byId[ref];
      const idFromSlug = componentIndex.slugIndex[ref];
      return idFromSlug ? (componentIndex.byId[idFromSlug] ?? null) : null;
    },
    [componentsQuery.data],
  );
  const hasConnectedCustomMcp = useMemo(
    () =>
      open &&
      hasConnectedWorkflowMcpCustom({
        nodes,
        edges,
        getComponent,
      }),
    [edges, getComponent, nodes, open],
  );
  const mcpServersQuery = useMcpServers({ enabled: hasConnectedCustomMcp });
  const mcpToolsQuery = useMcpAllTools({ enabled: hasConnectedCustomMcp });

  const readiness = useMemo(
    () =>
      evaluateWorkflowRunReadiness({
        nodes,
        edges,
        getComponent,
        secrets: {
          items: secretsQuery.data ?? [],
          isLoading: secretsQuery.isLoading,
          error: secretsQuery.error,
        },
        mcpServers: {
          items: mcpServersQuery.data ?? [],
          isLoading: mcpServersQuery.isLoading,
          error: mcpServersQuery.error,
        },
        mcpTools: {
          items: mcpToolsQuery.data ?? [],
          isLoading: mcpToolsQuery.isLoading,
          error: mcpToolsQuery.error,
        },
      }),
    [
      edges,
      getComponent,
      mcpServersQuery.data,
      mcpServersQuery.error,
      mcpServersQuery.isLoading,
      mcpToolsQuery.data,
      mcpToolsQuery.error,
      mcpToolsQuery.isLoading,
      nodes,
      secretsQuery.data,
      secretsQuery.error,
      secretsQuery.isLoading,
    ],
  );

  const runtimeInputResult = useMemo(() => {
    if (!graph) return null;
    const entryNode = graph.nodes.find((node) => isEntryPointComponentRef(node.type));
    const params = entryNode?.data.config?.params;
    return WorkflowRuntimeInputDefinitionsSchema.safeParse(params?.runtimeInputs ?? []);
  }, [graph]);
  const runtimeInputs: RuntimeInputDefinition[] = runtimeInputResult?.success
    ? runtimeInputResult.data
    : [];
  const initialValues = useMemo(
    () =>
      runtimeInputs.reduce<Record<string, unknown>>((values, input) => {
        if (input.defaultValue !== undefined && input.defaultValue !== null) {
          values[input.id] = input.defaultValue;
        }
        return values;
      }, {}),
    [runtimeInputs],
  );
  const readinessPending = Boolean(
    open &&
    (versionQuery.isLoading ||
      componentsQuery.isLoading ||
      secretsQuery.isLoading ||
      (hasConnectedCustomMcp && (mcpServersQuery.isLoading || mcpToolsQuery.isLoading))),
  );
  const readinessError = versionQuery.error
    ? errorMessage(versionQuery.error, 'Could not load the saved workflow version.')
    : componentsQuery.error
      ? errorMessage(componentsQuery.error, 'Could not load component readiness metadata.')
      : parsedGraph && !parsedGraph.success
        ? 'The saved workflow version has an invalid graph contract.'
        : runtimeInputResult && !runtimeInputResult.success
          ? 'The saved workflow version has an invalid runtime-input contract.'
          : null;
  const readinessIssues = [
    ...new Set(
      readiness.configurationIssues.map((issue) => `${issue.nodeLabel}: ${issue.message}`),
    ),
  ];

  return (
    <RunWorkflowDialog
      open={open}
      onOpenChange={onOpenChange}
      runtimeInputs={runtimeInputs}
      initialValues={initialValues}
      readinessRows={readiness.rows}
      readinessIssues={readinessIssues}
      readinessPending={readinessPending}
      readinessError={readinessError}
      configurationHref={
        workflow ? `/workflows/${encodeURIComponent(workflow.workflowId)}` : undefined
      }
      onRun={(inputs, scopeId) => {
        if (workflow) onRun(workflow, inputs, scopeId);
      }}
    />
  );
}
