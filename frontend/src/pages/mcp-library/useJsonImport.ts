import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import {
  useCreateMcpServer,
  useUpdateMcpServer,
  useDiscoverMcpTools,
} from '@/hooks/queries/useMcpServerQueries';
import { queryKeys } from '@/lib/queryKeys';
import { mcpDiscoveryApi } from '@/services/mcpDiscoveryApi';
import type { CreateMcpServer } from '@sentris/shared';
import type { ServerFormData, DiscoveryPreviewItem, DiscoveryCacheEntry } from './types';
import { INITIAL_FORM_DATA } from './types';
import { parseClaudeCodeConfig } from './utils';

interface UseJsonImportOptions {
  editingServer: string | null;
  formData: ServerFormData;
  setEditorOpen: (open: boolean) => void;
  setEditingServer: (id: string | null) => void;
  setFormData: (data: ServerFormData) => void;
  setCheckingServers: React.Dispatch<React.SetStateAction<Set<string>>>;
  setDiscoveringServerIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useJsonImport({
  editingServer,
  formData,
  setEditorOpen,
  setEditingServer,
  setFormData,
  setCheckingServers,
  setDiscoveringServerIds,
}: UseJsonImportOptions) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [jsonValue, setJsonValue] = useState('');
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isTestingDiscovery, setIsTestingDiscovery] = useState(false);
  const [discoveryPreview, setDiscoveryPreview] = useState<DiscoveryPreviewItem[] | null>(null);
  const [discoveryCacheTokens, setDiscoveryCacheTokens] = useState<
    Map<string, DiscoveryCacheEntry>
  >(new Map());

  const createServerMutation = useCreateMcpServer();
  const updateServerMutation = useUpdateMcpServer();
  const discoverToolsMutation = useDiscoverMcpTools();

  const handleJsonTestAndDiscover = useCallback(async () => {
    const { servers: parsedServers, error } = parseClaudeCodeConfig(jsonValue);
    if (error) {
      setJsonParseError(error);
      return;
    }
    if (parsedServers.length === 0) {
      setJsonParseError('No servers found in config');
      return;
    }

    setIsTestingDiscovery(true);
    setJsonParseError(null);

    const initialResults: DiscoveryPreviewItem[] = parsedServers.map(({ config }) => ({
      name: config.name.trim(),
      transportType: config.transportType as 'http' | 'stdio',
      toolCount: 0,
      status: 'pending' as const,
    }));
    setDiscoveryPreview(initialResults);

    try {
      const results = [...initialResults];

      for (let i = 0; i < parsedServers.length; i++) {
        const { config } = parsedServers[i];
        results[i] = { ...results[i], status: 'discovering' };
        setDiscoveryPreview([...results]);

        try {
          const endpoint =
            config.transportType === 'http' ? config.endpoint.trim() || undefined : undefined;
          const command =
            config.transportType === 'stdio' ? config.command.trim() || undefined : undefined;
          const args =
            config.transportType === 'stdio' && config.args.trim()
              ? config.args
                  .split('\n')
                  .map((a) => a.trim())
                  .filter(Boolean)
              : undefined;

          const { workflowId, cacheToken } = await mcpDiscoveryApi.discover({
            transport: config.transportType,
            name: config.name.trim(),
            endpoint,
            command,
            args,
          });

          const maxAttempts = 60;
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const status = await mcpDiscoveryApi.getStatus(workflowId);

            if (status.status === 'completed') {
              results[i] = {
                ...results[i],
                toolCount: status.toolCount ?? 0,
                tools: status.tools?.map((t) => ({
                  name: t.name,
                  description: t.description,
                })),
                status: 'completed',
                cacheToken,
              };
              if (cacheToken && status.tools && status.tools.length > 0) {
                setDiscoveryCacheTokens((prev) =>
                  new Map(prev).set(config.name.trim(), {
                    cacheToken,
                    tools: status.tools!.map((t) => ({
                      name: t.name,
                      description: t.description,
                      inputSchema: t.inputSchema,
                    })),
                  }),
                );
              }
              setDiscoveryPreview([...results]);
              break;
            }
            if (status.status === 'failed') {
              results[i] = {
                ...results[i],
                error: status.error ?? 'Discovery failed',
                status: 'failed',
              };
              setDiscoveryPreview([...results]);
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (err: unknown) {
          results[i] = {
            ...results[i],
            error: err instanceof Error ? err.message : 'Unknown error',
            status: 'failed',
          };
          setDiscoveryPreview([...results]);
        }
      }
    } finally {
      setIsTestingDiscovery(false);
    }
  }, [jsonValue]);

  const handleJsonSave = useCallback(async () => {
    const { servers: parsedServers, error } = parseClaudeCodeConfig(jsonValue);
    if (error) {
      setJsonParseError(error);
      return;
    }
    if (parsedServers.length === 0) {
      setJsonParseError('No servers found in config');
      return;
    }

    // Edit mode: update a single server from JSON
    if (editingServer) {
      const firstServer = parsedServers[0].config;
      try {
        const endpoint =
          firstServer.transportType === 'http'
            ? firstServer.endpoint.trim() || undefined
            : undefined;
        const command =
          firstServer.transportType === 'stdio'
            ? firstServer.command.trim() || undefined
            : undefined;
        const args =
          firstServer.transportType === 'stdio' && firstServer.args.trim()
            ? firstServer.args
                .split('\n')
                .map((a) => a.trim())
                .filter(Boolean)
            : undefined;

        const payload: CreateMcpServer = {
          name: formData.name.trim(),
          description: firstServer.description.trim() || undefined,
          transportType: firstServer.transportType,
          endpoint,
          command,
          args,
          headers: firstServer.headers.trim() ? JSON.parse(firstServer.headers) : undefined,
          enabled: formData.enabled,
        };
        await updateServerMutation.mutateAsync({ id: editingServer, input: payload });
        toast({
          title: 'Server updated',
          description: `${payload.name} has been updated.`,
        });
        setEditorOpen(false);
        setEditingServer(null);
        setFormData(INITIAL_FORM_DATA);
      } catch {
        // Global MutationCache error handler shows the toast
      }
      return;
    }

    // Create mode: batch import from JSON
    setIsImporting(true);
    setJsonParseError(null);

    try {
      const results = await Promise.allSettled(
        parsedServers.map(({ config }) => {
          const cached = discoveryCacheTokens.get(config.name.trim());
          const endpoint =
            config.transportType === 'http' ? config.endpoint.trim() || undefined : undefined;
          const command =
            config.transportType === 'stdio' ? config.command.trim() || undefined : undefined;
          const args =
            config.transportType === 'stdio' && config.args.trim()
              ? config.args
                  .split('\n')
                  .map((a) => a.trim())
                  .filter(Boolean)
              : undefined;

          const payload: CreateMcpServer = {
            name: config.name.trim(),
            description: config.description.trim() || undefined,
            transportType: config.transportType,
            endpoint,
            command,
            args,
            headers: config.headers.trim() ? JSON.parse(config.headers) : undefined,
            enabled: true,
            cacheToken: cached?.cacheToken,
          };
          return createServerMutation.mutateAsync(payload);
        }),
      );

      type ServerResponse = Awaited<ReturnType<typeof createServerMutation.mutateAsync>>;
      const created = results
        .filter((r): r is PromiseFulfilledResult<ServerResponse> => r.status === 'fulfilled')
        .map((r) => r.value);
      const failed = results.filter((r) => r.status === 'rejected');

      if (created.length > 0) {
        setCheckingServers(new Set(created.map((s) => s.id)));
        const toDiscover = created.filter((s) => !discoveryCacheTokens.has(s.name));

        if (toDiscover.length > 0) {
          setDiscoveringServerIds(new Set(toDiscover.map((s) => s.id)));
          Promise.allSettled(
            toDiscover.map((server) =>
              discoverToolsMutation
                .mutateAsync({ serverId: server.id, servers: created })
                .catch(() => {}),
            ),
          )
            .then(async () => {
              await queryClient.invalidateQueries({
                queryKey: queryKeys.mcpServers.tools(),
              });
              await queryClient.invalidateQueries({
                queryKey: queryKeys.mcpServers.all(),
              });
            })
            .finally(() => {
              setDiscoveringServerIds((prev) => {
                const next = new Set(prev);
                toDiscover.forEach((s) => next.delete(s.id));
                return next;
              });
            });
        }

        if (toDiscover.length < created.length) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.mcpServers.tools(),
          });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.mcpServers.all(),
          });
          setCheckingServers((prev) => {
            const next = new Set(prev);
            created.forEach((s) => next.delete(s.id));
            return next;
          });
        }
      }

      if (failed.length > 0) {
        toast({
          title:
            created.length > 0
              ? `Partial import: ${created.length} succeeded, ${failed.length} failed`
              : `Import failed`,
          variant: created.length > 0 ? 'default' : 'destructive',
        });
      } else {
        toast({
          title: 'Import successful',
          description: `Created ${created.length} MCP server(s)`,
        });
      }

      setEditorOpen(false);
      setJsonValue('');
    } catch {
      // Global MutationCache error handler shows the toast
    } finally {
      setIsImporting(false);
    }
  }, [
    jsonValue,
    editingServer,
    formData,
    discoveryCacheTokens,
    createServerMutation,
    updateServerMutation,
    discoverToolsMutation,
    queryClient,
    toast,
    setCheckingServers,
    setDiscoveringServerIds,
    setEditorOpen,
    setEditingServer,
    setFormData,
  ]);

  return {
    jsonValue,
    setJsonValue,
    jsonParseError,
    setJsonParseError,
    isImporting,
    isTestingDiscovery,
    discoveryPreview,
    setDiscoveryPreview,
    handleJsonTestAndDiscover,
    handleJsonSave,
  };
}
