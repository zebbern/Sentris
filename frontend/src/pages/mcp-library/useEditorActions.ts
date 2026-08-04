import { useState, useCallback, useEffect } from 'react';
import { useToast } from '@/components/ui/use-toast';
import {
  useCreateMcpServer,
  useUpdateMcpServer,
  useTestMcpConnection,
  type McpServerResponse,
} from '@/hooks/queries/useMcpServerQueries';
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

  // Mutations
  const createServerMutation = useCreateMcpServer();
  const updateServerMutation = useUpdateMcpServer();
  const testConnectionMutation = useTestMcpConnection();

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

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setDiscoveryStatus({ status: 'running' });
    let serverId = editingServer;
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
        enabled: formData.enabled,
      };

      if (serverId) {
        await updateServerMutation.mutateAsync({ id: serverId, input: payload });
      } else {
        const newServer = await createServerMutation.mutateAsync(payload);
        serverId = newServer.id;
        setEditingServer(newServer.id);
      }

      const persistedServerId = serverId;
      if (!persistedServerId) throw new Error('MCP server persistence returned no server ID');
      setCheckingServers((prev) => new Set(prev).add(persistedServerId));
      const result = await testConnectionMutation.mutateAsync(persistedServerId);
      if (!result.success) {
        setDiscoveryStatus({ status: 'failed', error: result.message });
        toast({
          title: 'Server saved, discovery failed',
          description: 'The configuration remains editable so you can correct and retry it.',
          variant: 'destructive',
        });
        return;
      }

      toast({ title: 'Server ready', description: result.message });
      setEditorOpen(false);
      setEditingServer(null);
      setFormData(INITIAL_FORM_DATA);
      setDiscoveryStatus(null);
    } catch (error: unknown) {
      setDiscoveryStatus({
        status: 'failed',
        error: error instanceof Error ? error.message : 'Failed to save and discover server',
      });
      // Global MutationCache error handler shows the toast
    } finally {
      const completedServerId = serverId;
      if (completedServerId) {
        setCheckingServers((prev) => {
          const next = new Set(prev);
          next.delete(completedServerId);
          return next;
        });
      }
      setIsSaving(false);
    }
  }, [
    formData,
    editingServer,
    headerEntries,
    createServerMutation,
    updateServerMutation,
    testConnectionMutation,
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
    handleSave,
    formDataToJson,
  };
}
