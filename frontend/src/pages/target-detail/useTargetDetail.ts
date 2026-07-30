import { useCallback, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  useScope,
  useScopeRuns,
  useTargetAssets,
  useAssetRunComparison,
  useTargetFindings,
  type ScopeRunSummary,
} from '@/hooks/queries/useScopeQueries';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { Asset } from '@/types/scopes';
import {
  TARGET_DETAIL_TABS,
  type TargetDetailTab,
  type TargetFindingsDataQuality,
} from './targetDetailTypes';

function isTargetDetailTab(value: string): value is TargetDetailTab {
  return TARGET_DETAIL_TABS.includes(value as TargetDetailTab);
}

export function useTargetDetail() {
  const { id } = useParams<{ id: string }>();
  const scopeId = id ?? '';
  const navigate = useNavigate();
  const location = useLocation();

  const { data: scope, isLoading: isLoadingScope, error: scopeError } = useScope(scopeId);
  const activeTab = useMemo<TargetDetailTab>(() => {
    if (location.pathname.endsWith('/assets')) return 'assets';
    if (location.pathname.endsWith('/runs')) return 'runs';
    if (location.pathname.endsWith('/findings')) return 'findings';
    return 'overview';
  }, [location.pathname]);

  const {
    data: runsData,
    isLoading: isLoadingRuns,
    hasNextPage: hasMoreRuns,
    fetchNextPage: loadMoreRuns,
    isFetchingNextPage: isLoadingMoreRuns,
    error: runsError,
  } = useScopeRuns(scopeId);
  const runs = useMemo<ScopeRunSummary[]>(() => runsData ?? [], [runsData]);

  const {
    data: assetsData,
    isLoading: isLoadingAssets,
    error: assetsError,
  } = useTargetAssets(scopeId);
  const assets = useMemo<Asset[]>(() => assetsData ?? [], [assetsData]);
  const {
    data: findings,
    isLoading: isLoadingFindings,
    error: findingsError,
    availability: findingsAvailability,
    degradedReasons: findingsDegradedReasons,
    projectionHealth: findingsProjectionHealth,
    schemaCoverage: findingsSchemaCoverage,
    hasNextPage: hasMoreFindings,
    fetchNextPage: loadMoreFindings,
    isFetchingNextPage: isLoadingMoreFindings,
  } = useTargetFindings(scopeId, activeTab === 'findings');
  const findingsDataQuality = useMemo<TargetFindingsDataQuality>(
    () => ({
      availability: findingsAvailability,
      degradedReasons: findingsDegradedReasons,
      projectionHealth: findingsProjectionHealth,
      schemaCoverage: findingsSchemaCoverage,
    }),
    [
      findingsAvailability,
      findingsDegradedReasons,
      findingsProjectionHealth,
      findingsSchemaCoverage,
    ],
  );
  const [comparisonRunIds, setComparisonRunIds] = useState<{
    baselineRunId: string;
    currentRunId: string;
  } | null>(null);
  const comparisonCandidate = useMemo(() => {
    for (let currentIndex = 0; currentIndex < runs.length; currentIndex += 1) {
      const current = runs[currentIndex];
      if (!current) continue;
      const baseline = runs
        .slice(currentIndex + 1)
        .find((candidate) => candidate.workflowId === current.workflowId);
      if (baseline) {
        return {
          baselineRunId: baseline.id,
          currentRunId: current.id,
        };
      }
    }
    return null;
  }, [runs]);
  const {
    data: comparison,
    isLoading: isLoadingComparison,
    error: comparisonError,
  } = useAssetRunComparison(
    scopeId,
    comparisonRunIds?.baselineRunId ?? null,
    comparisonRunIds?.currentRunId ?? null,
  );

  useDocumentTitle(scope?.name ?? 'Target');

  const navigateToTab = useCallback(
    (tab: string) => {
      if (!isTargetDetailTab(tab)) return;
      const basePath = `/targets/${scopeId}`;
      navigate(tab === 'overview' ? basePath : `${basePath}/${tab}`);
    },
    [scopeId, navigate],
  );
  const compareLatestRuns = useCallback(() => {
    if (comparisonCandidate) setComparisonRunIds(comparisonCandidate);
  }, [comparisonCandidate]);

  return {
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
    findingsAvailability,
    findingsDegradedReasons,
    findingsDataQuality,
    hasMoreFindings,
    loadMoreFindings,
    isLoadingMoreFindings,
    comparison,
    isLoadingComparison,
    comparisonError,
    canCompareRuns: Boolean(comparisonCandidate),
    compareLatestRuns,
    activeTab,
    navigateToTab,
  };
}
