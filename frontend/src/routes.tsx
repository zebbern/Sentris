import { lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { PageTransition } from '@/components/shared/PageTransition';
import { env } from '@/config/env';

// Lazy-loaded page components
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const WorkflowList = lazy(() =>
  import('@/pages/WorkflowList').then((m) => ({ default: m.WorkflowList })),
);
const TemplateLibraryPage = lazy(() =>
  import('@/pages/TemplateLibraryPage').then((m) => ({ default: m.TemplateLibraryPage })),
);
const WorkflowBuilder = lazy(() =>
  import('@/features/workflow-builder/WorkflowBuilder').then((m) => ({
    default: m.WorkflowBuilder,
  })),
);
const SecretsManager = lazy(() =>
  import('@/pages/SecretsManager').then((m) => ({ default: m.SecretsManager })),
);
const ApiKeysManager = lazy(() =>
  import('@/pages/ApiKeysManager').then((m) => ({ default: m.ApiKeysManager })),
);
const IntegrationsManager = lazy(() =>
  import('@/pages/IntegrationsManager').then((m) => ({ default: m.IntegrationsManager })),
);
const ArtifactLibrary = lazy(() =>
  import('@/pages/ArtifactLibrary').then((m) => ({ default: m.ArtifactLibrary })),
);
const McpLibraryPage = lazy(() =>
  import('@/pages/McpLibraryPage').then((m) => ({ default: m.McpLibraryPage })),
);
const IntegrationCallback = lazy(() =>
  import('@/pages/IntegrationCallback').then((m) => ({ default: m.IntegrationCallback })),
);
const NotFound = lazy(() => import('@/pages/NotFound').then((m) => ({ default: m.NotFound })));
const WebhooksPage = lazy(() =>
  import('@/pages/WebhooksPage').then((m) => ({ default: m.WebhooksPage })),
);
const WebhookEditorPage = lazy(() =>
  import('@/pages/WebhookEditorPage').then((m) => ({ default: m.WebhookEditorPage })),
);
const SchedulesPage = lazy(() =>
  import('@/pages/SchedulesPage').then((m) => ({ default: m.SchedulesPage })),
);
const ActionCenterPage = lazy(() =>
  import('@/pages/ActionCenterPage').then((m) => ({ default: m.ActionCenterPage })),
);
const RunRedirect = lazy(() =>
  import('@/pages/RunRedirect').then((m) => ({ default: m.RunRedirect })),
);
const AnalyticsSettingsPage = lazy(() =>
  import('@/pages/AnalyticsSettingsPage').then((m) => ({ default: m.AnalyticsSettingsPage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

export function AnimatedRoutes() {
  const location = useLocation();

  return (
    <PageTransition key={location.pathname}>
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
