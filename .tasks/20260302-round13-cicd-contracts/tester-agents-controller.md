# Agent: tester-agents-controller

## Purpose

Write comprehensive unit tests for the agents controller at `backend/src/agents/agents.controller.ts`, covering the `GET /:agentRunId/parts` endpoint, the `POST /:agentRunId/chat` SSE endpoint, and the `convertAgentTraceToUiChunk` helper function.

## Skills

Load before starting: testing-patterns

## Subtasks

- [x] Read `backend/src/agents/agents.controller.ts` fully to understand all code paths
- [x] Read `backend/src/agents/dto/agent-stream-query.dto.ts` and `backend/src/agents/dto/agent-chat-request.dto.ts` to understand DTO validation
- [x] Read `backend/src/agent-trace/agent-trace.service.ts` to understand the service interface being mocked
- [x] Scan existing backend tests (e.g., `backend/src/**/__tests__/*.spec.ts`) to follow established test patterns (mock setup, NestJS testing module usage)
- [x] Create `backend/src/agents/__tests__/agents.controller.spec.ts`
- [x] Test `GET /parts` — returns parts for a valid `agentRunId` with no cursor (default cursor=0)
- [x] Test `GET /parts` — applies cursor parameter correctly, passes numeric cursor to `agentTraceService.list`
- [x] Test `GET /parts` — handles `NaN` cursor gracefully (falls back to undefined)
- [x] Test `GET /parts` — throws `NotFoundException` when `getRunMetadata` returns null
- [x] Test `GET /parts` — returns empty parts array when no events match
- [x] Test `GET /parts` — correctly maps events through `convertAgentTraceToUiChunk` and filters out null results
- [x] Test `GET /parts` — response shape includes `agentRunId`, `workflowRunId`, `nodeRef`, `cursor`, and `parts` array
- [x] Test `convertAgentTraceToUiChunk` — converts `message-start` type to `{ type: 'start', messageId, messageMetadata }`
- [x] Test `convertAgentTraceToUiChunk` — converts `text-start` and `data-text-start` types to `{ type: 'text-start' }`
- [x] Test `convertAgentTraceToUiChunk` — converts `text-end` and `data-text-end` types to `{ type: 'text-end' }`
- [x] Test `convertAgentTraceToUiChunk` — converts `text-delta` type with `textDelta` payload
- [x] Test `convertAgentTraceToUiChunk` — converts `finish` type with metadata (finishReason, responseText)
- [x] Test `convertAgentTraceToUiChunk` — converts `tool-input-available` and `tool-output-available` types
- [x] Test `convertAgentTraceToUiChunk` — converts `tool-input-error` and `tool-output-error` types
- [x] Test `convertAgentTraceToUiChunk` — converts `data-*` prefixed types to generic data chunks
- [x] Test `convertAgentTraceToUiChunk` — returns null for events with no `type` in payload
- [x] Test `convertAgentTraceToUiChunk` — uses `event.agentRunId` as fallback when payload has no `messageId`
- [x] Test `POST /chat` — throws `NotFoundException` when `getRunMetadata` returns null
- [x] Verify mock setup: `AgentTraceService` with mock `getRunMetadata` and `list` methods, `WorkflowsService` with mock `ensureRunAccess`

## Notes

- `convertAgentTraceToUiChunk` is a module-level function (not exported). To test it directly, either:
  - (a) Extract and export it from the module, or
  - (b) Test it indirectly through the `parts` endpoint response.
  - Prefer (b) for non-invasive testing; if coverage is insufficient, use (a) and note the source change.
- The `POST /chat` endpoint uses `createUIMessageStream` and `pipeUIMessageStreamToResponse` from the `ai` SDK. These are difficult to unit test. Focus on: metadata lookup failure (NotFoundException), access control call. Do not attempt to fully test SSE streaming mechanics — that's integration/E2E territory.
- Use NestJS `Test.createTestingModule` with mocked providers. Follow patterns from existing backend tests.
- DTOs use `nestjs-zod` ZodValidationPipe. The controller tests should focus on controller logic, not DTO validation (that's the pipe's responsibility).
- `AgentTracePartEntry` interface: `{ agentRunId, workflowRunId, nodeRef, sequence, timestamp, part }`.
- The `ensureRunAccess` method takes `(workflowRunId, auth)` — mock it to resolve without error for happy-path tests.
- Backend uses `bun test` with `.spec.ts` naming convention.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
