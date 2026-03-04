import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { PageTransition } from '@/components/shared/PageTransition';
import { env } from '@/config/env';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

/**
 * Derive a coarse key from the pathname so PageTransition only remounts
 * on top-level route changes (e.g. /workflows → /templates) but NOT on
 * param changes within the same page (e.g. /workflows/abc/runs/123 → /workflows/abc/runs/456).
 */
function getRouteSegmentKey(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  return '/' + segments.slice(0, 2).join('/');
}

// Lazy-loaded page components
const DashboardPage = lazyWithRetry(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const WorkflowList = lazyWithRetry(() =>
  import('@/pages/WorkflowList').then((m) => ({ default: m.WorkflowList })),
);
const TemplateLibraryPage = lazyWithRetry(() =>
  import('@/pages/TemplateLibraryPage').then((m) => ({ default: m.TemplateLibraryPage })),
);
const WorkflowBuilder = lazyWithRetry(() =>
  import('@/features/workflow-builder/WorkflowBuilder').then((m) => ({
    default: m.WorkflowBuilder,
  })),
);
const SecretsManager = lazyWithRetry(() =>
  import('@/pages/SecretsManager').then((m) => ({ default: m.SecretsManager })),
);
const ApiKeysManager = lazyWithRetry(() =>
  import('@/pages/ApiKeysManager').then((m) => ({ default: m.ApiKeysManager })),
);
const IntegrationsManager = lazyWithRetry(() =>
  import('@/pages/IntegrationsManager').then((m) => ({ default: m.IntegrationsManager })),
);
const ArtifactLibrary = lazyWithRetry(() =>
  import('@/pages/ArtifactLibrary').then((m) => ({ default: m.ArtifactLibrary })),
);
const McpLibraryPage = lazyWithRetry(() =>
  import('@/pages/McpLibraryPage').then((m) => ({ default: m.McpLibraryPage })),
);
const IntegrationCallback = lazyWithRetry(() =>
  import('@/pages/IntegrationCallback').then((m) => ({ default: m.IntegrationCallback })),
);
const NotFound = lazyWithRetry(() =>
  import('@/pages/NotFound').then((m) => ({ default: m.NotFound })),
);
const WebhooksPage = lazyWithRetry(() =>
  import('@/pages/WebhooksPage').then((m) => ({ default: m.WebhooksPage })),
);
const WebhookEditorPage = lazyWithRetry(() =>
  import('@/pages/WebhookEditorPage').then((m) => ({ default: m.WebhookEditorPage })),
);
const SchedulesPage = lazyWithRetry(() =>
  import('@/pages/SchedulesPage').then((m) => ({ default: m.SchedulesPage })),
);
const ActionCenterPage = lazyWithRetry(() =>
  import('@/pages/ActionCenterPage').then((m) => ({ default: m.ActionCenterPage })),
);
const RunRedirect = lazyWithRetry(() =>
  import('@/pages/RunRedirect').then((m) => ({ default: m.RunRedirect })),
);
const AnalyticsSettingsPage = lazyWithRetry(() =>
  import('@/pages/AnalyticsSettingsPage').then((m) => ({ default: m.AnalyticsSettingsPage })),
);
const SettingsPage = lazyWithRetry(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const FindingsPage = lazyWithRetry(() =>
  import('@/pages/FindingsPage').then((m) => ({ default: m.FindingsPage })),
);
const TicketingCallback = lazyWithRetry(() =>
  import('@/pages/settings/TicketingCallback').then((m) => ({ default: m.TicketingCallback })),
);

export function AnimatedRoutes() {
  const location = useLocation();

  return (
    <PageTransition key={getRouteSegmentKey(location.pathname)}>
      <Routes location={location}>
        <Route
          path="/"
          element={
            <ErrorBoundary>
              <DashboardPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/workflows"
          element={
            <ErrorBoundary>
              <WorkflowList />
            </ErrorBoundary>
          }
        />
        <Route
          path="/templates"
          element={
            <ErrorBoundary>
              <TemplateLibraryPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/workflows/:id"
          element={
            <ErrorBoundary>
              <WorkflowBuilder />
            </ErrorBoundary>
          }
        />
        <Route
          path="/workflows/:id/runs"
          element={
            <ErrorBoundary>
              <WorkflowBuilder />
            </ErrorBoundary>
          }
        />
        <Route
          path="/workflows/:id/runs/:runId"
          element={
            <ErrorBoundary>
              <WorkflowBuilder />
            </ErrorBoundary>
          }
        />
        <Route
          path="/secrets"
          element={
            <ErrorBoundary>
              <SecretsManager />
            </ErrorBoundary>
          }
        />
        <Route
          path="/api-keys"
          element={
            <ErrorBoundary>
              <ApiKeysManager />
            </ErrorBoundary>
          }
        />
        {env.VITE_ENABLE_CONNECTIONS ? (
          <Route
            path="/integrations"
            element={
              <ErrorBoundary>
                <IntegrationsManager />
              </ErrorBoundary>
            }
          />
        ) : (
          <Route path="/integrations" element={<Navigate to="/" replace />} />
        )}
        <Route
          path="/webhooks"
          element={
            <ErrorBoundary>
              <WebhooksPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/webhooks/new"
          element={
            <ErrorBoundary>
              <WebhookEditorPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/webhooks/:id"
          element={
            <ErrorBoundary>
              <WebhookEditorPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/webhooks/:id/deliveries"
          element={
            <ErrorBoundary>
              <WebhookEditorPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/webhooks/:id/settings"
          element={
            <ErrorBoundary>
              <WebhookEditorPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/schedules"
          element={
            <ErrorBoundary>
              <SchedulesPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/action-center"
          element={
            <ErrorBoundary>
              <ActionCenterPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/findings"
          element={
            <ErrorBoundary>
              <FindingsPage />
            </ErrorBoundary>
          }
        />
        {env.VITE_OPENSEARCH_DASHBOARDS_URL ? (
          <Route
            path="/analytics-settings"
            element={
              <ErrorBoundary>
                <AnalyticsSettingsPage />
              </ErrorBoundary>
            }
          />
        ) : (
          <Route path="/analytics-settings" element={<Navigate to="/settings" replace />} />
        )}
        <Route
          path="/settings/ticketing/callback"
          element={
            <ErrorBoundary>
              <TicketingCallback />
            </ErrorBoundary>
          }
        />
        <Route
          path="/settings/*"
          element={
            <ErrorBoundary>
              <SettingsPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/artifacts"
          element={
            <ErrorBoundary>
              <ArtifactLibrary />
            </ErrorBoundary>
          }
        />
        <Route
          path="/mcp-library"
          element={
            <ErrorBoundary>
              <McpLibraryPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/runs/:runId"
          element={
            <ErrorBoundary>
              <RunRedirect />
            </ErrorBoundary>
          }
        />
        <Route
          path="/integrations/callback/:provider"
          element={
            <ErrorBoundary>
              <IntegrationCallback />
            </ErrorBoundary>
          }
        />
        <Route
          path="*"
          element={
            <ErrorBoundary>
              <NotFound />
            </ErrorBoundary>
          }
        />
      </Routes>
    </PageTransition>
  );
}
