import { Link } from 'react-router-dom';
import { ArrowLeft, Target, Boxes } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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

export function TargetDetailPage() {
  const {
    scope,
    isLoadingScope,
    runs,
    isLoadingRuns,
    assets,
    isLoadingAssets,
    activeTab,
    navigateToTab,
  } = useTargetDetail();

  if (isLoadingScope) {
    return (
      <div className="flex-1 bg-background p-4 md:p-8 space-y-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
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
        <div>
          <BackLink />
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{scope.name}</h1>
          {scope.description && (
            <p className="mt-1 text-sm text-muted-foreground">{scope.description}</p>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={navigateToTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="runs">Run History</TabsTrigger>
            <TabsTrigger value="assets">Assets</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 pt-2">
            <ChipList label="Domains" items={scope.domains} />
            <ChipList label="Repos" items={scope.repos} />
            <ChipList label="IP ranges" items={scope.ipRanges} />
          </TabsContent>

          <TabsContent value="runs" className="pt-2">
            {isLoadingRuns ? (
              <RunHistorySkeleton />
            ) : runs.length === 0 ? (
              <EmptyState
                icon={Target}
                title="No runs yet"
                description="Run a workflow against this target to see its history here."
                className="py-10"
              />
            ) : (
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
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell className="font-medium">{run.workflowName}</TableCell>
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
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="assets" className="pt-2">
            {isLoadingAssets ? (
              <AssetsSkeleton />
            ) : assets.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title="No assets yet"
                description="Discovered assets from recon runs against this target will appear here."
                className="py-10"
              />
            ) : (
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
                      {assets.map((asset) => (
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
                            {asset.sourceComponentId ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
