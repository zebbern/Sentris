import { useCallback, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers } from 'lucide-react';
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
} from './template-library';

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function TemplateLibraryPage() {
  useDocumentTitle('Template Library');
  const navigate = useNavigate();
  const roles = useAuthStore((state) => state.roles);
  const organizationId = useAuthStore((state) => state.organizationId);
  const canManageWorkflows = hasAdminRole(roles);

  // UI-only filter state (not server data, so local useState is correct)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Build filters object for query key
  const filters = useMemo(() => {
    const f: { category?: string; search?: string; tags?: string[] } = {};
    if (selectedCategory) f.category = selectedCategory;
    if (searchQuery) f.search = searchQuery;
    if (selectedTags.length > 0) f.tags = selectedTags;
    return Object.keys(f).length > 0 ? f : undefined;
  }, [selectedCategory, searchQuery, selectedTags]);

  // Server state via TanStack Query
  const { data: templates = [], isLoading, error, refetch } = useTemplates(filters);
  const { data: categoriesRaw = [] } = useTemplateCategories();
  const { data: tags = [] } = useTemplateTags();

  // Filter out null-category entries — TemplateFilters expects category: string (non-null)
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
    navigate(`/workflows/${workflowId}`);
  };

  const isSyncing = syncMutation.isPending;
  const hasFilters = Boolean(selectedCategory || selectedTags.length > 0 || searchQuery);

  const getTemplateId = useCallback((t: Template) => t.id, []);

  const {
    orderedItems: orderedTemplates,
    sensors,
    collisionDetection,
    handleDragEnd,
    isDragDisabled,
  } = useSortableList({
    items: templates,
    getId: getTemplateId,
    storageKey: `sentris:sort:templates:${organizationId}`,
    disabled: hasFilters,
  });

  return (
    <div className="flex-1 bg-background" aria-busy={isLoading}>
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        <h2 className="text-2xl font-bold tracking-tight mb-4">Templates</h2>

        {/* Filters */}
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
        />

        {/* Error State */}
        {error && (
          <ErrorBanner message={error.message} onRetry={() => refetch()} className="mb-6" />
        )}

        {/* Grid */}
        {isLoading && !error ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : error && templates.length === 0 ? null : templates.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No templates found"
            description={
              hasFilters
                ? "Try adjusting your filters or search query to find what you're looking for."
                : 'No templates available yet. Sync from GitHub to load templates.'
            }
            action={
              hasFilters ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : canManageWorkflows ? (
                <Button onClick={handleSync} disabled={isSyncing}>
                  {isSyncing ? 'Syncing…' : 'Sync templates'}
                </Button>
              ) : undefined
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
                        />
                      </>
                    )}
                  </SortableCard>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Template Detail Modal */}
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

      {/* Use Template Modal */}
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
