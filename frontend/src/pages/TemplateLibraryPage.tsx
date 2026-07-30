import { useCallback, useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useTemplates,
  useTemplateCategories,
  useTemplateRepoInfo,
  useSyncTemplates,
  type Template,
} from '@/hooks/queries/useTemplateQueries';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { track, Events } from '@/features/analytics/events';
import { UseTemplateModal } from '@/features/templates/UseTemplateModal';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { useSortableList } from '@/hooks/useSortableList';
import { SortableCard, CardDragHandle } from '@/components/ui/sortable-card';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  TemplateCard,
  CardSkeleton,
  TemplateDetailModal,
  TemplateFilters,
  CommunityTemplatesPanel,
  compareTemplatesForActivation,
  isNoSetupTemplate,
  isRecommendedTemplate,
  officialTemplateRepoUrl,
} from './template-library';

type LibraryTab = 'official' | 'community';

function parseLibraryTab(value: string | null): LibraryTab {
  return value === 'community' ? 'community' : 'official';
}

function clearSearchParam(
  searchParams: URLSearchParams,
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  key: string,
) {
  if (!searchParams.has(key)) return;
  const params = new URLSearchParams(searchParams);
  params.delete(key);
  setSearchParams(params, { replace: true });
}

export function TemplateLibraryPage() {
  useDocumentTitle('Template Library');
  const navigate = useNavigate();
  const roles = useAuthStore((state) => state.roles);
  const organizationId = useAuthStore((state) => state.organizationId);
  const canManageWorkflows = hasAdminRole(roles);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<LibraryTab>(() =>
    parseLibraryTab(searchParams.get('tab')),
  );
  const deepLinkTemplateId = searchParams.get('id');
  const [showNoSetupOnly, setShowNoSetupOnly] = useState(
    () => searchParams.get('setup') === 'none',
  );

  useEffect(() => {
    setActiveTab(parseLibraryTab(searchParams.get('tab')));
  }, [searchParams]);

  const filters = useMemo(() => {
    const f: { category?: string; search?: string } = {};
    if (selectedCategory) f.category = selectedCategory;
    if (searchQuery) f.search = searchQuery;
    return Object.keys(f).length > 0 ? f : undefined;
  }, [selectedCategory, searchQuery]);

  const { data: templates = [], isLoading, error, refetch } = useTemplates(filters);
  const visibleTemplates = useMemo(
    () => (showNoSetupOnly ? templates.filter(isNoSetupTemplate) : templates),
    [templates, showNoSetupOnly],
  );
  const activationOrderedTemplates = useMemo(
    () => [...visibleTemplates].sort(compareTemplatesForActivation),
    [visibleTemplates],
  );
  const recommendedTemplateIds = useMemo(
    () =>
      new Set(
        activationOrderedTemplates
          .filter(isRecommendedTemplate)
          .slice(0, 3)
          .map((template) => template.id),
      ),
    [activationOrderedTemplates],
  );
  const { data: categoriesRaw = [] } = useTemplateCategories();
  const { data: repoInfo } = useTemplateRepoInfo();
  const officialRepoUrl = useMemo(() => officialTemplateRepoUrl(repoInfo), [repoInfo]);

  const categories = useMemo<{ category: string; count: number }[]>(
    () =>
      categoriesRaw
        .filter((c): c is { category: string; count: number } => c.category !== null)
        .map((c) => ({ category: c.category, count: c.count })),
    [categoriesRaw],
  );
  const syncMutation = useSyncTemplates();

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [isUseModalOpen, setIsUseModalOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);

  useEffect(() => {
    if (!deepLinkTemplateId || isLoading) return;

    const match = templates.find((template) => template.id === deepLinkTemplateId);
    if (match) {
      setPreviewTemplate(match);
      return;
    }

    if (templates.length > 0) {
      clearSearchParam(searchParams, setSearchParams, 'id');
    }
  }, [deepLinkTemplateId, isLoading, templates, searchParams, setSearchParams]);

  const setLibraryTab = (tab: LibraryTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams);
    if (tab === 'official') params.delete('tab');
    else params.set('tab', tab);
    setSearchParams(params, { replace: true });
  };

  const handleSync = async () => {
    try {
      await syncMutation.mutateAsync();
    } catch {
      // Global MutationCache error handler shows the toast
    }
  };

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category === 'all' ? null : category);
  };

  const clearFilters = () => {
    setSelectedCategory(null);
    setSearchQuery('');
    setShowNoSetupOnly(false);
    const params = new URLSearchParams(searchParams);
    if (params.has('setup')) {
      params.delete('setup');
      setSearchParams(params, { replace: true });
    }
  };

  const toggleNoSetupOnly = () => {
    const next = !showNoSetupOnly;
    setShowNoSetupOnly(next);
    const params = new URLSearchParams(searchParams);
    if (next) params.set('setup', 'none');
    else params.delete('setup');
    setSearchParams(params, { replace: true });
  };

  const handleUseTemplate = (template: Template) => {
    if (!canManageWorkflows) return;
    setSelectedTemplate(template);
    setIsUseModalOpen(true);
    track(Events.TemplateUseClicked, {
      template_id: template.id,
      template_name: template.name,
      category: template.category,
    });
  };

  const handleTemplateUseSuccess = (workflowId: string) => {
    setIsUseModalOpen(false);
    setSelectedTemplate(null);
    navigate(`/workflows/${workflowId}?launch=1`);
  };

  const handleCommunityImported = (template: Template) => {
    handleUseTemplate(template);
  };

  const isSyncing = syncMutation.isPending;
  const hasFilters = Boolean(selectedCategory || searchQuery || showNoSetupOnly);
  const libraryEmpty = templates.length === 0 && !selectedCategory && !searchQuery;

  const getTemplateId = useCallback((t: Template) => t.id, []);

  const {
    orderedItems: orderedTemplates,
    sensors,
    collisionDetection,
    handleDragEnd,
    isDragDisabled,
  } = useSortableList({
    items: activationOrderedTemplates,
    getId: getTemplateId,
    storageKey: `sentris:sort:templates:${organizationId}`,
    disabled: hasFilters,
  });

  return (
    <div className="flex-1 bg-background" aria-busy={isLoading && activeTab === 'official'}>
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setLibraryTab(parseLibraryTab(value))}
          className="mb-6"
        >
          <TabsList aria-label="Template library source">
            <TabsTrigger value="official" onClick={() => setLibraryTab('official')}>
              Official
            </TabsTrigger>
            <TabsTrigger value="community" onClick={() => setLibraryTab('community')}>
              Community
            </TabsTrigger>
          </TabsList>

          <TabsContent value="official" className="mt-6">
            <TemplateFilters
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedCategory={selectedCategory}
              onCategoryChange={handleCategoryChange}
              categories={categories}
              hasFilters={hasFilters}
              onClearFilters={clearFilters}
              onSync={handleSync}
              isSyncing={isSyncing}
              canManageWorkflows={canManageWorkflows}
              noSetupOnly={showNoSetupOnly}
              onToggleNoSetupOnly={toggleNoSetupOnly}
              contributeUrl={officialRepoUrl}
            />

            {error && (
              <ErrorBanner message={error.message} onRetry={() => refetch()} className="mb-6" />
            )}

            {isLoading && !error ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : error && visibleTemplates.length === 0 ? null : visibleTemplates.length === 0 ? (
              <EmptyState
                icon={Layers}
                title="No templates found"
                description={
                  libraryEmpty
                    ? canManageWorkflows
                      ? 'No templates available yet. Sync from GitHub to load the template library.'
                      : 'No templates available yet. The library is synced from GitHub by an administrator — ask an admin to run a sync, or browse the catalog on GitHub.'
                    : "Try adjusting your filters or search query to find what you're looking for."
                }
                action={
                  libraryEmpty ? (
                    canManageWorkflows ? (
                      <Button onClick={handleSync} disabled={isSyncing}>
                        {isSyncing ? 'Syncing…' : 'Sync templates'}
                      </Button>
                    ) : (
                      <Button variant="outline" asChild>
                        <a href={officialRepoUrl} target="_blank" rel="noopener noreferrer">
                          Browse templates on GitHub
                        </a>
                      </Button>
                    )
                  ) : (
                    <Button variant="outline" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  )
                }
              />
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={collisionDetection}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedTemplates.map((t) => t.id)}
                  strategy={rectSortingStrategy}
                >
                  <div
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                    role="region"
                    aria-label="Template list"
                  >
                    {orderedTemplates.map((template) => (
                      <SortableCard
                        key={template.id}
                        id={template.id}
                        disabled={isDragDisabled}
                        className="group relative"
                      >
                        {({ handleProps }) => (
                          <>
                            <CardDragHandle {...handleProps} disabled={isDragDisabled} />
                            <TemplateCard
                              template={template}
                              onUse={handleUseTemplate}
                              onPreview={setPreviewTemplate}
                              canUse={canManageWorkflows}
                              recommended={recommendedTemplateIds.has(template.id)}
                            />
                          </>
                        )}
                      </SortableCard>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </TabsContent>

          <TabsContent value="community" className="mt-6">
            <CommunityTemplatesPanel
              canImport={canManageWorkflows}
              onImported={handleCommunityImported}
            />
          </TabsContent>
        </Tabs>
      </div>

      <TemplateDetailModal
        template={previewTemplate}
        open={!!previewTemplate}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewTemplate(null);
            clearSearchParam(searchParams, setSearchParams, 'id');
          }
        }}
        onUse={(template) => {
          setPreviewTemplate(null);
          clearSearchParam(searchParams, setSearchParams, 'id');
          handleUseTemplate(template);
        }}
        canUse={canManageWorkflows}
      />

      {selectedTemplate && (
        <UseTemplateModal
          template={selectedTemplate}
          open={isUseModalOpen}
          onOpenChange={(open) => {
            setIsUseModalOpen(open);
            if (!open) setSelectedTemplate(null);
          }}
          onSuccess={handleTemplateUseSuccess}
        />
      )}
    </div>
  );
}
