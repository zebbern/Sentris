import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { queryKeys } from '@/lib/queryKeys';
import { mcpGroupsApi } from '@/services/mcpGroupsApi';
import { mcpDiscoveryApi } from '@/services/mcpDiscoveryApi';
import type { McpGroupTemplateResponse } from '@/services/mcpGroupsApi';
import type { DiscoveryPreviewItem } from './types';

interface UseGroupActionsOptions {
  groupCount: number;
  confirm: (opts: { title: string; description: string; confirmLabel: string }) => Promise<boolean>;
}

export function useGroupActions({ groupCount, confirm }: UseGroupActionsOptions) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [importingTemplates, setImportingTemplates] = useState<Set<string>>(new Set());
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templatesManuallyToggled, setTemplatesManuallyToggled] = useState(false);
  const [groupDiscoveryPreview, setGroupDiscoveryPreview] = useState<
    Record<string, DiscoveryPreviewItem[]>
  >({});
  const [discoveringGroups, setDiscoveringGroups] = useState<Set<string>>(new Set());

  // Default: show templates when no groups are installed
  useEffect(() => {
    if (templatesManuallyToggled) return;
    setTemplatesOpen(groupCount === 0);
  }, [groupCount, templatesManuallyToggled]);

  const toggleTemplates = useCallback(() => {
    setTemplatesManuallyToggled(true);
    setTemplatesOpen((prev) => !prev);
  }, []);

  const refreshTemplates = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.mcpGroups.templates() });
  }, [queryClient]);

  const clearGroupDiscoveryPreview = useCallback((slug: string) => {
    setGroupDiscoveryPreview((prev) => {
      const { [slug]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const handleGroupTestAndDiscover = useCallback(
    async (template: McpGroupTemplateResponse) => {
      if (discoveringGroups.has(template.slug)) return;

      setDiscoveringGroups((prev) => new Set(prev).add(template.slug));

      const initialResults: DiscoveryPreviewItem[] = template.servers.map((server) => ({
        name: server.name,
        transportType: server.transportType,
        toolCount: 0,
        status: 'pending' as const,
      }));
      setGroupDiscoveryPreview((prev) => ({ ...prev, [template.slug]: initialResults }));

      try {
        const results: DiscoveryPreviewItem[] = initialResults.map((e) => ({
          ...e,
          status: 'discovering' as const,
        }));
        setGroupDiscoveryPreview((prev) => ({ ...prev, [template.slug]: [...results] }));

        const { workflowId, cacheTokens } = await mcpDiscoveryApi.discoverGroup({
          image: template.defaultDockerImage,
          servers: template.servers.map((server) => ({
            transport: server.transportType,
            name: server.name,
            endpoint: server.transportType === 'http' ? (server.endpoint ?? undefined) : undefined,
            command: server.transportType === 'stdio' ? (server.command ?? undefined) : undefined,
            args: server.transportType === 'stdio' ? (server.args ?? undefined) : undefined,
          })),
        });

        const maxAttempts = 60;
        let finished = false;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const status = await mcpDiscoveryApi.getGroupStatus(workflowId);

          if (status.status === 'completed') {
            const resultsByName = new Map(
              (status.results ?? []).map((result) => [result.name, result]),
            );
            const updated: DiscoveryPreviewItem[] = template.servers.map((server) => {
              const result = resultsByName.get(server.name);
              if (!result) {
                return {
                  name: server.name,
                  transportType: server.transportType,
                  toolCount: 0,
                  status: 'failed' as const,
                  error: 'Discovery result missing',
                };
              }
              const tools = result.tools ?? [];
              return {
                name: server.name,
                transportType: server.transportType,
                toolCount: result.toolCount ?? tools.length,
                tools: tools.map((t) => ({ name: t.name, description: t.description })),
                status:
                  result.status === 'completed' ? ('completed' as const) : ('failed' as const),
                error: result.error,
                cacheToken: result.cacheToken ?? cacheTokens[server.name],
              };
            });
            setGroupDiscoveryPreview((prev) => ({ ...prev, [template.slug]: updated }));
            const completedCount = updated.filter((r) => r.status === 'completed').length;
            toast({
              title: 'Discovery complete',
              description: `${completedCount}/${template.servers.length} servers discovered`,
            });
            finished = true;
            break;
          }

          if (status.status === 'failed') {
            const updated: DiscoveryPreviewItem[] = template.servers.map((server) => ({
              name: server.name,
              transportType: server.transportType,
              toolCount: 0,
              status: 'failed' as const,
              error: status.error ?? 'Discovery failed',
            }));
            setGroupDiscoveryPreview((prev) => ({ ...prev, [template.slug]: updated }));
            finished = true;
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        if (!finished) {
          const updated: DiscoveryPreviewItem[] = template.servers.map((server) => ({
            name: server.name,
            transportType: server.transportType,
            toolCount: 0,
            status: 'failed' as const,
            error: 'Discovery timed out',
          }));
          setGroupDiscoveryPreview((prev) => ({ ...prev, [template.slug]: updated }));
        }
      } catch (err: unknown) {
        toast({
          title: 'Discovery failed',
          description: err instanceof Error ? err.message : 'Failed to discover servers',
          variant: 'destructive',
        });
      } finally {
        setDiscoveringGroups((prev) => {
          const next = new Set(prev);
          next.delete(template.slug);
          return next;
        });
      }
    },
    [discoveringGroups, toast],
  );

  const handleImportDiscoveredTemplate = useCallback(
    async (template: McpGroupTemplateResponse) => {
      const preview = groupDiscoveryPreview[template.slug];
      if (!preview) {
        toast({
          title: 'No discovery data',
          description: 'Please run "Test & Discover" first',
          variant: 'destructive',
        });
        return;
      }

      if (importingTemplates.has(template.slug)) return;

      setImportingTemplates((prev) => new Set(prev).add(template.slug));
      try {
        const serverCacheTokens: Record<string, string> = {};
        for (const result of preview) {
          if (result.status === 'completed' && result.cacheToken) {
            serverCacheTokens[result.name] = result.cacheToken;
          }
        }

        if (Object.keys(serverCacheTokens).length === 0) {
          toast({
            title: 'No servers discovered',
            description: 'At least one server must be successfully discovered',
            variant: 'destructive',
          });
          return;
        }

        const result = await mcpGroupsApi.importTemplate(template.slug, serverCacheTokens);
        await queryClient.invalidateQueries({ queryKey: queryKeys.mcpGroups.all() });
        await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });

        toast({
          title: 'Group imported',
          description: `Imported ${result.group.name} with ${Object.keys(serverCacheTokens).length} server(s)`,
        });

        setGroupDiscoveryPreview((prev) => {
          const { [template.slug]: _, ...rest } = prev;
          return rest;
        });
      } catch (err: unknown) {
        toast({
          title: 'Import failed',
          description: err instanceof Error ? err.message : 'Failed to import group',
          variant: 'destructive',
        });
      } finally {
        setImportingTemplates((prev) => {
          const next = new Set(prev);
          next.delete(template.slug);
          return next;
        });
      }
    },
    [groupDiscoveryPreview, importingTemplates, queryClient, toast],
  );

  const handleRemoveGroup = useCallback(
    async (groupId: string, groupName: string) => {
      const ok = await confirm({
        title: 'Remove group',
        description: `Remove ${groupName}? This will delete the group.`,
        confirmLabel: 'Remove',
      });
      if (!ok) return;

      try {
        await mcpGroupsApi.deleteGroup(groupId);
        toast({ title: 'Group removed', description: `${groupName} was removed.` });
        await queryClient.invalidateQueries({ queryKey: queryKeys.mcpGroups.all() });
      } catch (err: unknown) {
        toast({
          title: 'Remove failed',
          description: err instanceof Error ? err.message : 'Failed to remove group',
          variant: 'destructive',
        });
      }
    },
    [confirm, queryClient, toast],
  );

  return {
    importingTemplates,
    templatesOpen,
    groupDiscoveryPreview,
    discoveringGroups,
    toggleTemplates,
    refreshTemplates,
    clearGroupDiscoveryPreview,
    handleGroupTestAndDiscover,
    handleImportDiscoveredTemplate,
    handleRemoveGroup,
  };
}
