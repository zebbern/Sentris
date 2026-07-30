import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Boxes, GitCompareArrows, Play, ShieldAlert, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatStartTime, formatDuration, formatTimeAgo } from '@/utils/timeFormat';
import { getStatusBadgeClassFromStatus, formatStatusText } from '@/utils/statusBadgeStyles';
import {
  buildTargetFindingPath,
  buildTargetWorkflowPath,
  buildTargetWorkflowSelectionPath,
} from '@/lib/targetNavigation';
import { humanizeProjectionReason } from '@/features/findings/findingDataQuality';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { useTargetDetail } from './target-detail';

function ChipList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-muted-foreground mb-2">{label}</h3>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <Badge key={item} variant="secondary" className="font-normal">
              {item}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
}

function RunHistorySkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function AssetsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/targets"
      className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Targets
    </Link>
  );
}

function formatObservationStatus(status: string): string {
  return status
    .split('-')
    .map((part, index) => (index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
}

export function TargetDetailPage() {
  const roles = useAuthStore((state) => state.roles);
  const canManage = hasAdminRole(roles);
  const {
    scope,
    isLoadingScope,
    scopeError,
    runs,
    isLoadingRuns,
    runsError,
    hasMoreRuns,
    loadMoreRuns,
    isLoadingMoreRuns,
    assets,
    isLoadingAssets,
    assetsError,
    findings,
    isLoadingFindings,
    findingsError,
    findingsDataQuality,
    hasMoreFindings,
    loadMoreFindings,
    isLoadingMoreFindings,
    comparison,
    isLoadingComparison,
    comparisonError,
    canCompareRuns,
    compareLatestRuns,
    activeTab,
    navigateToTab,
  } = useTargetDetail();
  const [assetTypeFilter, setAssetTypeFilter] = useState('all');
  const assetTypes = useMemo(
    () => [...new Set(assets.map((asset) => asset.assetType))].sort(),
    [assets],
  );
  const filteredAssets = useMemo(
    () =>
      assetTypeFilter === 'all'
        ? assets
        : assets.filter((asset) => asset.assetType === assetTypeFilter),
    [assetTypeFilter, assets],
  );

  if (isLoadingScope) {
    return (
      <div className="flex-1 bg-background p-4 md:p-8 space-y-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!scope && scopeError) {
    return (
      <div className="flex-1 bg-background p-4 md:p-8">
        <BackLink />
        <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
          Target is unavailable:{' '}
          {scopeError instanceof Error ? scopeError.message : 'target data could not be loaded'}
        </div>
      </div>
    );
  }

  if (!scope) {
    return (
      <div className="flex-1 bg-background p-4 md:p-8">
        <BackLink />
        <p className="text-sm text-muted-foreground">Target not found.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto space-y-4 px-3 py-4 md:space-y-6 md:px-4 md:py-8">
        {scopeError && (
          <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
            Target is unavailable:{' '}
            {scopeError instanceof Error
              ? scopeError.message
              : 'target data could not be refreshed'}
          </div>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <BackLink />
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{scope.name}</h1>
            {scope.description && (
              <p className="mt-1 text-sm text-muted-foreground">{scope.description}</p>
            )}
          </div>
          {canManage && (
            <Button asChild className="gap-2">
              <Link to={buildTargetWorkflowSelectionPath(scope.id)}>
                <Play className="h-4 w-4" />
                Run target
              </Link>
            </Button>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={navigateToTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="runs">Run History</TabsTrigger>
            <TabsTrigger value="assets">Assets</TabsTrigger>
            <TabsTrigger value="findings">Findings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 pt-2">
            <ChipList label="Domains" items={scope.domains} />
            <ChipList label="Repos" items={scope.repos} />
            <ChipList label="IP ranges" items={scope.ipRanges} />
          </TabsContent>

          <TabsContent value="runs" className="space-y-3 pt-2">
            {runsError && (
              <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
                Run history is unavailable:{' '}
                {runsError instanceof Error ? runsError.message : 'run history could not be loaded'}
              </div>
            )}
            {isLoadingRuns ? (
              <RunHistorySkeleton />
            ) : runs.length === 0 ? (
              !runsError && (
                <EmptyState
                  icon={Target}
                  title="No runs yet"
                  description="Run a workflow against this target to see its history here."
                  className="py-10"
                />
              )
            ) : (
              <div className="space-y-4">
                {canCompareRuns && (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      onClick={compareLatestRuns}
                      disabled={isLoadingComparison}
                    >
                      <GitCompareArrows className="h-4 w-4" />
                      Compare latest two runs
                    </Button>
                  </div>
                )}
                <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
                  <div className="overflow-x-auto">
                    <Table aria-label="Run history">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Workflow</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Started</TableHead>
                          <TableHead>Duration</TableHead>
                          <TableHead>Trigger</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {runs.map((run) => (
                          <TableRow key={run.id}>
                            <TableCell className="font-medium">
                              <Link
                                to={`/runs/${run.id}`}
                                aria-label={`Open run ${run.id}`}
                                className="hover:underline"
                              >
                                {run.workflowName}
                              </Link>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={getStatusBadgeClassFromStatus(run.status)}
                              >
                                {formatStatusText(run.status)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatStartTime(run.startTime)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {run.duration != null ? formatDuration(run.duration) : '—'}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {run.triggerLabel ?? '—'}
                            </TableCell>
                            <TableCell className="text-right">
                              {canManage && (
                                <Button asChild variant="ghost" size="sm">
                                  <Link
                                    to={buildTargetWorkflowPath(run.workflowId, scope.id)}
                                    aria-label={`Rescan with ${run.workflowName}`}
                                  >
                                    Rescan
                                  </Link>
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {hasMoreRuns && (
                    <div className="flex justify-center border-t p-3">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isLoadingMoreRuns}
                        onClick={() => void loadMoreRuns()}
                      >
                        {isLoadingMoreRuns ? 'Loading runs…' : 'Load more runs'}
                      </Button>
                    </div>
                  )}
                </div>

                {comparisonError && (
                  <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
                    Asset comparison is unavailable:{' '}
                    {comparisonError instanceof Error
                      ? comparisonError.message
                      : 'observation data could not be loaded'}
                  </div>
                )}
                {comparison && (
                  <section
                    aria-label="Asset observation comparison"
                    className="overflow-hidden rounded-lg border bg-card shadow-sm"
                  >
                    <div className="space-y-3 border-b p-4">
                      <div>
                        <h3 className="font-semibold">Asset observation delta</h3>
                        <p className="text-sm text-muted-foreground">
                          Not observed means the same scanner completed without seeing the asset.
                          Not scanned means comparable scanner coverage did not complete.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">Observed {comparison.summary.observed}</Badge>
                        <Badge variant="outline">
                          Not observed {comparison.summary.notObserved}
                        </Badge>
                        <Badge variant="outline">Not scanned {comparison.summary.notScanned}</Badge>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <Table aria-label="Asset observation delta">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Asset</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Change</TableHead>
                            <TableHead>Observation</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {comparison.items.map((item) => (
                            <TableRow key={`${item.assetType}:${item.assetValue}`}>
                              <TableCell className="font-medium">{item.assetValue}</TableCell>
                              <TableCell>{item.assetType}</TableCell>
                              <TableCell>{formatObservationStatus(item.change)}</TableCell>
                              <TableCell>
                                <Badge variant="outline">
                                  {formatObservationStatus(item.observationStatus)}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </section>
                )}
                {isLoadingComparison && (
                  <div className="space-y-2" aria-label="Loading asset comparison">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="assets" className="space-y-3 pt-2">
            {assetsError && (
              <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
                Assets are unavailable:{' '}
                {assetsError instanceof Error
                  ? assetsError.message
                  : 'asset data could not be loaded'}
              </div>
            )}
            {isLoadingAssets ? (
              <AssetsSkeleton />
            ) : assets.length === 0 ? (
              !assetsError && (
                <EmptyState
                  icon={Boxes}
                  title="No assets yet"
                  description="Discovered assets from recon runs against this target will appear here."
                  className="py-10"
                />
              )
            ) : (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <select
                    aria-label="Filter assets by type"
                    value={assetTypeFilter}
                    onChange={(event) => setAssetTypeFilter(event.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="all">All asset types</option>
                    {assetTypes.map((assetType) => (
                      <option key={assetType} value={assetType}>
                        {assetType}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
                  <div className="overflow-x-auto">
                    <Table aria-label="Assets">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Asset</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>First seen</TableHead>
                          <TableHead>Last seen</TableHead>
                          <TableHead>Source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAssets.map((asset) => (
                          <TableRow key={asset.id}>
                            <TableCell className="font-medium">{asset.assetValue}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{asset.assetType}</Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatTimeAgo(asset.firstSeenAt)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatTimeAgo(asset.lastSeenAt)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {(asset.lastSeenRunId ?? asset.firstSeenRunId) ? (
                                <Link
                                  to={`/runs/${asset.lastSeenRunId ?? asset.firstSeenRunId}`}
                                  aria-label={`Open source run ${
                                    asset.lastSeenRunId ?? asset.firstSeenRunId
                                  }`}
                                  className="hover:underline"
                                >
                                  {asset.sourceComponentId ?? 'View run'}
                                </Link>
                              ) : (
                                (asset.sourceComponentId ?? '—')
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="findings" className="pt-2">
            <div className="space-y-3">
              {!isLoadingFindings && !findingsError && findingsDataQuality.availability && (
                <div
                  role="status"
                  aria-label="Target findings data quality"
                  className="rounded-md border border-amber-500/40 p-3 text-sm"
                >
                  <p>
                    Findings data quality is {findingsDataQuality.availability}
                    {findingsDataQuality.degradedReasons.length > 0
                      ? `: ${findingsDataQuality.degradedReasons
                          .map(humanizeProjectionReason)
                          .join(', ')}.`
                      : '.'}
                  </p>
                  {findingsDataQuality.schemaCoverage && (
                    <p>
                      Schema coverage: {findingsDataQuality.schemaCoverage.canonical} canonical,{' '}
                      {findingsDataQuality.schemaCoverage.legacy} legacy,{' '}
                      {findingsDataQuality.schemaCoverage.invalid} invalid.
                    </p>
                  )}
                  {findingsDataQuality.projectionHealth && (
                    <p>
                      Projection health: {findingsDataQuality.projectionHealth.availability}
                      {findingsDataQuality.projectionHealth.reason
                        ? ` (${humanizeProjectionReason(
                            findingsDataQuality.projectionHealth.reason,
                          )})`
                        : ''}
                      . Reconciled through:{' '}
                      {findingsDataQuality.projectionHealth.reconciledThrough ?? 'not reconciled'}.
                      Reconciliation completed:{' '}
                      {findingsDataQuality.projectionHealth.completedAt ?? 'not completed'}.
                    </p>
                  )}
                </div>
              )}
              {isLoadingFindings ? (
                <RunHistorySkeleton />
              ) : findingsError ? (
                <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
                  Findings are unavailable:{' '}
                  {findingsError instanceof Error
                    ? findingsError.message
                    : 'finding data could not be loaded'}
                </div>
              ) : findings.length === 0 ? (
                <EmptyState
                  icon={ShieldAlert}
                  title="No findings yet"
                  description="This target has no observed security findings."
                  className="py-10"
                />
              ) : (
                <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
                  <div className="overflow-x-auto">
                    <Table aria-label="Target findings">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Finding</TableHead>
                          <TableHead>Severity</TableHead>
                          <TableHead>Asset</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {findings.map((finding) => {
                          const label = finding.name ?? finding.id;
                          return (
                            <TableRow key={finding.id}>
                              <TableCell className="font-medium">
                                <Link
                                  to={buildTargetFindingPath(scope.id, finding.id)}
                                  aria-label={`Open finding ${label}`}
                                  className="hover:underline"
                                >
                                  {label}
                                </Link>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{finding.severity ?? 'unknown'}</Badge>
                              </TableCell>
                              <TableCell>{finding.asset_key ?? '—'}</TableCell>
                              <TableCell>{finding.triage?.status ?? 'new'}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {hasMoreFindings && (
                    <div className="flex justify-center border-t p-3">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isLoadingMoreFindings}
                        onClick={() => void loadMoreFindings()}
                      >
                        {isLoadingMoreFindings ? 'Loading findings…' : 'Load more findings'}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
