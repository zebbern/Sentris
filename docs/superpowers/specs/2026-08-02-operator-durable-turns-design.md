# Durable Operator Turns

**Status:** Approved for implementation
**Date:** 2026-08-02

## Outcome

Sentris gets an in-app Operator where an authenticated user can ask about existing
workflows and runs, launch an existing workflow, follow it to completion, and receive a
compact result summary. Operator state survives page reloads and worker restarts, every
product command is recorded, and the user can choose between:

- `ask`: reads and an explicit request to run an existing workflow execute immediately;
  consequential commands wait for approval.
- `auto`: supported commands execute without an approval prompt.

The first consequential command is run cancellation. Finding triage and MCP invocation
will be added through the same command boundary after this vertical slice is proven.

## Architecture

Postgres owns the long-lived user experience. One `operatorTurnWorkflow` owns each user
turn; there is no long-lived workflow for the whole chat session.

```text
Operator page
  -> backend session/turn API
     -> Postgres session, turn, message, action rows
     -> Temporal operatorTurnWorkflow
        -> one model request activity
        -> prepare typed command through backend
        -> optional durable approval Update
        -> execute through existing backend domain service
        -> durable run observer for launched workflows
        -> persist final assistant message
```

This makes ownership explicit:

- session ownership is per organization and per user;
- turn ownership is per session;
- action ownership is per turn and uses a unique model tool-call identity;
- workflow runs remain owned by their existing organization/run lifecycle;
- secrets stay organization-scoped and are resolved only inside worker activities.

No prompt, credential value, or full workflow result is placed in Temporal input or
memo. Temporal receives stable IDs and bounded command results. Postgres stores bounded
conversation text and action summaries; workflow results remain in their existing
canonical stores.

## Persistent model

- `operator_sessions`: organization, user, title, approval mode, provider/model, API-key
  secret reference, optional base URL, timestamps.
- `operator_turns`: session, status, Temporal workflow/run IDs, route context, error,
  timestamps.
- `operator_messages`: session, turn, role, monotonic sequence, bounded text, timestamp.
- `operator_actions`: turn, tool-call ID, command name, effect and approval-mode snapshot,
  validated arguments, status/version, bounded result or error, linked run ID, timestamps.

All public lookups include both `organizationId` and `userId`. Internal worker routes
require `InternalOnlyGuard` and recover the original session actor from the stored
session; callers cannot supply a different actor to execute a command.

## Typed command registry

The initial registry contains only fully wired commands:

| Command          | Effect        | Ask mode                                                                | Canonical service                           |
| ---------------- | ------------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| `list_workflows` | read          | immediate                                                               | `WorkflowsService.listSummary`              |
| `get_workflow`   | read          | immediate                                                               | `WorkflowsService.findById`                 |
| `list_runs`      | read          | immediate                                                               | `WorkflowsService.listRuns`                 |
| `get_run`        | read          | immediate                                                               | `WorkflowsService.getRun` / status / result |
| `run_workflow`   | execute       | immediate when explicitly selected by the model from the user's request | `WorkflowsService.run`                      |
| `cancel_run`     | consequential | approval required                                                       | `WorkflowsService.cancelRun`                |

Each command owns a Zod input schema, description, effect category, and exhaustive
backend handler. The model can propose only these names. The action UUID is passed as
the workflow-run idempotency key, so activity retries cannot create another run.
Preparation also serializes non-read actions per turn and reuses an existing action with
the same validated command and arguments. A model repeating the same mutation on a later
reasoning step therefore cannot create another run; genuinely different arguments remain
distinct actions, and reads remain refreshable.

## Turn lifecycle

1. The backend transactionally creates a queued turn and user message, then starts
   `operatorTurnWorkflow` using `operator-turn:<sessionId>:<turnId>`.
2. A model activity loads bounded context from the internal backend API, resolves the
   stored model credential through the worker secret adapter, and makes one AI SDK
   `generateText` request with non-executing tools.
3. For each tool call, the workflow prepares an idempotent action. Invalid arguments are
   persisted as a failed action and returned to the next model step.
4. A pending action waits for a keyed `operatorActionDecision` Workflow Update. The
   handler is installed before the first activity, so early decisions are retained. A
   periodic idempotent prepare check reconciles the committed Postgres decision if Update
   delivery fails after the decision transaction.
5. Execution calls the backend registry. Read and write behavior therefore uses existing
   organization filters, lifecycle handling, and domain audit events.
6. A launched workflow is observed by a heartbeating activity until terminal. Its terminal
   observation is persisted back onto the durable action for reloads. Cancelling the
   Operator turn does not cancel that run.
7. The next model step receives the bounded command result. A response without tool calls
   is persisted as the final assistant message and completes the turn.

The loop has a finite step budget. Activity writes and finalization are idempotent by
turn/action identity. A model request may be billed twice if a worker dies after the
provider accepted it but before the activity result is recorded; eliminating that small
window requires provider-specific idempotency or a persisted model-attempt protocol and
is not allowed to hold up the useful product slice.

## API and UI

Public API:

- `GET/POST /api/v1/operator/sessions`
- `GET/PATCH /api/v1/operator/sessions/:sessionId`
- `POST /api/v1/operator/sessions/:sessionId/turns`
- `POST /api/v1/operator/actions/:actionId/decision`

The session detail response is the durable projection used for reconnect and polling.
No second chat-state store is introduced.

The frontend adds a lazy `/operator/:sessionId?` page and an Operator sidebar entry. The
page uses TanStack Query for session data, a compact session rail, a message/action
timeline, provider/model/secret setup, the two-mode selector, approval controls, and
links to existing run pages. The first slice polls only while a turn is active; token
streaming is deliberately deferred because it adds no command capability.

## Current upstream decision

Temporal now publishes an official `@temporalio/ai-sdk` integration and sample, but the
current official sample targets Temporal SDK 1.20 while this repository is on 1.14.1.
Adopting it here would combine a cross-repository Temporal upgrade with a new product
surface before the ADR's replay, cancellation, streaming, and MCP acceptance gates have
been exercised. This slice therefore uses ordinary Temporal workflows/activities and
the already-installed Vercel AI SDK 6. The command and persistence boundaries are kept
independent so the model activity can move to the official integration later without
changing the Operator API or domain handlers.

Primary references:

- <https://github.com/temporalio/sdk-typescript>
- <https://github.com/temporalio/samples-typescript/tree/main/ai-sdk>
- <https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text>

## Acceptance examples

1. A user creates a Gemini-backed session from a stored secret, sends “show my
   workflows,” reloads, and sees the same request and response.
2. In Ask mode, “run workflow X” creates exactly one run, displays its live/terminal
   state, and produces a final summary even if the worker activity retries.
3. In Ask mode, “cancel run X” displays a pending action; approval resumes the same turn
   and rejection leaves the run untouched.
4. In Auto mode, the same cancellation command executes without the approval card.
5. Another user or organization cannot list, open, mutate, or approve the session.
6. Audit history links session creation, mode changes, turn submission, action proposal,
   decision/execution, and the existing workflow-run domain audit without storing prompt
   text or credential values in audit metadata.

## Deferred through the same boundary

- finding list/detail and triage commands;
- immutable MCP capability selection and durable invocation;
- workflow editing/building commands;
- token streaming and notifications;
- Continue-As-New for a future long-lived session workflow, if one is ever justified;
- a coordinated Temporal 1.20+ and official AI SDK integration evaluation.
