import { useCallback, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ErrorBanner } from '@/components/ui/error-banner';
import {
  useTemplates,
  useTemplateCategories,
  useTemplateTags,
  useSyncTemplates,
  type Template,
} from '@/hooks/queries/useTemplateQueries';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/components/ui/use-toast';
import { humanizeApiError } from '@/lib/humanizeApiError';
import { hasAdminRole } from '@/utils/auth';
import { track, Events } from '@/features/analytics/events';
import { UseTemplateModal } from '@/features/templates/UseTemplateModal';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { useSortableList } from '@/hooks/useSortableList';
import { SortableCard, CardDragHandle } from '@/components/ui/sortable-card';
import {
  TemplateCard,
  CardSkeleton,
  EmptyState,
  TemplateDetailModal,
  TemplateFilters,
} from './template-library';

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function TemplateLibraryPage() {
  useDocumentTitle('Templates');
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
  const { data: categories = [] } = useTemplateCategories();
  const { data: tags = [] } = useTemplateTags();
  const syncMutation = useSyncTemplates();
  const { toast } = useToast();

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [isUseModalOpen, setIsUseModalOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);

  const handleSync = async () => {
    try {
      await syncMutation.mutateAsync();
    } catch (err: unknown) {
      toast({
        title: 'Template sync failed',
        description: humanizeApiError(err),
        variant: 'destructive',
      });
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
    storageKey: `shipsec:sort:templates:${organizationId}`,
    disabled: hasFilters,
  });

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-6 md:py-8 px-3 md:px-6 max-w-7xl">
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
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
