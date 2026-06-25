import { useCallback, useMemo } from 'react';
import type { McpGroupServerResponse } from '@/services/mcpGroupsApi';
import type { McpHealthStatus } from '@sentris/shared';
import type { McpServerResponse, McpToolResponse } from '@/hooks/queries/useMcpServerQueries';
import type { McpGroupResponse, McpGroupTemplateResponse } from '@/services/mcpGroupsApi';
import type { AgentReadiness, TransportType } from './types';
import { getMcpAgentReadiness } from './utils';

interface UseMcpLibraryDataOptions {
  servers: McpServerResponse[];
  tools: McpToolResponse[];
  groups: McpGroupResponse[];
  groupTemplates: McpGroupTemplateResponse[];
  searchQuery: string;
  selectedServerForTools: string | null;
}

export function useMcpLibraryData({
  servers,
  tools,
  groups,
  groupTemplates,
  searchQuery,
  selectedServerForTools,
}: UseMcpLibraryDataOptions) {
  const getGroupServers = useCallback(
    (groupId: string): McpGroupServerResponse[] => {
      return groups.find((g) => g.id === groupId)?.servers ?? [];
    },
    [groups],
  );

  const groupedServerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const server of servers) {
      if (server.groupId) ids.add(server.id);
    }
    for (const group of groups) {
      for (const gs of getGroupServers(group.id)) {
        ids.add(gs.serverId);
      }
    }
    return ids;
  }, [servers, groups, getGroupServers]);

  const filteredCustomServers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const customServers = servers.filter((s) => !groupedServerIds.has(s.id));
    if (!query) return customServers;
    return customServers.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.description?.toLowerCase().includes(query) ||
        s.endpoint?.toLowerCase().includes(query),
    );
  }, [servers, searchQuery, groupedServerIds]);

  const importedGroupSlugs = useMemo(() => new Set(groups.map((g) => g.slug)), [groups]);

  const filteredTemplates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return groupTemplates;
    return groupTemplates.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.slug.toLowerCase().includes(query) ||
        t.description?.toLowerCase().includes(query),
    );
  }, [groupTemplates, searchQuery]);

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(query) ||
        g.slug.toLowerCase().includes(query) ||
        g.description?.toLowerCase().includes(query),
    );
  }, [groups, searchQuery]);

  const toolCountsByServer = useMemo(() => {
    const counts: Record<string, { enabled: number; total: number }> = {};
    for (const server of servers) {
      const serverTools = tools.filter((t) => t.serverId === server.id);
      counts[server.id] = {
        enabled: serverTools.filter((t) => t.enabled).length,
        total: serverTools.length,
      };
    }
    return counts;
  }, [servers, tools]);

  const readinessByServer = useMemo(() => {
    const readiness: Record<string, AgentReadiness> = {};
    for (const server of servers) {
      readiness[server.id] = getMcpAgentReadiness({
        enabled: server.enabled,
        healthStatus: server.lastHealthStatus ?? null,
        toolCounts: toolCountsByServer[server.id] ?? null,
      });
    }
    return readiness;
  }, [servers, toolCountsByServer]);

  const serverTools = useMemo(() => {
    if (!selectedServerForTools) return [];
    return tools.filter((t) => t.serverId === selectedServerForTools);
  }, [tools, selectedServerForTools]);

  const selectedServer = useMemo<{ name?: string; transportType?: TransportType } | null>(() => {
    if (!selectedServerForTools) return null;
    const direct = servers.find((s) => s.id === selectedServerForTools);
    if (direct) return direct;
    for (const group of groups) {
      const match = getGroupServers(group.id).find((s) => s.serverId === selectedServerForTools);
      if (match) {
        return { name: match.serverName, transportType: match.transportType };
      }
    }
    return null;
  }, [servers, selectedServerForTools, groups, getGroupServers]);

  const getGroupServerHealthStatus = useCallback(
    (server: { serverId: string; healthStatus: McpHealthStatus }) =>
      servers.find((s) => s.id === server.serverId)?.lastHealthStatus ?? server.healthStatus,
    [servers],
  );

  const getGroupServerToolCounts = useCallback(
    (server: { serverId: string; toolCount: number }) => {
      const counts = toolCountsByServer[server.serverId];
      if (counts && !(counts.total === 0 && server.toolCount > 0)) return counts;
      const fallbackTotal = server.toolCount;
      return fallbackTotal > 0 ? { enabled: fallbackTotal, total: fallbackTotal } : null;
    },
    [toolCountsByServer],
  );

  const getGroupServerReadiness = useCallback(
    (server: {
      serverId: string;
      enabled: boolean;
      healthStatus: McpHealthStatus;
      toolCount: number;
    }) =>
      getMcpAgentReadiness({
        enabled: server.enabled,
        healthStatus: getGroupServerHealthStatus(server),
        toolCounts: getGroupServerToolCounts(server),
      }),
    [getGroupServerHealthStatus, getGroupServerToolCounts],
  );

  const getServerDiscoveryImage = useCallback(
    (serverId: string) => {
      const server = servers.find((s) => s.id === serverId);
      if (!server?.groupId) return undefined;
      const group = groups.find((g) => g.id === server.groupId);
      return group?.defaultDockerImage ?? undefined;
    },
    [servers, groups],
  );

  return {
    getGroupServers,
    groupedServerIds,
    filteredCustomServers,
    importedGroupSlugs,
    filteredTemplates,
    filteredGroups,
    toolCountsByServer,
    readinessByServer,
    serverTools,
    selectedServer,
    getGroupServerHealthStatus,
    getGroupServerToolCounts,
    getGroupServerReadiness,
    getServerDiscoveryImage,
  };
}
