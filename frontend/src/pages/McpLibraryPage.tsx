import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, RefreshCw } from 'lucide-react';
import { PageToolbar } from '@/components/shared/PageToolbar';
import { DOCS_URLS } from '@/config/docs';
import { useQueryClient } from '@tanstack/react-query';
import { useMcpServers, useMcpAllTools } from '@/hooks/queries/useMcpServerQueries';
import { useMcpGroupsWithServers, useMcpGroupTemplates } from '@/hooks/queries/useMcpGroupQueries';
import { queryKeys } from '@/lib/queryKeys';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSortableList } from '@/hooks/useSortableList';
import { useAuthStore } from '@/store/authStore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
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
  useMcpLibraryActions,
  useMcpLibraryData,
  parseClaudeCodeConfig,
} from './mcp-library';

const RegistryCatalogTab = lazy(() =>
  import('./mcp-library/RegistryCatalogTab').then((m) => ({ default: m.RegistryCatalogTab })),
);

export function McpLibraryPage() {
  useDocumentTitle('MCP Library');
  const { confirm, dialogProps } = useConfirmDialog();
  const queryClient = useQueryClient();
  const organizationId = useAuthStore((state) => state.organizationId);

  // ------ Data queries ------
  const { data: servers = [], isLoading, error: serversError } = useMcpServers();
  const { data: tools = [] } = useMcpAllTools();
  const { data: groups = [] } = useMcpGroupsWithServers();
  const { data: groupTemplates = [], isLoading: isLoadingTemplates } = useMcpGroupTemplates();
  const error = serversError?.message ?? null;

  // ------ Local UI state ------
  const [searchQuery, setSearchQuery] = useState('');
  const [checkingServers, setCheckingServers] = useState<Set<string>>(new Set());

  // ------ Extracted hooks ------
  const actions = useMcpLibraryActions({ servers });
  const data = useMcpLibraryData({
    servers,
    tools,
    groups,
    groupTemplates,
    searchQuery,
    selectedServerForTools: actions.selectedServerForTools,
  });
  const editor = useEditorActions({ servers, setCheckingServers });
  const jsonImport = useJsonImport({
    editingServer: editor.editingServer,
    formData: editor.formData,
    setEditorOpen: editor.setEditorOpen,
    setEditingServer: editor.setEditingServer,
    setFormData: editor.setFormData,
    setCheckingServers,
    setDiscoveringServerIds: actions.setDiscoveringServerIds,
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

  // ------ Drag-to-reorder (custom servers only) ------
  const hasActiveFilters = searchQuery.trim().length > 0;
  const getServerId = useCallback((s: { id: string }) => s.id, []);

  const {
    orderedItems: orderedCustomServers,
    sensors,
    collisionDetection,
    handleDragEnd,
    isDragDisabled,
  } = useSortableList({
    items: data.filteredCustomServers,
    getId: getServerId,
    storageKey: `sentris:sort:mcp-custom:${organizationId}`,
    disabled: hasActiveFilters,
  });

  // ------ Main render ------
  return (
    <div
      className="container mx-auto py-4 md:py-8 px-3 md:px-4"
      aria-busy={isLoading || isLoadingTemplates}
    >
      <PageToolbar
        title="MCP Library"
        helpUrl={DOCS_URLS.mcpLibrary}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Filter by server name"
        actions={
          <>
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
            <Button onClick={editor.handleCreateNew}>
              <Plus className="h-4 w-4 mr-2" />
              Add Server
            </Button>
          </>
        }
        className="mb-6"
      />

      <Tabs defaultValue="my-library" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="my-library">My Library</TabsTrigger>
          <TabsTrigger value="docker-registry">Docker Registry</TabsTrigger>
        </TabsList>

        <TabsContent value="my-library">
          {error && (
            <ErrorBanner
              message={error}
              onRetry={() =>
                queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() })
              }
              className="mb-6"
            />
          )}

          {/* Group Templates */}
          <GroupTemplatesSection
            templates={data.filteredTemplates}
            isLoading={isLoadingTemplates}
            searchQuery={searchQuery}
            templatesOpen={groupActions.templatesOpen}
            onToggleTemplates={groupActions.toggleTemplates}
            importedGroupSlugs={data.importedGroupSlugs}
            groupDiscoveryPreview={groupActions.groupDiscoveryPreview}
            discoveringGroups={groupActions.discoveringGroups}
            importingTemplates={groupActions.importingTemplates}
            onTestAndDiscover={groupActions.handleGroupTestAndDiscover}
            onImportDiscovered={groupActions.handleImportDiscoveredTemplate}
            onClearDiscoveryPreview={groupActions.clearGroupDiscoveryPreview}
          />

          {/* Imported Groups */}
          <ImportedGroupsSection
            groups={data.filteredGroups}
            isLoading={isLoading}
            searchQuery={searchQuery}
            checkingServers={checkingServers}
            discoveringServerIds={actions.discoveringServerIds}
            getGroupServers={data.getGroupServers}
            getGroupServerHealthStatus={data.getGroupServerHealthStatus}
            getGroupServerToolCounts={data.getGroupServerToolCounts}
            onToggle={actions.handleToggle}
            onViewTools={actions.handleViewTools}
            onDiscoverTools={(serverId) =>
              actions.handleDiscoverServerTools(serverId, data.getServerDiscoveryImage(serverId))
            }
            onRemoveGroup={groupActions.handleRemoveGroup}
          />

          {/* Custom Servers */}
          <CustomServersTable
            servers={orderedCustomServers}
            isLoading={isLoading}
            searchQuery={searchQuery}
            checkingServers={checkingServers}
            testingServer={actions.testingServer}
            toolCountsByServer={data.toolCountsByServer}
            onCreateNew={editor.handleCreateNew}
            onToggle={actions.handleToggle}
            onViewTools={actions.handleViewTools}
            onTestConnection={actions.handleTestConnection}
            onEdit={editor.handleEdit}
            onDelete={actions.openDeleteDialog}
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragEnd={handleDragEnd}
            isDragDisabled={isDragDisabled}
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
            open={actions.deleteDialogOpen}
            onOpenChange={actions.setDeleteDialogOpen}
            isDeleting={actions.isDeleting}
            onDelete={actions.handleDelete}
          />

          {/* Tools Dialog */}
          <ToolsDialog
            open={actions.toolsDialogOpen}
            onOpenChange={actions.setToolsDialogOpen}
            serverName={data.selectedServer?.name ?? 'Unknown'}
            tools={data.serverTools}
            selectedServerForTools={actions.selectedServerForTools}
            discoveringServerIds={actions.discoveringServerIds}
            onToggleTool={actions.handleToggleTool}
            onDiscoverTools={actions.handleDiscoverServerTools}
          />

          <ConfirmDialog {...dialogProps} />
        </TabsContent>

        <TabsContent value="docker-registry">
          <Suspense
            fallback={
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-[220px] w-full rounded-lg" />
                ))}
              </div>
            }
          >
            <RegistryCatalogTab />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default McpLibraryPage;
