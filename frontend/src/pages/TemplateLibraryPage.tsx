import { useCallback, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layers, Sparkles } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Button } from '@/components/ui/button';
import {
  useTemplates,
  useTemplateCategories,
  useTemplateTags,
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
  compareTemplatesForActivation,
  isNoSetupTemplate,
  isRecommendedTemplate,
} from './template-library';

export function TemplateLibraryPage() {
  useDocumentTitle('Template Library');
  const navigate = useNavigate();
  const roles = useAuthStore((state) => state.roles);
  const organizationId = useAuthStore((state) => state.organizationId);
  const canManageWorkflows = hasAdminRole(roles);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [showNoSetupOnly, setShowNoSetupOnly] = useState(
    () => searchParams.get('setup') === 'none',
  );

  const filters = useMemo(() => {
    const f: { category?: string; search?: string; tags?: string[] } = {};
    if (selectedCategory) f.category = selectedCategory;
    if (searchQuery) f.search = searchQuery;
    if (selectedTags.length > 0) f.tags = selectedTags;
    return Object.keys(f).length > 0 ? f : undefined;
  }, [selectedCategory, searchQuery, selectedTags]);

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
  const { data: tags = [] } = useTemplateTags();

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

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const clearFilters = () => {
    setSelectedCategory(null);
    setSelectedTags([]);
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

  const isSyncing = syncMutation.isPending;
  const hasFilters = Boolean(
    selectedCategory || selectedTags.length > 0 || searchQuery || showNoSetupOnly,
  );
  const libraryEmpty =
    templates.length === 0 && !selectedCategory && !searchQuery && selectedTags.length === 0;

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
    <div className="flex-1 bg-background" aria-busy={isLoading}>
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        <TemplateFilters
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedCategory={selectedCategory}
          onCategoryChange={handleCategoryChange}
          categories={categories}
          tags={tags}
          selectedTags={selectedTags}
          onToggleTag={toggleTag}
          hasFilters={hasFilters}
          onClearFilters={clearFilters}
          onSync={handleSync}
          isSyncing={isSyncing}
          canManageWorkflows={canManageWorkflows}
          noSetupOnly={showNoSetupOnly}
          onToggleNoSetupOnly={toggleNoSetupOnly}
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
                    <a
                      href="https://github.com/zebbern/Sentris"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
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
          <>
            {!hasFilters && recommendedTemplateIds.size > 0 && (
              <div className="mb-4 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-semibold">Start here</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Recommended starters run with minimal setup and have been verified by Sentris.
                  </p>
                </div>
              </div>
            )}

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
          </>
        )}
      </div>

      <TemplateDetailModal
        template={previewTemplate}
        open={!!previewTemplate}
        onOpenChange={(open) => {
          if (!open) setPreviewTemplate(null);
        }}
        onUse={(template) => {
          setPreviewTemplate(null);
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
