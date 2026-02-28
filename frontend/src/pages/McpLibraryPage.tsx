import { useEffect, useMemo, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Plus, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useMcpServers,
  useMcpAllTools,
  useDeleteMcpServer,
  useToggleMcpServer,
  useTestMcpConnection,
  useFetchServerTools,
  useToggleMcpTool,
  useDiscoverMcpTools,
} from '@/hooks/queries/useMcpServerQueries';
import { useMcpGroupsWithServers, useMcpGroupTemplates } from '@/hooks/queries/useMcpGroupQueries';
import { queryKeys } from '@/lib/queryKeys';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { McpGroupServerResponse } from '@/services/mcpGroupsApi';
import type { McpHealthStatus } from '@shipsec/shared';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  GroupTemplatesSection,
  ImportedGroupsSection,
  CustomServersTable,
  ServerEditorSheet,
  DeleteServerDialog,
  ToolsDialog,
  useEditorActions,
  useJsonImport,
  useGroupActions,
  parseClaudeCodeConfig,
  type TransportType,
} from './mcp-library';

export function McpLibraryPage() {
  useDocumentTitle('MCP Library');
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const queryClient = useQueryClient();

  // ------ Data queries ------
  const { data: servers = [], isLoading, error: serversError } = useMcpServers();
  const { data: tools = [] } = useMcpAllTools();
  const { data: groups = [] } = useMcpGroupsWithServers();
  const { data: groupTemplates = [], isLoading: isLoadingTemplates } = useMcpGroupTemplates();
  const error = serversError?.message ?? null;

  // ------ Local state ------
  const [searchQuery, setSearchQuery] = useState('');
  const [checkingServers, setCheckingServers] = useState<Set<string>>(new Set());
  const [discoveringServerIds, setDiscoveringServerIds] = useState<Set<string>>(new Set());
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false);
  const [selectedServerForTools, setSelectedServerForTools] = useState<string | null>(null);

  // ------ Mutations (kept in main because handlers are local) ------
  const deleteServerMutation = useDeleteMcpServer();
  const toggleServerMutation = useToggleMcpServer();
  const testConnectionMutation = useTestMcpConnection();
  const fetchServerToolsMutation = useFetchServerTools();
  const toggleToolMutation = useToggleMcpTool();
  const discoverToolsMutation = useDiscoverMcpTools();

  // ------ Extracted hooks ------
  const editor = useEditorActions({ servers, setCheckingServers });
  const jsonImport = useJsonImport({
    editingServer: editor.editingServer,
    formData: editor.formData,
    setEditorOpen: editor.setEditorOpen,
    setEditingServer: editor.setEditingServer,
    setFormData: editor.setFormData,
    setCheckingServers,
    setDiscoveringServerIds,
  });
  const groupActions = useGroupActions({ groupCount: groups.length, confirm });

  // ------ Cross-hook effect: sync JSON → Manual form ------
  useEffect(() => {
    if (!jsonImport.jsonValue.trim() || editor.editingServer) return;
    const { servers: parsedServers, error: parseError } = parseClaudeCodeConfig(
      jsonImport.jsonValue,
    );
    if (parseError || parsedServers.length !== 1) return;
    const parsedConfig = parsedServers[0].config;
    if (editor.activeTab === 'json' && parsedConfig.name !== editor.formData.name) {
      editor.setFormData(parsedConfig);
    }
  }, [jsonImport.jsonValue, editor.activeTab, editor.editingServer, editor.formData.name]);

  // ------ Memoized lookups ------
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

  // ------ Helper functions ------
  const getGroupServerHealthStatus = (server: {
    serverId: string;
    healthStatus: McpHealthStatus;
  }) => servers.find((s) => s.id === server.serverId)?.lastHealthStatus ?? server.healthStatus;

  const getGroupServerToolCounts = (server: { serverId: string; toolCount: number }) => {
    const counts = toolCountsByServer[server.serverId];
    if (counts && !(counts.total === 0 && server.toolCount > 0)) return counts;
    const fallbackTotal = server.toolCount;
    return fallbackTotal > 0 ? { enabled: fallbackTotal, total: fallbackTotal } : null;
  };

  const getServerDiscoveryImage = (serverId: string) => {
    const server = servers.find((s) => s.id === serverId);
    if (!server?.groupId) return undefined;
    const group = groups.find((g) => g.id === server.groupId);
    return group?.defaultDockerImage ?? undefined;
  };

  // ------ Handlers ------
  const handleDelete = async () => {
    if (!serverToDelete) return;
    setIsDeleting(true);
    try {
      await deleteServerMutation.mutateAsync(serverToDelete);
      toast({ title: 'Server deleted', description: 'MCP server has been removed.' });
      setDeleteDialogOpen(false);
      setServerToDelete(null);
    } catch (err: unknown) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to delete server',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggle = async (serverId: string) => {
    try {
      const server = await toggleServerMutation.mutateAsync(serverId);
      toast({
        title: server.enabled ? 'Server enabled' : 'Server disabled',
        description: `${server.name} has been ${server.enabled ? 'enabled' : 'disabled'}.`,
      });
    } catch (err: unknown) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to toggle server',
        variant: 'destructive',
      });
    }
  };

  const handleTestConnection = async (serverId: string) => {
    setTestingServer(serverId);
    try {
      const result = await testConnectionMutation.mutateAsync(serverId);
      toast({
        title: result.success ? 'Connection successful' : 'Connection failed',
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
      });
    } catch (err: unknown) {
      toast({
        title: 'Test failed',
        description: err instanceof Error ? err.message : 'Connection test failed',
        variant: 'destructive',
      });
    } finally {
      setTestingServer(null);
    }
  };

  const handleViewTools = async (serverId: string) => {
    setSelectedServerForTools(serverId);
    setToolsDialogOpen(true);
    await fetchServerToolsMutation.mutateAsync(serverId);
  };

  const handleDiscoverServerTools = async (serverId: string, image?: string) => {
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
    } catch (err: unknown) {
      toast({
        title: 'Discovery failed',
        description: err instanceof Error ? err.message : 'Failed to discover tools',
        variant: 'destructive',
      });
    } finally {
      setDiscoveringServerIds((prev) => {
        const next = new Set(prev);
        next.delete(serverId);
        return next;
      });
    }
  };

  const handleToggleTool = async (serverId: string, toolId: string) => {
    try {
      const tool = await toggleToolMutation.mutateAsync({ serverId, toolId });
      toast({
        title: tool.enabled ? 'Tool enabled' : 'Tool disabled',
        description: `${tool.toolName} has been ${tool.enabled ? 'enabled' : 'disabled'}.`,
      });
    } catch (err: unknown) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to toggle tool',
        variant: 'destructive',
      });
    }
  };

  // ------ Main render ------
  return (
    <div className="container mx-auto py-8 px-4">
      {/* Header actions */}
      <div className="flex items-center justify-end mb-6">
        <Button onClick={editor.handleCreateNew}>
          <Plus className="h-4 w-4 mr-2" />
          Add Server
        </Button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search servers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh MCP servers"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
            queryClient.invalidateQueries({ queryKey: queryKeys.mcpGroups.all() });
            void groupActions.refreshTemplates();
          }}
          disabled={isLoading}
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </Button>
      </div>

      {error && (
        <ErrorBanner
          message={error}
          onRetry={() => queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() })}
          className="mb-6"
        />
      )}

      {/* Group Templates */}
      <GroupTemplatesSection
        templates={filteredTemplates}
        isLoading={isLoadingTemplates}
        searchQuery={searchQuery}
        templatesOpen={groupActions.templatesOpen}
        onToggleTemplates={groupActions.toggleTemplates}
        importedGroupSlugs={importedGroupSlugs}
        groupDiscoveryPreview={groupActions.groupDiscoveryPreview}
        discoveringGroups={groupActions.discoveringGroups}
        importingTemplates={groupActions.importingTemplates}
        onTestAndDiscover={groupActions.handleGroupTestAndDiscover}
        onImportDiscovered={groupActions.handleImportDiscoveredTemplate}
        onClearDiscoveryPreview={groupActions.clearGroupDiscoveryPreview}
      />

      {/* Imported Groups */}
      <ImportedGroupsSection
        groups={filteredGroups}
        isLoading={isLoading}
        searchQuery={searchQuery}
        checkingServers={checkingServers}
        discoveringServerIds={discoveringServerIds}
        getGroupServers={getGroupServers}
        getGroupServerHealthStatus={getGroupServerHealthStatus}
        getGroupServerToolCounts={getGroupServerToolCounts}
        onToggle={handleToggle}
        onViewTools={handleViewTools}
        onDiscoverTools={(serverId) =>
          handleDiscoverServerTools(serverId, getServerDiscoveryImage(serverId))
        }
        onRemoveGroup={groupActions.handleRemoveGroup}
      />

      {/* Custom Servers */}
      <CustomServersTable
        servers={filteredCustomServers}
        isLoading={isLoading}
        searchQuery={searchQuery}
        checkingServers={checkingServers}
        testingServer={testingServer}
        toolCountsByServer={toolCountsByServer}
        onCreateNew={editor.handleCreateNew}
        onToggle={handleToggle}
        onViewTools={handleViewTools}
        onTestConnection={handleTestConnection}
        onEdit={editor.handleEdit}
        onDelete={(serverId) => {
          setServerToDelete(serverId);
          setDeleteDialogOpen(true);
        }}
      />

      {/* Editor Sheet */}
      <ServerEditorSheet
        open={editor.editorOpen}
        onOpenChange={editor.handleEditorClose}
        editingServer={editor.editingServer}
        formData={editor.formData}
        onFormDataChange={editor.setFormData}
        activeTab={editor.activeTab}
        onActiveTabChange={editor.setActiveTab}
        isSaving={editor.isSaving}
        isImporting={jsonImport.isImporting}
        headerEntries={editor.headerEntries}
        secretPickerEntryIndex={editor.secretPickerEntryIndex}
        onSecretPickerEntryIndexChange={editor.setSecretPickerEntryIndex}
        onAddHeader={editor.addHeaderEntry}
        onUpdateHeader={editor.updateHeaderEntry}
        onRemoveHeader={editor.removeHeaderEntry}
        discoveryStatus={editor.discoveryStatus}
        onTestAndDiscover={editor.handleTestAndDiscover}
        onSave={editor.handleSave}
        jsonValue={jsonImport.jsonValue}
        onJsonValueChange={jsonImport.setJsonValue}
        jsonParseError={jsonImport.jsonParseError}
        onJsonParseErrorChange={jsonImport.setJsonParseError}
        isTestingDiscovery={jsonImport.isTestingDiscovery}
        discoveryPreview={jsonImport.discoveryPreview}
        onClearDiscoveryPreview={() => jsonImport.setDiscoveryPreview(null)}
        onJsonTestAndDiscover={jsonImport.handleJsonTestAndDiscover}
        onJsonSave={jsonImport.handleJsonSave}
      />

      {/* Delete Confirmation */}
      <DeleteServerDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        isDeleting={isDeleting}
        onDelete={handleDelete}
      />

      {/* Tools Dialog */}
      <ToolsDialog
        open={toolsDialogOpen}
        onOpenChange={setToolsDialogOpen}
        serverName={selectedServer?.name ?? 'Unknown'}
        tools={serverTools}
        selectedServerForTools={selectedServerForTools}
        discoveringServerIds={discoveringServerIds}
        onToggleTool={handleToggleTool}
        onDiscoverTools={handleDiscoverServerTools}
      />

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

export default McpLibraryPage;
