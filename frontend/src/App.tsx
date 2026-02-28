import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
const ReactQueryDevtools = lazy(() =>
  import('@tanstack/react-query-devtools').then((mod) => ({
    default: mod.ReactQueryDevtools,
  })),
);
import { queryClient } from '@/lib/queryClient';
import { ToastProvider } from '@/components/ui/toast-provider';
import { AppLayout } from '@/components/layout/AppLayout';
import { AuthProvider } from '@/auth/auth-context';
import { useAuthStoreIntegration } from '@/auth/store-integration';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AnalyticsRouterListener } from '@/features/analytics/AnalyticsRouterListener';
import { PostHogClerkBridge } from '@/features/analytics/PostHogClerkBridge';
import { useCommandPaletteKeyboard } from '@/features/command-palette/useCommandPaletteKeyboard';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { PageTransition } from '@/components/shared/PageTransition';
import { logger } from '@/lib/logger';
import { env } from '@/config/env';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';

// Lazy-loaded page components
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

// Lazy-load CommandPalette — heavy component with many commands
const CommandPalette = lazy(() =>
  import('@/features/command-palette/CommandPalette').then((m) => ({
    default: m.CommandPalette,
  })),
);

function PageSkeleton() {
  return (
    <div className="flex-1 flex flex-col">
      <div className="h-[52px] border-b flex items-center px-4 gap-4">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="flex-1 p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function AuthIntegration({ children }: { children: React.ReactNode }) {
  useAuthStoreIntegration();
  return <>{children}</>;
}

/**
 * Manages focus on SPA route changes for screen reader accessibility (WCAG 2.4.3).
 * On pathname change, moves focus to <main> so screen readers announce the new content.
 * Skips the initial mount and avoids stealing focus from interactive elements.
 */
function RouteChangeAnnouncer() {
  const location = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Don't steal focus if user is actively interacting with a form element
    const activeEl = document.activeElement;
    const isInteracting =
      activeEl instanceof HTMLInputElement ||
      activeEl instanceof HTMLTextAreaElement ||
      activeEl instanceof HTMLSelectElement ||
      (activeEl instanceof HTMLElement && activeEl.isContentEditable);

    if (isInteracting) return;

    // Focus the main content area so screen readers announce the route change
    const main = document.getElementById('main-content');
    if (main) {
      main.focus({ preventScroll: true });
    }
  }, [location.pathname]);

  return null;
}

/**
 * Redirects to the user's preferred landing page on initial app load.
 * Only fires once when the current path is exactly "/".
 */
function LandingPageRedirect() {
  const location = useLocation();
  const navigate = useNavigate();
  const hasChecked = useRef(false);

  useEffect(() => {
    if (hasChecked.current) return;
    hasChecked.current = true;

    if (location.pathname !== '/') return;

    const { defaultLandingPage } = useUserPreferencesStore.getState();
    if (defaultLandingPage && defaultLandingPage !== '/') {
      navigate(defaultLandingPage, { replace: true });
    }
  }, [location.pathname, navigate]);

  return null;
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <PageTransition key={location.pathname}>
      <Routes location={location}>
        <Route
          path="/"
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

function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  useCommandPaletteKeyboard();
  const isOpen = useCommandPaletteStore((state) => state.isOpen);
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (isOpen && !hasOpened) {
      setHasOpened(true);
    }
  }, [isOpen, hasOpened]);

  return (
    <>
      {children}
      {hasOpened && (
        <ErrorBoundary
          fallback={({ error }) => {
            logger.error('[CommandPalette] Failed to load:', error);
            return null;
          }}
        >
          <Suspense fallback={null}>
            <CommandPalette />
          </Suspense>
        </ErrorBoundary>
      )}
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <AuthIntegration>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <BrowserRouter>
              <CommandPaletteProvider>
                {/* Analytics wiring */}
                <AnalyticsRouterListener />
                <PostHogClerkBridge />
                <RouteChangeAnnouncer />
                <LandingPageRedirect />
                <AppLayout>
                  <ProtectedRoute>
                    <Suspense fallback={<PageSkeleton />}>
                      <ErrorBoundary>
                        <AnimatedRoutes />
                      </ErrorBoundary>
                    </Suspense>
                  </ProtectedRoute>
                </AppLayout>
              </CommandPaletteProvider>
            </BrowserRouter>
          </ToastProvider>
          {import.meta.env.DEV && import.meta.env.VITE_DEVTOOLS === 'true' && (
            <Suspense fallback={null}>
              <ReactQueryDevtools />
            </Suspense>
          )}
        </QueryClientProvider>
      </AuthIntegration>
    </AuthProvider>
  );
}

export default App;
