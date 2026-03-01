import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import {
  useCreateMcpServer,
  useUpdateMcpServer,
  useTestMcpConnection,
  type McpServerResponse,
} from '@/hooks/queries/useMcpServerQueries';
import { queryKeys } from '@/lib/queryKeys';
import { mcpDiscoveryApi } from '@/services/mcpDiscoveryApi';
import type { CreateMcpServer } from '@sentris/shared';
import type { ServerFormData, HeaderEntry, DiscoveryStatusState } from './types';
import { INITIAL_FORM_DATA } from './types';
import { formDataToJson as utilFormDataToJson, buildHeadersPayload } from './utils';

interface UseEditorActionsOptions {
  servers: McpServerResponse[];
  setCheckingServers: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useEditorActions({ servers, setCheckingServers }: UseEditorActionsOptions) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [formData, setFormData] = useState<ServerFormData>(INITIAL_FORM_DATA);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'manual' | 'json'>('manual');

  // Header entries
  const [headerEntries, setHeaderEntries] = useState<HeaderEntry[]>([]);
  const [secretPickerEntryIndex, setSecretPickerEntryIndex] = useState<number | null>(null);

  // Manual tab discovery
  const [discoveryStatus, setDiscoveryStatus] = useState<DiscoveryStatusState | null>(null);

  // Poll interval ref for cleanup on unmount
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mutations
  const createServerMutation = useCreateMcpServer();
  const updateServerMutation = useUpdateMcpServer();
  const testConnectionMutation = useTestMcpConnection();

  // Cleanup poll interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  // Populate header entries when editing a server
  useEffect(() => {
    if (!editingServer) return;
    const server = servers.find((s) => s.id === editingServer);
    if (server?.headerKeys && server.headerKeys.length > 0) {
      setHeaderEntries(server.headerKeys.map((key: string) => ({ key, value: '' })));
    } else {
      setHeaderEntries([]);
    }
  }, [editingServer, servers]);

  const addHeaderEntry = useCallback(() => {
    setHeaderEntries((prev) => [...prev, { key: '', value: '' }]);
  }, []);

  const updateHeaderEntry = useCallback(
    (index: number, field: 'key' | 'value' | 'secretId', value: string) => {
      setHeaderEntries((prev) => {
        const updated = [...prev];
        if (field === 'secretId') {
          updated[index] = { ...updated[index], secretId: value || undefined, value: '' };
        } else {
          updated[index] = { ...updated[index], [field]: value, secretId: undefined };
        }
        return updated;
      });
    },
    [],
  );

  const removeHeaderEntry = useCallback((index: number) => {
    setHeaderEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const formDataToJson = useCallback(
    (data: ServerFormData, serverHeaderKeys?: string[] | null): string => {
      return utilFormDataToJson(data, headerEntries, serverHeaderKeys);
    },
    [headerEntries],
  );

  const handleCreateNew = useCallback(() => {
    setEditingServer(null);
    setFormData(INITIAL_FORM_DATA);
    setDiscoveryStatus(null);
    setActiveTab('manual');
    setEditorOpen(true);
  }, []);

  const handleEditorClose = useCallback((open: boolean) => {
    if (!open) {
      setDiscoveryStatus(null);
    }
    setEditorOpen(open);
  }, []);

  const handleEdit = useCallback(
    (serverId: string) => {
      const server = servers.find((s) => s.id === serverId);
      if (!server) return;

      setEditingServer(serverId);
      setDiscoveryStatus(null);
      const editFormData: ServerFormData = {
        name: server.name,
        description: server.description ?? '',
        transportType: server.transportType,
        endpoint: server.endpoint ?? '',
        command: server.command ?? '',
        args: server.args?.join('\n') ?? '',
        headers: '',
        healthCheckUrl: '',
        enabled: server.enabled,
      };
      setFormData(editFormData);
      setActiveTab('manual');
      setEditorOpen(true);
      return { editFormData, serverHeaderKeys: server.headerKeys };
    },
    [servers],
  );

  const handleTestAndDiscover = useCallback(async () => {
    const headersPayload = buildHeadersPayload(headerEntries);

    const input = {
      transport: formData.transportType,
      name: formData.name.trim(),
      endpoint: formData.transportType === 'http' ? formData.endpoint.trim() : undefined,
      headers: headersPayload,
      command: formData.transportType === 'stdio' ? formData.command.trim() : undefined,
      args:
        formData.transportType === 'stdio' && formData.args.trim()
          ? formData.args
              .split('\n')
              .map((a) => a.trim())
              .filter(Boolean)
          : undefined,
    };

    try {
      const { workflowId } = await mcpDiscoveryApi.discover(input);
      setDiscoveryStatus({ workflowId, status: 'running' });

      // Clear any existing poll interval before starting a new one
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      pollIntervalRef.current = setInterval(async () => {
        try {
          const result = await mcpDiscoveryApi.getStatus(workflowId);
          if (result.status === 'completed') {
            clearInterval(pollIntervalRef.current!);
            pollIntervalRef.current = null;
            setDiscoveryStatus({
              status: 'completed',
              tools: result.tools,
              toolCount: result.toolCount,
            });
          } else if (result.status === 'failed') {
            clearInterval(pollIntervalRef.current!);
            pollIntervalRef.current = null;
            setDiscoveryStatus({ status: 'failed', error: result.error });
          }
        } catch (error: unknown) {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          setDiscoveryStatus({
            status: 'failed',
            error: error instanceof Error ? error.message : 'Discovery failed',
          });
        }
      }, 2000);
    } catch (error: unknown) {
      setDiscoveryStatus({
        status: 'failed',
        error: error instanceof Error ? error.message : 'Failed to start discovery',
      });
    }
  }, [formData, headerEntries]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const headersPayload = buildHeadersPayload(headerEntries);

      const payload: CreateMcpServer = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        transportType: formData.transportType,
        endpoint: formData.transportType === 'http' ? formData.endpoint.trim() : undefined,
        command: formData.transportType === 'stdio' ? formData.command.trim() : undefined,
        args:
          formData.transportType === 'stdio' && formData.args.trim()
            ? formData.args
                .split('\n')
                .map((a) => a.trim())
                .filter(Boolean)
            : undefined,
        headers: headersPayload,
        enabled: true,
      };

      if (editingServer) {
        setCheckingServers((prev) => new Set([...prev, editingServer]));
        await updateServerMutation.mutateAsync({ id: editingServer, input: payload });
        testConnectionMutation
          .mutateAsync(editingServer)
          .then(async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
            await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
          })
          .catch(() => {
            toast({
              title: 'Connection test failed',
              description: 'Server updated, but the connection test did not succeed.',
              variant: 'destructive',
            });
          })
          .finally(() => {
            setCheckingServers((prev) => {
              const next = new Set(prev);
              next.delete(editingServer);
              return next;
            });
          });
        toast({ title: 'Server updated', description: `${payload.name} has been updated.` });
      } else {
        const newServer = await createServerMutation.mutateAsync(payload);
        setCheckingServers((prev) => new Set([...prev, newServer.id]));
        testConnectionMutation
          .mutateAsync(newServer.id)
          .then(async (result) => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
            await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
            if (result.toolCount !== undefined && result.toolCount > 0) {
              toast({
                title: 'Server ready',
                description: `Discovered ${result.toolCount} tool(s) from ${payload.name}.`,
              });
            }
          })
          .catch(() => {
            toast({
              title: 'Connection test failed',
              description: 'Server created, but the connection test did not succeed.',
              variant: 'destructive',
            });
          })
          .finally(() => {
            setCheckingServers((prev) => {
              const next = new Set(prev);
              next.delete(newServer.id);
              return next;
            });
          });
        toast({ title: 'Server created', description: `${payload.name} has been added.` });
      }

      setEditorOpen(false);
      setEditingServer(null);
      setFormData(INITIAL_FORM_DATA);
      setDiscoveryStatus(null);
    } catch (err: unknown) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save server',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    formData,
    editingServer,
    headerEntries,
    createServerMutation,
    updateServerMutation,
    testConnectionMutation,
    queryClient,
    toast,
    setCheckingServers,
  ]);

  return {
    editorOpen,
    editingServer,
    formData,
    setFormData,
    isSaving,
    activeTab,
    setActiveTab,
    headerEntries,
    setHeaderEntries,
    secretPickerEntryIndex,
    setSecretPickerEntryIndex,
    discoveryStatus,
    addHeaderEntry,
    updateHeaderEntry,
    removeHeaderEntry,
    setEditorOpen,
    setEditingServer,
    handleCreateNew,
    handleEditorClose,
    handleEdit,
    handleTestAndDiscover,
    handleSave,
    formDataToJson,
  };
}
