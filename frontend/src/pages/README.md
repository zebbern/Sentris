# Pages Directory

Top-level page components representing application routes. Every page uses `React.lazy()` in `App.tsx` for code splitting.

## Page Components

| File                        | Title              | Description                                                                                |
| --------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `WorkflowList.tsx`          | Workflows          | Dashboard with workflow cards, recent runs, and create/import actions                      |
| `SecretsManager.tsx`        | Secrets            | Secrets and credential management with create, edit, rotate, and bulk delete               |
| `IntegrationsManager.tsx`   | Connections        | OAuth provider connections and third-party integrations                                    |
| `ArtifactLibrary.tsx`       | Artifacts          | File and artifact browser for workflow outputs                                             |
| `SettingsPage.tsx`          | Settings           | Tabbed settings: General, Appearance, Notifications, Keyboard Shortcuts, Audit Log (admin) |
| `TemplateLibraryPage.tsx`   | Template Library   | Browse, filter, and use workflow templates synced from GitHub                              |
| `McpLibraryPage.tsx`        | MCP Library        | Manage MCP server groups, enable servers, and browse available tools                       |
| `SchedulesPage.tsx`         | Schedules          | Cron-based workflow scheduling with create, edit, pause, and delete                        |
| `WebhooksPage.tsx`          | Webhooks           | Webhook endpoint management for triggering workflows via HTTP                              |
| `WebhookEditorPage.tsx`     | Webhook Editor     | Detailed webhook configuration with payload testing and delivery logs                      |
| `ActionCenterPage.tsx`      | Action Center      | Human-in-the-loop task queue for pending workflow approvals and inputs                     |
| `AnalyticsSettingsPage.tsx` | Analytics Settings | PostHog analytics opt-in/out and event tracking configuration                              |
| `ApiKeysManager.tsx`        | API Keys           | API key lifecycle management (create, revoke, copy)                                        |
| `RunRedirect.tsx`           | —                  | Utility route (`/runs/:runId`) that resolves a run's workflow and redirects                |
| `NotFound.tsx`              | Not Found          | 404 page for unmatched routes                                                              |
| `IntegrationCallback.tsx`   | —                  | OAuth callback handler for integration provider flows                                      |

## Sub-page Directories

| Directory           | Contents                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `template-library/` | `TemplateCard`, `TemplateFilters`, `TemplateDetailModal`, `PreviewSection`, types                                |
| `mcp-library/`      | MCP group cards, server selectors, tool browser components                                                       |
| `schedules/`        | Schedule form, schedule row, cron expression helpers                                                             |
| `integrations/`     | Provider cards, connection status, OAuth flow components                                                         |
| `secrets-manager/`  | `CreateSecretForm`, `EditSecretDialog`, `SecretsTable`, `SecretRow`, helpers, types                              |
| `settings/`         | `GeneralSettings`, `AppearanceSettings`, `NotificationSettings`, `KeyboardShortcutsSettings`, `AuditLogSettings` |
| `api-keys-manager/` | API key table, create dialog components                                                                          |
| `webhook-editor/`   | `WebhookFormSection`, `WebhookTestingPanel`, `WebhookDeliveryLog`, `WebhookSettingsTab`                          |
| `webhooks/`         | Webhook list row, status badge components                                                                        |
| `__tests__/`        | Page-level test files                                                                                            |

## Page Architecture

Each page follows this structure:

```typescript
export function PageName() {
  useDocumentTitle('Page Title');

  // Server state via TanStack Query
  const { data, isLoading, error } = usePageData();

  // Client-only filter/UI state via useState (NOT for API data)
  const [filter, setFilter] = useState('');

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        {error && <ErrorBanner message={error.message} />}
        {isLoading ? <Skeleton /> : <PageContent data={data} />}
      </div>
    </div>
  );
}
```

## Routing

Pages connect to the React Router configuration in `App.tsx`:

- All pages use `React.lazy()` for bundle splitting
- Protected routes require authentication
- Organization-scoped routes enforce multi-tenancy
- **Per-route ErrorBoundary**: Every lazy-loaded route element is wrapped in its own `<ErrorBoundary>` so a crash in one page does not break the entire app
- New sidebar pages must be added to `routePrefetchMap` in `src/lib/prefetch-routes.ts`

## Data Loading

- All API data uses TanStack Query hooks in `src/hooks/queries/` — never `useState` + `useEffect`
- Query keys are defined in `src/lib/queryKeys.ts` using factory functions
- Derived data uses `useMemo`, not `useState`
- Mutations invalidate query cache via `queryClient.invalidateQueries()`
- See `frontend/docs/state.md` for the full decision guide

## Best Practices

- Keep page components focused on layout and orchestration
- Extract business logic into hooks and sub-components in the page's directory
- Use `useDocumentTitle()` for browser tab titles
- Use `ErrorBanner` for error display with retry
- Use `EmptyState` for zero-data states
- Support drag-and-drop reordering via `useSortableList` where appropriate
