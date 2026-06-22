import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, RefreshCw, Terminal } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import {
  useTemplates,
  useTemplateCategories,
  useTemplateTags,
  useSyncTemplates,
  useRevalidateTemplate,
  useTemplateRevalidationJob,
  useTemplateRevalidationJobLog,
  useTemplateRevalidationJobs,
  type Template,
  type TemplateRevalidationJobStatus,
  type TemplateRevalidationLogStream,
  type TemplateRevalidationResponse,
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
import type { TemplateValidationFilter } from '@/types/templates';
import {
  TemplateCard,
  CardSkeleton,
  TemplateDetailModal,
  TemplateFilters,
} from './template-library';

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function matchesValidationFilter(template: Template, filter: TemplateValidationFilter) {
  if (filter === 'all') return true;

  const validation = template.validation;

  if (filter === 'unknown') {
    return !validation || validation.status === 'unknown';
  }

  if (filter === 'stale') {
    return Boolean(validation && validation.status !== 'unknown' && validation.isCurrent === false);
  }

  if (filter === 'live-verified') {
    return validation?.status === 'live-verified' && validation.isCurrent !== false;
  }

  return validation?.status === filter;
}

const VALIDATION_FILTERS: TemplateValidationFilter[] = [
  'all',
  'live-verified',
  'stale',
  'needs-fix',
  'needs-review',
  'unknown',
];

function getRevalidationStatusLabel(job: { status: 'started' | 'completed' }) {
  return job.status === 'completed' ? 'Completed' : 'Running';
}

function getRevalidationDetails(job: Pick<TemplateRevalidationJobStatus, 'report'>) {
  if (!job.report) return 'Live audit running';

  const recommendations = job.report.recommendations.join(', ') || 'No recommendation';
  const terminalStatuses = job.report.terminalStatuses.join(', ') || 'No terminal status';
  return `${recommendations} / ${terminalStatuses}`;
}

export function TemplateLibraryPage() {
  useDocumentTitle('Template Library');
  const navigate = useNavigate();
  const { toast } = useToast();
  const roles = useAuthStore((state) => state.roles);
  const organizationId = useAuthStore((state) => state.organizationId);
  const canManageWorkflows = hasAdminRole(roles);

  // UI-only filter state (not server data, so local useState is correct)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedValidation, setSelectedValidation] = useState<TemplateValidationFilter>('all');
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
  const filteredTemplates = useMemo(
    () => templates.filter((template) => matchesValidationFilter(template, selectedValidation)),
    [templates, selectedValidation],
  );
  const validationCounts = useMemo(
    () =>
      VALIDATION_FILTERS.reduce(
        (counts, filter) => ({
          ...counts,
          [filter]:
            filter === 'all'
              ? templates.length
              : templates.filter((template) => matchesValidationFilter(template, filter)).length,
        }),
        {} as Record<TemplateValidationFilter, number>,
      ),
    [templates],
  );

  // Filter out null-category entries — TemplateFilters expects category: string (non-null)
  const categories = useMemo<{ category: string; count: number }[]>(
    () =>
      categoriesRaw
        .filter((c): c is { category: string; count: number } => c.category !== null)
        .map((c) => ({ category: c.category, count: c.count })),
    [categoriesRaw],
  );
  const syncMutation = useSyncTemplates();
  const revalidateMutation = useRevalidateTemplate();

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [isUseModalOpen, setIsUseModalOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [latestRevalidationJob, setLatestRevalidationJob] =
    useState<TemplateRevalidationResponse | null>(null);
  const refreshedCompletedTemplateRevalidationsRef = useRef<Set<string>>(new Set());
  const refreshedCompletedHistoryRevalidationsRef = useRef<Set<string>>(new Set());
  const [selectedRevalidationLog, setSelectedRevalidationLog] = useState<{
    auditId: string;
    templateName: string;
    stream: TemplateRevalidationLogStream;
  } | null>(null);
  const revalidationJobsQuery = useTemplateRevalidationJobs(5, {
    enabled: canManageWorkflows,
  });
  const recentRevalidationJobs = revalidationJobsQuery.data ?? [];
  const refetchRevalidationJobs = revalidationJobsQuery.refetch;
  const latestRevalidationQuery = useTemplateRevalidationJob(latestRevalidationJob?.auditId);
  const revalidationLogQuery = useTemplateRevalidationJobLog(
    selectedRevalidationLog?.auditId,
    selectedRevalidationLog?.stream ?? 'stderr',
    4096,
    { enabled: canManageWorkflows && Boolean(selectedRevalidationLog) },
  );
  const latestRevalidationStatus = latestRevalidationQuery.data;
  const latestRevalidation = latestRevalidationStatus ?? latestRevalidationJob;
  const latestRevalidationLabel = latestRevalidation
    ? getRevalidationStatusLabel(latestRevalidation)
    : null;
  const latestRevalidationDetails = latestRevalidationStatus
    ? getRevalidationDetails(latestRevalidationStatus)
    : 'Live audit running';

  useEffect(() => {
    const completedAuditIds = new Set(
      [
        latestRevalidationStatus?.status === 'completed' ? latestRevalidationStatus.auditId : null,
        ...recentRevalidationJobs
          .filter((job) => job.status === 'completed')
          .map((job) => job.auditId),
      ].filter((auditId): auditId is string => Boolean(auditId)),
    );

    const hasUnrefreshedCompletion = Array.from(completedAuditIds).some((auditId) => {
      if (refreshedCompletedTemplateRevalidationsRef.current.has(auditId)) return false;
      refreshedCompletedTemplateRevalidationsRef.current.add(auditId);
      return true;
    });

    if (!hasUnrefreshedCompletion) return;

    void refetch();
  }, [
    latestRevalidationStatus?.auditId,
    latestRevalidationStatus?.status,
    recentRevalidationJobs,
    refetch,
  ]);

  useEffect(() => {
    if (latestRevalidationStatus?.status !== 'completed') return;

    const { auditId } = latestRevalidationStatus;
    if (refreshedCompletedHistoryRevalidationsRef.current.has(auditId)) return;
    refreshedCompletedHistoryRevalidationsRef.current.add(auditId);

    void refetchRevalidationJobs();
  }, [
    latestRevalidationStatus?.auditId,
    latestRevalidationStatus?.status,
    refetchRevalidationJobs,
  ]);

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
    setSelectedValidation('all');
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

  const handleRevalidateTemplate = (template: Template) => {
    if (!canManageWorkflows) return;
    revalidateMutation.mutate(template.id, {
      onSuccess: (job) => {
        setLatestRevalidationJob(job);
        toast({
          title: 'Template revalidation started',
          description: `${job.templateName} is running a targeted live audit.`,
        });
      },
    });
  };

  const handleTemplateUseSuccess = (workflowId: string) => {
    setIsUseModalOpen(false);
    setSelectedTemplate(null);
    navigate(`/workflows/${workflowId}`);
  };

  const isSyncing = syncMutation.isPending;
  const hasFilters = Boolean(
    selectedCategory || selectedValidation !== 'all' || selectedTags.length > 0 || searchQuery,
  );

  const getTemplateId = useCallback((t: Template) => t.id, []);

  const {
    orderedItems: orderedTemplates,
    sensors,
    collisionDetection,
    handleDragEnd,
    isDragDisabled,
  } = useSortableList({
    items: filteredTemplates,
    getId: getTemplateId,
    storageKey: `sentris:sort:templates:${organizationId}`,
    disabled: hasFilters,
  });

  return (
    <div className="flex-1 bg-background" aria-busy={isLoading}>
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        {/* Filters */}
        <TemplateFilters
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedCategory={selectedCategory}
          onCategoryChange={handleCategoryChange}
          selectedValidation={selectedValidation}
          onValidationChange={setSelectedValidation}
          validationCounts={validationCounts}
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

        {latestRevalidation && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 flex flex-col gap-3 rounded-md border border-border bg-muted/30 px-4 py-3 md:flex-row md:items-center"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Badge variant={latestRevalidation.status === 'completed' ? 'success' : 'secondary'}>
                {latestRevalidationLabel}
              </Badge>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Latest revalidation</p>
                <p className="truncate text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {latestRevalidation.templateName}
                  </span>
                  <span className="px-2 text-muted-foreground/60">/</span>
                  <span>{latestRevalidationDetails}</span>
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {latestRevalidation.auditId}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-2 self-start md:self-auto"
              disabled={latestRevalidationQuery.isFetching}
              onClick={() => {
                void latestRevalidationQuery.refetch();
              }}
            >
              <RefreshCw
                className={`h-4 w-4 ${latestRevalidationQuery.isFetching ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {latestRevalidationQuery.isFetching ? 'Refreshing' : 'Refresh'}
            </Button>
          </div>
        )}

        {canManageWorkflows && recentRevalidationJobs.length > 0 && (
          <div
            role="region"
            aria-label="Recent revalidations"
            className="mb-4 rounded-md border border-border bg-background"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <p className="text-sm font-medium text-foreground">Recent revalidations</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-2"
                disabled={revalidationJobsQuery.isFetching}
                onClick={() => {
                  void revalidationJobsQuery.refetch();
                }}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    revalidationJobsQuery.isFetching ? 'animate-spin' : ''
                  }`}
                  aria-hidden="true"
                />
                Refresh
              </Button>
            </div>
            <div className="divide-y divide-border">
              {recentRevalidationJobs.map((job) => (
                <div
                  key={job.auditId}
                  className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center"
                >
                  <Badge variant={job.status === 'completed' ? 'success' : 'secondary'}>
                    {getRevalidationStatusLabel(job)}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {job.templateName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {getRevalidationDetails(job)}
                    </p>
                  </div>
                  <time className="text-xs text-muted-foreground" dateTime={job.startedAt}>
                    {new Date(job.startedAt).toLocaleString()}
                  </time>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-2 self-start md:self-auto"
                    onClick={() => {
                      setSelectedRevalidationLog({
                        auditId: job.auditId,
                        templateName: job.templateName,
                        stream: 'stderr',
                      });
                    }}
                  >
                    <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                    Logs
                  </Button>
                </div>
              ))}
            </div>
            {selectedRevalidationLog && (
              <div
                role="region"
                aria-label="Revalidation logs"
                className="border-t border-border bg-muted/20 px-4 py-3"
              >
                <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Revalidation logs</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {selectedRevalidationLog.templateName}
                      <span className="px-2 text-muted-foreground/60">/</span>
                      <span className="font-mono">{selectedRevalidationLog.auditId}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(['stdout', 'stderr'] as const).map((stream) => (
                      <Button
                        key={stream}
                        type="button"
                        variant={selectedRevalidationLog.stream === stream ? 'default' : 'outline'}
                        size="sm"
                        className="h-8 font-mono"
                        onClick={() => {
                          setSelectedRevalidationLog((current) =>
                            current ? { ...current, stream } : current,
                          );
                        }}
                      >
                        {stream}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-2"
                      disabled={revalidationLogQuery.isFetching}
                      onClick={() => {
                        void revalidationLogQuery.refetch();
                      }}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${
                          revalidationLogQuery.isFetching ? 'animate-spin' : ''
                        }`}
                        aria-hidden="true"
                      />
                      Refresh
                    </Button>
                  </div>
                </div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground">
                  {revalidationLogQuery.isFetching
                    ? 'Loading logs...'
                    : revalidationLogQuery.data?.content || 'No log output'}
                </pre>
                {revalidationLogQuery.data?.truncated && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing last {revalidationLogQuery.data.bytes.toLocaleString()} bytes.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

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
        ) : error && filteredTemplates.length === 0 ? null : filteredTemplates.length === 0 ? (
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
                          onRevalidate={handleRevalidateTemplate}
                          isRevalidating={
                            revalidateMutation.isPending &&
                            revalidateMutation.variables === template.id
                          }
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
