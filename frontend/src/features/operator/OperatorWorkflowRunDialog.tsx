import { WorkflowGraphSchema, WorkflowRuntimeInputDefinitionsSchema } from '@sentris/shared';
import type { Edge, Node } from '@xyflow/react';
import { useMemo } from 'react';

import {
  RunWorkflowDialog,
  type RuntimeInputDefinition,
} from '@/components/workflow/RunWorkflowDialog';
import { useWorkflowRunReadiness } from '@/features/agent-readiness/useWorkflowRunReadiness';
import { useWorkflow, useWorkflowVersion } from '@/hooks/queries/useWorkflowQueries';
import type { FrontendNodeData } from '@/schemas/node';
import { isEntryPointComponentRef } from '@/utils/entryPointUtils';

export type OperatorWorkflowRunSelection =
  | {
      workflowId: string;
      name: string;
      versionId?: undefined;
      version?: undefined;
    }
  | {
      workflowId: string;
      name: string;
      versionId: string;
      version: number;
    };

interface ResolvedOperatorWorkflowRunSelection {
  workflowId: string;
  name: string;
  versionId: string;
  version: number;
}

interface OperatorWorkflowRunDialogProps {
  workflow: OperatorWorkflowRunSelection | null;
  onOpenChange: (open: boolean) => void;
  onRun: (
    workflow: ResolvedOperatorWorkflowRunSelection,
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
  const currentWorkflowQuery = useWorkflow(
    workflow && !workflow.versionId ? workflow.workflowId : undefined,
  );

  const parsedGraph = useMemo(() => {
    const savedGraph = workflow?.versionId
      ? versionQuery.data?.graph
      : currentWorkflowQuery.data?.graph;
    return savedGraph ? WorkflowGraphSchema.safeParse(savedGraph) : null;
  }, [currentWorkflowQuery.data?.graph, versionQuery.data?.graph, workflow?.versionId]);
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
  const runReadiness = useWorkflowRunReadiness({ nodes, edges, enabled: open });
  const readiness = runReadiness.readiness;

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
    ((workflow?.versionId ? versionQuery.isLoading : currentWorkflowQuery.isLoading) ||
      runReadiness.isPending),
  );
  const workflowQueryError = workflow?.versionId ? versionQuery.error : currentWorkflowQuery.error;
  const resolvedWorkflow = useMemo<ResolvedOperatorWorkflowRunSelection | null>(() => {
    if (!workflow) return null;
    if (workflow.versionId) {
      return { ...workflow, versionId: workflow.versionId, version: workflow.version };
    }
    const versionId = currentWorkflowQuery.data?.currentVersionId;
    const version = currentWorkflowQuery.data?.currentVersion;
    return versionId && version ? { ...workflow, versionId, version } : null;
  }, [
    currentWorkflowQuery.data?.currentVersion,
    currentWorkflowQuery.data?.currentVersionId,
    workflow,
  ]);
  const readinessError = workflowQueryError
    ? errorMessage(workflowQueryError, 'Could not load the saved workflow version.')
    : runReadiness.error
      ? runReadiness.error
      : workflow && !workflow.versionId && currentWorkflowQuery.data && !resolvedWorkflow
        ? 'This workflow does not have a current version to run.'
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
        if (resolvedWorkflow) onRun(resolvedWorkflow, inputs, scopeId);
      }}
    />
  );
}
