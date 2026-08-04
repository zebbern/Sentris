import type { Edge, Node } from '@xyflow/react';
import { useCallback, useMemo } from 'react';

import { useComponents } from '@/hooks/queries/useComponentQueries';
import { useMcpAllTools, useMcpServers } from '@/hooks/queries/useMcpServerQueries';
import { useSecrets } from '@/hooks/queries/useSecretQueries';
import type { FrontendNodeData } from '@/schemas/node';
import {
  evaluateWorkflowRunReadiness,
  hasConnectedWorkflowMcpCustom,
  type WorkflowRunReadiness,
} from './workflowAdapter';

const EMPTY_READINESS: WorkflowRunReadiness = {
  rows: [],
  issues: [],
  configurationIssues: [],
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useWorkflowRunReadiness(input: {
  nodes: readonly Node<FrontendNodeData>[];
  edges: readonly Edge[];
  enabled?: boolean;
}) {
  const enabled = input.enabled ?? true;
  const componentsQuery = useComponents();
  const secretsQuery = useSecrets({ enabled });
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
      enabled &&
      hasConnectedWorkflowMcpCustom({
        nodes: input.nodes,
        edges: input.edges,
        getComponent,
      }),
    [enabled, getComponent, input.edges, input.nodes],
  );
  const mcpServersQuery = useMcpServers({ enabled: hasConnectedCustomMcp });
  const mcpToolsQuery = useMcpAllTools({ enabled: hasConnectedCustomMcp });
  const readiness = useMemo(
    () =>
      enabled
        ? evaluateWorkflowRunReadiness({
            nodes: input.nodes,
            edges: input.edges,
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
          })
        : EMPTY_READINESS,
    [
      enabled,
      getComponent,
      input.edges,
      input.nodes,
      mcpServersQuery.data,
      mcpServersQuery.error,
      mcpServersQuery.isLoading,
      mcpToolsQuery.data,
      mcpToolsQuery.error,
      mcpToolsQuery.isLoading,
      secretsQuery.data,
      secretsQuery.error,
      secretsQuery.isLoading,
    ],
  );
  const isPending = Boolean(
    enabled &&
    (componentsQuery.isLoading ||
      secretsQuery.isLoading ||
      (hasConnectedCustomMcp && (mcpServersQuery.isLoading || mcpToolsQuery.isLoading))),
  );
  const error =
    enabled && componentsQuery.error
      ? errorMessage(componentsQuery.error, 'Could not load component readiness metadata.')
      : null;

  return { readiness, isPending, error } as const;
}
