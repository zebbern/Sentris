# Agent: researcher

## Purpose

Perform a feature gap analysis comparing Sentris Flow's current capabilities against common security orchestration platform features, and provide prioritized recommendations.

## Skills

Load before starting: none

## Subtasks

- [x] Read `AGENTS.md` thoroughly — note all features mentioned in Architecture, Rules, and Development sections
- [x] Read `README.md` for the public-facing feature list and positioning
- [x] Scan `docs/` directory — read `docs/user-guide.mdx`, `docs/architecture.mdx`, and skim other docs to build a comprehensive feature inventory
- [x] Scan `frontend/src/features/` and `frontend/src/pages/` directory names to identify implemented UI features
- [x] Scan `backend/src/` module directory names to identify implemented backend capabilities
- [x] Compile a feature inventory: list every feature currently present in Sentris Flow with a one-line description
- [x] Research common SOAR/security orchestration platform features — consider these categories at minimum: admin dashboard, RBAC/permissions granularity, workflow templates/marketplace, scheduled/recurring runs, notifications (email/Slack/webhook), reporting/analytics, third-party integrations, audit logging, compliance, incident management, asset management
- [x] Create a gap matrix: feature area × present/absent/partial, with notes on current implementation state
- [x] For each gap, provide: effort estimate (S/M/L/XL), expected user impact (low/medium/high), and a brief rationale
- [x] Produce a prioritized recommendation list (top 5-10 features) ordered by impact-to-effort ratio, with a 1-2 sentence justification per item

## Notes

- This is a research-only task — do not modify any source code or configuration files.
- Focus on features that would matter to a security team evaluating the platform for production use.
- Consider both self-hosted and SaaS deployment models when analyzing gaps.
- The platform currently has: visual workflow builder, component registry (security tools + AI + core utilities), real-time terminal streaming, event timeline, secrets management, Docker-based tool execution, Temporal orchestration, human-in-the-loop approvals, findings dashboard, artifact storage (MinIO), webhook triggers, scheduled runs (CRON), and multi-org tenancy.
- Avoid speculative "nice to have" features — focus on gaps that would block or significantly hinder adoption by security teams.

## Completion Summary

<!-- Appended by orchestrator after agent completes. -->

---

## Feature Inventory (Current State)

### Workflow Orchestration

- **Visual workflow builder** — ReactFlow-based drag-and-drop canvas with node/edge editor
- **DSL compilation** — Visual graphs compiled to executable instructions
- **Temporal orchestration** — Durable, resumable workflows with retry logic
- **Component registry** — 25+ security components, AI agents, core utilities, MCP tools, IT automation
- **Component runners** — Inline TypeScript, Docker containers, remote executors (future)
- **Workflow versioning** — Version history panel with restore capability
- **Subworkflows** — Workflow Call component for composition
- **Conditional routing** — Conditional Router for branching logic

### Execution & Monitoring

- **Real-time terminal streaming** — Redis Streams → SSE → xterm.js
- **Event timeline** — Kafka → WebSocket for live execution events
- **Log aggregation** — Loki + PostgreSQL structured logging
- **Run history** — Execution runs list with status, duration, trigger info
- **Findings panel** — Per-run security findings with severity filtering and export (CSV, Markdown)
- **Findings dashboard** — Cross-workflow findings view with charts, filters, date ranges (OpenSearch-backed)
- **Artifact storage** — MinIO-based file storage with S3 destinations

### Triggers & Scheduling

- **Webhook triggers** — Webhook editor with management page
- **CRON scheduling** — Schedule management with filters and editor drawer
- **API triggers** — REST API for programmatic workflow execution
- **Manual trigger** — Start node with manual input

### Security & Auth

- **Authentication** — Clerk (hosted) + local admin auth
- **RBAC** — Basic ADMIN/MEMBER roles with RolesGuard
- **Organization isolation** — All data scoped by `organization_id`
- **Secrets management** — AES-256-GCM encrypted, versioned secrets
- **API keys** — Scoped API key management with permissions
- **Container isolation** — Per-run ephemeral Docker volumes, no shell execution
- **SSRF protection** — URL validation blocking RFC 1918, loopback, link-local addresses
- **Audit logging** — Event-based audit trail (workflow.create, secret.rotate, etc.)

### Integrations

- **OAuth integrations** — GitHub and Zoom OAuth providers with token management
- **MCP Library** — Centralized MCP server management with multi-server selection
- **AWS MCP servers** — CloudTrail, CloudWatch, IAM, S3, Lambda, Network built-in
- **Notification components** — Slack and Jira components in worker
- **Notify component** — Multi-channel notifications (Slack, Discord, Telegram, Email)

### User Experience

- **Dashboard** — Stats cards (workflows, runs 24h, schedules, pending actions), recent runs, quick actions
- **Global command palette** — Ctrl+K search across all entities
- **Notification center** — Bell icon with history, unread badge, localStorage persistence
- **Template library** — 35 templates with browse, preview, one-click deploy, community publishing
- **Settings** — General, appearance, keyboard shortcuts, notification preferences, audit log settings
- **Onboarding checklist** — Progressive onboarding for new users
- **Action center** — Human-in-the-loop approvals and task queue
- **Analytics settings** — OpenSearch Dashboards integration

### Developer Experience

- **OpenAPI spec** — Auto-generated from backend routes
- **Backend client** — Generated TypeScript client from OpenAPI
- **Component SDK** — Published package for component development
- **Contracts package** — Shared type contracts between frontend/backend/worker
- **E2E test suite** — Comprehensive Playwright tests covering all major features

---

## Gap Analysis Matrix

| Feature Area                     | Status     | Current Implementation                                                       | Notes                                                                                           |
| -------------------------------- | ---------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Visual Workflow Builder**      | ✅ Present | Full ReactFlow canvas with components                                        | Mature                                                                                          |
| **Component Registry**           | ✅ Present | 25+ security + AI + core + MCP components                                    | Growing                                                                                         |
| **Template Library**             | ✅ Present | 35 templates, community publishing                                           | Well-developed                                                                                  |
| **Scheduling (CRON)**            | ✅ Present | Full CRON editor, filters, management                                        | Complete                                                                                        |
| **Webhooks**                     | ✅ Present | Editor, management page                                                      | Complete                                                                                        |
| **Secrets Management**           | ✅ Present | AES-256-GCM, versioned                                                       | Production-ready                                                                                |
| **API Keys**                     | ✅ Present | Scoped permissions                                                           | Complete                                                                                        |
| **Audit Logging**                | ✅ Present | Event-based, structured                                                      | Covers core actions                                                                             |
| **Human-in-the-Loop**            | ✅ Present | Approvals, forms, selection                                                  | Complete                                                                                        |
| **Findings Dashboard**           | ✅ Present | Cross-workflow, charts, export                                               | Recently added                                                                                  |
| **Real-time Streaming**          | ✅ Present | Terminal + events + logs                                                     | Production-ready                                                                                |
| **OAuth Integrations**           | ✅ Partial | GitHub + Zoom only                                                           | **Gap: No Jira, ServiceNow, PagerDuty, Microsoft 365 OAuth**                                    |
| **RBAC/Permissions**             | ⚠️ Partial | ADMIN/MEMBER roles only                                                      | **Gap: No granular permissions (per-workflow, per-secret, per-component)**                      |
| **Notification Channels**        | ⚠️ Partial | Slack/Jira/Notify components in workflows; browser notifications in settings | **Gap: No platform-level notification routing (Slack/Teams/PagerDuty/email for run failures)**  |
| **Reporting/Compliance**         | ❌ Absent  | No compliance reporting                                                      | **Gap: No scheduled reports, compliance dashboards, SLA tracking**                              |
| **Vulnerability Lifecycle**      | ❌ Absent  | Findings are display-only                                                    | **Gap: No status tracking (open/triaged/resolved), assignment, SLA timers**                     |
| **Incident Management**          | ❌ Absent  | No incident concept                                                          | **Gap: No incident creation from findings, incident timeline, escalation**                      |
| **Asset Inventory**              | ❌ Absent  | No asset/target tracking                                                     | **Gap: No persistent asset database for scan targets**                                          |
| **SIEM/SOC Connectors**          | ❌ Absent  | Only OpenSearch analytics sink                                               | **Gap: No Splunk, Elastic, Microsoft Sentinel, QRadar export**                                  |
| **Ticketing Integration**        | ⚠️ Partial | Jira notification component exists                                           | **Gap: No bidirectional Jira/ServiceNow sync (create tickets from findings, track resolution)** |
| **Usage Analytics/Admin**        | ❌ Absent  | No admin dashboard                                                           | **Gap: No usage metrics, user activity, resource consumption tracking**                         |
| **Workflow Collaboration**       | ❌ Absent  | Single-user editing                                                          | **Gap: No shared editing, comments, review/approval workflows for changes**                     |
| **SDK/API Documentation Portal** | ❌ Absent  | OpenAPI spec exists but no portal                                            | **Gap: No interactive API docs, component authoring guide**                                     |
| **Webhook Debugging**            | ❌ Absent  | No request inspector                                                         | **Gap: No webhook payload log/replay feature**                                                  |
| **Run Comparison**               | ❌ Absent  | Individual run views only                                                    | **Gap: No diff between runs, trend analysis over time**                                         |

---

## Gap Details with Effort/Impact Assessment

| #   | Feature                                       | Impact | Effort | Rationale                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Platform Notification Routing**             | HIGH   | S      | Security teams need Slack/email/PagerDuty alerts when scans fail or find critical vulns — not just browser notifications. Infrastructure exists (Notify component); this is about routing run lifecycle events to configured channels at the platform level, not per-workflow. |
| 2   | **Vulnerability Lifecycle Management**        | HIGH   | M      | Findings are currently view-only. Security teams need to track finding status (open → triaged → remediated → closed), assign owners, add notes, and track resolution time. Without this, teams export CSV and track in spreadsheets — a dealbreaker for production adoption.   |
| 3   | **Granular RBAC**                             | HIGH   | M      | Only ADMIN/MEMBER exists. Production teams need: viewer (read-only), operator (run but not edit), editor (edit workflows), admin (manage users/secrets). Per-workflow and per-secret access control is expected in enterprise environments.                                    |
| 4   | **Bidirectional Ticketing (Jira/ServiceNow)** | HIGH   | M      | A Jira notification component exists, but creating tickets from findings and syncing status back is the actual workflow security teams need. Findings → Jira ticket → ticket resolved → finding marked resolved. This closes the remediation loop.                             |
| 5   | **Platform-Level Reporting**                  | HIGH   | L      | Scheduled PDF/email reports showing: findings trend, scan coverage, SLA compliance, workflow success rates. Compliance officers and security managers need periodic reports without logging into the platform.                                                                 |
| 6   | **SIEM Export Connectors**                    | MEDIUM | M      | Large organizations have existing Splunk/Elastic/Sentinel deployments. Sending findings and workflow events to their SIEM is often a procurement requirement. The analytics sink pattern (OpenSearch) can be extended to support additional adapters.                          |
| 7   | **Webhook Request Inspector**                 | MEDIUM | S      | Debugging webhook integrations is currently blind — no payload log, no retry, no request inspector. A simple log of recent webhook deliveries with payload + response + status would dramatically improve DX and reduce support burden.                                        |
| 8   | **Run Comparison & Trend Analysis**           | MEDIUM | M      | "Are we finding more or fewer vulns over time?" Currently requires exporting data. A trend dashboard showing finding counts by severity over time, scan coverage progression, and run success/failure rates would make the platform sticky for security managers.              |
| 9   | **Asset Inventory**                           | MEDIUM | L      | Persistent asset database (domains, IPs, cloud accounts) that workflows scan against. Tracks what's been scanned, last scan date, associated findings count. Eliminates manual target list maintenance and enables coverage tracking.                                          |
| 10  | **Interactive API Documentation Portal**      | LOW    | S      | OpenAPI spec exists. Embedding Swagger UI or Scalar at `/docs` gives developers self-service API exploration. Low effort, moderate value for API-first users.                                                                                                                  |

---

## Prioritized Recommendations (Impact ÷ Effort)

### Rank 1: Platform Notification Routing — Impact: HIGH, Effort: S

Security teams expect Slack/email/PagerDuty alerts on critical findings and run failures without building a notification workflow for every scan. The Notify component already supports Slack/Discord/Telegram/Email — this wraps it as a platform-level setting (Settings → Notifications → Channel Configuration). The backend event system (Kafka) already emits run lifecycle events; this adds a subscriber that routes them to configured channels.

### Rank 2: Webhook Request Inspector — Impact: MEDIUM, Effort: S

Log the last 50 webhook deliveries per webhook (payload, response code, response body, timestamp) in PostgreSQL. Surface in the webhook editor as a "Recent Deliveries" tab with re-send button. Eliminates 90% of webhook debugging pain. This is a small table + API endpoint + frontend tab — 2-3 days of work.

### Rank 3: Vulnerability Lifecycle Management — Impact: HIGH, Effort: M

Add status tracking (open/triaged/in-progress/resolved/false-positive), assignee, notes, and SLA timers to findings. This transforms the findings dashboard from a report viewer into an operational tool. Requires schema changes to the findings table, API endpoints for status mutations, and UI updates to the findings page (status column, assignment dropdown, detail panel notes).

### Rank 4: Bidirectional Ticketing Integration — Impact: HIGH, Effort: M

Extend the existing Jira component to support: (a) creating tickets from findings with one click, (b) syncing ticket status back to update finding status, (c) bulk ticket creation for filtered findings. The OAuth integrations infrastructure already handles token management. ServiceNow can follow the same pattern. This is the single most requested feature in SOAR platforms.

### Rank 5: Granular RBAC — Impact: HIGH, Effort: M

Extend auth beyond ADMIN/MEMBER to include: VIEWER (read-only), OPERATOR (run workflows), EDITOR (create/edit workflows), ADMIN (full access). Add per-workflow ownership and per-secret access scoping. The `RolesGuard` infrastructure exists; this extends it with finer-grained role definitions and resource-level permission checks. Required for any multi-user team deployment.

### Rank 6: Run Comparison & Trend Analysis — Impact: MEDIUM, Effort: M

Add a dashboard widget showing findings-over-time charts, scan coverage metrics, and workflow success/failure trends. OpenSearch already stores findings with timestamps and workflow metadata — this is primarily a frontend charting feature backed by OpenSearch aggregation queries. Makes the platform valuable to security managers who care about trends, not individual run details.

### Rank 7: Platform-Level Reporting — Impact: HIGH, Effort: L

Scheduled reports (PDF/email) with findings summary, SLA compliance, scan coverage, and trend charts. Requires: report template engine, PDF generation (puppeteer/playwright), email sending, schedule management. High impact for compliance-driven organizations but significant engineering effort due to PDF rendering and email infrastructure.

---

## Summary

The platform has excellent workflow orchestration foundations — the visual builder, Temporal durability, component ecosystem, MCP integration, and real-time streaming are all mature. The biggest gaps are in **post-execution operations**: what happens after a scan completes. Security teams need findings lifecycle management, notification routing, ticketing integration, and reporting to close the loop from "scan found vulnerabilities" to "vulnerabilities are remediated."

The top 3 recommendations (notification routing, webhook inspector, vulnerability lifecycle) deliver the highest return on engineering investment. Notification routing and webhook inspector are both small efforts with outsized impact on daily usability. Vulnerability lifecycle management is the feature that converts the platform from a "scan runner" into a "security operations platform."
