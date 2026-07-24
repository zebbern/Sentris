import { useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  useScope,
  useScopeRuns,
  useTargetAssets,
  type ScopeRunSummary,
} from '@/hooks/queries/useScopeQueries';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { Asset } from '@/types/scopes';
import { TARGET_DETAIL_TABS, type TargetDetailTab } from './targetDetailTypes';

function isTargetDetailTab(value: string): value is TargetDetailTab {
  return TARGET_DETAIL_TABS.includes(value as TargetDetailTab);
}

export function useTargetDetail() {
  const { id } = useParams<{ id: string }>();
  const scopeId = id ?? '';
  const navigate = useNavigate();
  const location = useLocation();

  const { data: scope, isLoading: isLoadingScope, error: scopeError } = useScope(scopeId);

  const { data: runsData, isLoading: isLoadingRuns } = useScopeRuns(scopeId);
  const runs = useMemo<ScopeRunSummary[]>(() => runsData ?? [], [runsData]);

  const { data: assetsData, isLoading: isLoadingAssets } = useTargetAssets(scopeId);
  const assets = useMemo<Asset[]>(() => assetsData ?? [], [assetsData]);

  useDocumentTitle(scope?.name ?? 'Target');

  // Derive active tab from URL
  const activeTab = useMemo<TargetDetailTab>(() => {
    if (location.pathname.endsWith('/assets')) return 'assets';
    if (location.pathname.endsWith('/runs')) return 'runs';
    return 'overview';
  }, [location.pathname]);

  const navigateToTab = useCallback(
    (tab: string) => {
      if (!isTargetDetailTab(tab)) return;
      const basePath = `/targets/${scopeId}`;
      navigate(tab === 'overview' ? basePath : `${basePath}/${tab}`);
    },
    [scopeId, navigate],
  );

  return {
    scope,
    isLoadingScope,
    scopeError,
    runs,
    isLoadingRuns,
    assets,
    isLoadingAssets,
    activeTab,
    navigateToTab,
  };
}
