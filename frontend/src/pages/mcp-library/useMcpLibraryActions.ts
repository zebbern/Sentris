import { useState, useCallback } from 'react';
import { useToast } from '@/components/ui/use-toast';
import {
  useDeleteMcpServer,
  useToggleMcpServer,
  useTestMcpConnection,
  useFetchServerTools,
  useToggleMcpTool,
  useDiscoverMcpTools,
  type McpServerResponse,
} from '@/hooks/queries/useMcpServerQueries';
import { humanizeApiError } from '@/lib/humanizeApiError';

interface UseMcpLibraryActionsOptions {
  servers: McpServerResponse[];
}

export function useMcpLibraryActions({ servers }: UseMcpLibraryActionsOptions) {
  const { toast } = useToast();

  // ------ Local state ------
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [discoveringServerIds, setDiscoveringServerIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false);
  const [selectedServerForTools, setSelectedServerForTools] = useState<string | null>(null);

  // ------ Mutations ------
  const deleteServerMutation = useDeleteMcpServer();
  const toggleServerMutation = useToggleMcpServer();
  const testConnectionMutation = useTestMcpConnection();
  const fetchServerToolsMutation = useFetchServerTools();
  const toggleToolMutation = useToggleMcpTool();
  const discoverToolsMutation = useDiscoverMcpTools();

  // ------ Handlers ------
  const handleDelete = useCallback(async () => {
    if (!serverToDelete) return;
    setIsDeleting(true);
    try {
      await deleteServerMutation.mutateAsync(serverToDelete);
      toast({ title: 'Server deleted', description: 'MCP server has been removed.' });
      setDeleteDialogOpen(false);
      setServerToDelete(null);
    } catch {
      // Global MutationCache error handler shows the toast
    } finally {
      setIsDeleting(false);
    }
  }, [serverToDelete, deleteServerMutation, toast]);

  const handleToggle = useCallback(
    async (serverId: string) => {
      try {
        const server = await toggleServerMutation.mutateAsync(serverId);
        toast({
          title: server.enabled ? 'Server enabled' : 'Server disabled',
          description: `${server.name} has been ${server.enabled ? 'enabled' : 'disabled'}.`,
        });
      } catch {
        // Global MutationCache error handler shows the toast
      }
    },
    [toggleServerMutation, toast],
  );

  const handleTestConnection = useCallback(
    async (serverId: string) => {
      setTestingServer(serverId);
      try {
        const result = await testConnectionMutation.mutateAsync(serverId);
        toast({
          title: result.success ? 'Connection successful' : 'Connection failed',
          description: result.message,
          variant: result.success ? 'default' : 'destructive',
        });
      } catch {
        // Global MutationCache error handler shows the toast
      } finally {
        setTestingServer(null);
      }
    },
    [testConnectionMutation, toast],
  );

  const handleViewTools = useCallback(
    async (serverId: string) => {
      setSelectedServerForTools(serverId);
      setToolsDialogOpen(true);
      await fetchServerToolsMutation.mutateAsync(serverId);
    },
    [fetchServerToolsMutation],
  );

  const handleDiscoverServerTools = useCallback(
    async (serverId: string, image?: string) => {
      if (discoveringServerIds.has(serverId)) return;
      setDiscoveringServerIds((prev) => new Set(prev).add(serverId));
      try {
        const discoveredTools = await discoverToolsMutation.mutateAsync({
          serverId,
          servers,
          image,
        });
        toast({
          title: 'Tool discovery complete',
          description: `Discovered ${discoveredTools.length} tool(s) from this server.`,
        });
      } catch {
        // Global MutationCache error handler shows the toast
      } finally {
        setDiscoveringServerIds((prev) => {
          const next = new Set(prev);
          next.delete(serverId);
          return next;
        });
      }
    },
    [discoveringServerIds, discoverToolsMutation, servers, toast],
  );

  const handleToggleTool = useCallback(
    async (serverId: string, toolId: string) => {
      try {
        const tool = await toggleToolMutation.mutateAsync({ serverId, toolId });
        toast({
          title: tool.enabled ? 'Tool enabled' : 'Tool disabled',
          description: `${tool.toolName} has been ${tool.enabled ? 'enabled' : 'disabled'}.`,
        });
      } catch (err: unknown) {
        toast({
          title: 'Error',
          description: humanizeApiError(err),
          variant: 'destructive',
        });
      }
    },
    [toggleToolMutation, toast],
  );

  const openDeleteDialog = useCallback((serverId: string) => {
    setServerToDelete(serverId);
    setDeleteDialogOpen(true);
  }, []);

  return {
    // State
    testingServer,
    discoveringServerIds,
    setDiscoveringServerIds,
    deleteDialogOpen,
    setDeleteDialogOpen,
    isDeleting,
    toolsDialogOpen,
    setToolsDialogOpen,
    selectedServerForTools,

    // Handlers
    handleDelete,
    handleToggle,
    handleTestConnection,
    handleViewTools,
    handleDiscoverServerTools,
    handleToggleTool,
    openDeleteDialog,
  };
}
