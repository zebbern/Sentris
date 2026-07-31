# Agent Capability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long autonomous security-investigation agents run for their intended duration, fail transparently when requested MCP tools are unavailable, expose an exact per-workflow MCP toolset, and give OpenCode the same durable replay identity as the other agents.

**Architecture:** A pure worker-side execution-profile module is the single source of truth for agent activity duration, container duration, MCP token lifetime, compute limits, and default AI SDK step budget. The workflow selects its Temporal activity timeout deterministically from the component ID and saved parameters. MCP tool selection remains graph-scoped, with per-workflow exclusions applied before registration and global tool enablement intersected at runtime. Agent components share a small gateway-access helper that implements required versus best-effort behavior.

**Tech Stack:** TypeScript, Bun tests, Zod component definitions, Temporal TypeScript SDK, NestJS, Redis MCP registry, React, TanStack Query.

**Status:** Completed on `main` on 2026-07-31. Final verification passed 81 focused worker tests, 28 focused backend tests, 11 focused frontend tests, all three package typechecks, live instance-0 health checks, and a browser acceptance pass. The browser verified the agent profile/availability controls and the Custom MCP `Enabled Tools` field; instance 0 had no MCP servers configured, so exact checkbox behavior was covered by the focused frontend tests instead of seeded production-like data.

## Global Constraints

- Work directly on `main`, as explicitly requested by the user; do not create another branch or worktree.
- Preserve `backend/.env.docker`, `.cursor/`, `.playwright-mcp/`, and any unrelated user edits. Stage only task-owned files.
- Do not push. Use DCO conventional commits only after each independently reviewed task.
- Optimize for product capability and useful autonomous investigations. Do not add broad security hardening or new restrictive defaults.
- `investigate` is the default profile. Exact profile values are:
  - `fast`: activity `10 minutes`, container `600` seconds, MCP token `900` seconds, `512m`, `1` CPU, `256` PIDs, `8` default AI SDK steps.
  - `investigate`: activity `45 minutes`, container `2700` seconds, MCP token `3600` seconds, `2g`, `2` CPUs, `512` PIDs, `24` default AI SDK steps.
  - `deep`: activity `135 minutes`, container `7200` seconds, MCP token `10800` seconds, `4g`, `4` CPUs, `1024` PIDs, `64` default AI SDK steps.
- `toolAvailability` values are `required` and `best-effort`; default is `required`.
- Existing explicit `stepLimit` values remain authoritative. New unsaved/default behavior derives from the execution profile and permits explicit values from `1` through `128`.
- Per-workflow MCP exclusion keys use `${serverId}:${toolName}` so duplicate tool names on different servers remain independent.
- Global MCP tool disablement is an execution policy: if a server has persisted tool records, only records whose `enabled` flag is true may be registered. If it has no persisted records yet, runtime discovery remains usable.
- Use existing dependencies only.
- Follow TDD for behavior changes: add the focused test, run it and observe the intended failure, implement the minimum change, then run it green.
- Verification is proportional: focused tests for changed modules, package typechecks, `git diff --check`, and one browser pass for the workflow configuration UI. Do not run unrelated full E2E/security suites.

---

### Task 1: Agent execution profiles and Temporal deadline alignment

**Files:**

- Create: `worker/src/components/ai/agent-execution-profile.ts`
- Create: `worker/src/components/ai/__tests__/agent-execution-profile.test.ts`
- Modify: `worker/src/components/ai/ai-agent.ts`
- Modify: `worker/src/components/ai/opencode.ts`
- Modify: `worker/src/components/ai/claude-code-agent.ts`
- Modify: `worker/src/temporal/workflows/index.ts`
- Create: `worker/src/temporal/__tests__/agent-activity-timeout.test.ts`

**Interfaces:**

- Produces:
  - `AgentExecutionProfile = 'fast' | 'investigate' | 'deep'`
  - `DEFAULT_AGENT_EXECUTION_PROFILE = 'investigate'`
  - `AGENT_EXECUTION_PROFILE_OPTIONS`
  - `resolveAgentExecutionProfile(value: unknown): AgentExecutionProfile`
  - `getAgentExecutionProfileConfig(value: unknown): AgentExecutionProfileConfig`
  - `getActivityStartToCloseTimeout(componentId: string, params: Record<string, unknown>): string`
- Consumers: all three agent components and the main workflow activity proxy.

- [x] **Step 1: Write the profile mapping tests**

  Assert all exact values from Global Constraints, unknown values resolving to `investigate`, non-agent components resolving to `10 minutes`, and all three agent component IDs resolving to the saved profile duration.

- [x] **Step 2: Run the profile tests and confirm RED**

  Run:

  ```powershell
  bun test worker/src/components/ai/__tests__/agent-execution-profile.test.ts worker/src/temporal/__tests__/agent-activity-timeout.test.ts
  ```

  Expected: failure because the module and timeout helper do not exist.

- [x] **Step 3: Implement the pure profile module**

  Define the exact immutable mapping:

  ```ts
  export const AGENT_EXECUTION_PROFILES = {
    fast: {
      activityTimeout: '10 minutes',
      runnerTimeoutSeconds: 600,
      mcpTokenTtlSeconds: 900,
      memoryLimit: '512m',
      cpuLimit: '1',
      pidsLimit: 256,
      defaultStepLimit: 8,
    },
    investigate: {
      activityTimeout: '45 minutes',
      runnerTimeoutSeconds: 2700,
      mcpTokenTtlSeconds: 3600,
      memoryLimit: '2g',
      cpuLimit: '2',
      pidsLimit: 512,
      defaultStepLimit: 24,
    },
    deep: {
      activityTimeout: '135 minutes',
      runnerTimeoutSeconds: 7200,
      mcpTokenTtlSeconds: 10800,
      memoryLimit: '4g',
      cpuLimit: '4',
      pidsLimit: 1024,
      defaultStepLimit: 64,
    },
  } as const;
  ```

  Keep the module free of filesystem, environment, network, clock, and random access so importing it into workflow code is deterministic.

- [x] **Step 4: Add the visible component parameter and apply runner limits**

  Add the same `executionProfile` enum parameter to `core.ai.agent`, `core.ai.opencode`, and `core.ai.claude-code`, defaulting to `investigate`.

  For Docker agents, construct the per-run runner with:

  ```ts
  timeoutSeconds: profile.runnerTimeoutSeconds,
  memoryLimit: profile.memoryLimit,
  cpuLimit: profile.cpuLimit,
  pidsLimit: profile.pidsLimit,
  ```

  Existing `OPENCODE_TIMEOUT_SECONDS` and `CLAUDE_CODE_TIMEOUT_SECONDS` environment variables may override only `timeoutSeconds` when explicitly present; profile compute limits still apply.

  Change AI SDK `stepLimit` to optional with range `1..128`, then use:

  ```ts
  const effectiveStepLimit = stepLimit ?? profile.defaultStepLimit;
  ```

- [x] **Step 5: Select the Temporal activity timeout from saved parameters**

  In the normal action path, replace the fixed `10 minutes` proxy value with:

  ```ts
  startToCloseTimeout: getActivityStartToCloseTimeout(action.componentId, mergedParams),
  ```

  Do not change activity order, signals, queries, or the existing `135 minutes` for-each body proxy.

- [x] **Step 6: Run focused tests and worker typecheck**

  ```powershell
  bun test worker/src/components/ai/__tests__/agent-execution-profile.test.ts worker/src/temporal/__tests__/agent-activity-timeout.test.ts worker/src/components/ai/__tests__/ai-agent.test.ts worker/src/components/ai/__tests__/opencode.test.ts worker/src/components/ai/__tests__/claude-code-agent.test.ts
  bun --cwd=worker run typecheck
  ```

  Expected: zero failures.

---

### Task 2: Explicit MCP dependency behavior and aligned lifetimes

**Files:**

- Create: `worker/src/components/ai/agent-tool-access.ts`
- Create: `worker/src/components/ai/__tests__/agent-tool-access.test.ts`
- Modify: `worker/src/components/ai/utils.ts`
- Modify: `worker/src/components/ai/ai-agent.ts`
- Modify: `worker/src/components/ai/opencode.ts`
- Modify: `worker/src/components/ai/claude-code-agent.ts`
- Modify: `worker/src/components/ai/agent-runner-utils.ts`
- Modify: `backend/src/mcp/dto/mcp.dto.ts`
- Modify: `backend/src/mcp/internal-mcp.controller.ts`
- Modify: `backend/src/mcp/mcp-auth.service.ts`
- Create: `backend/src/mcp/__tests__/mcp-auth.service.spec.ts`
- Modify: `backend/src/mcp/__tests__/mcp-internal.integration.spec.ts`
- Modify: `backend/src/mcp/tool-registry.service.ts`
- Modify: `backend/src/mcp/__tests__/tool-registry.service.spec.ts`

**Interfaces:**

- Consumes: Task 1 `getAgentExecutionProfileConfig`.
- Produces:
  - `AgentToolAvailability = 'required' | 'best-effort'`
  - `prepareAgentGatewayAccess(...)`
  - consistent `toolStatus` output with `requested`, `status`, `connectedNodeCount`, `availableToolCount?`, and `message?`
  - internal token request field `ttlSeconds`.

- [x] **Step 1: Write failing backend TTL tests**

  Assert that the internal controller forwards `ttlSeconds`, `McpAuthService` defaults to `3600`, clamps requested TTL to `60..10800`, and the tool registry uses `10800` seconds for run/tool keys.

- [x] **Step 2: Run backend tests and confirm RED**

  ```powershell
  bun test backend/src/mcp/__tests__/mcp-auth.service.spec.ts backend/src/mcp/__tests__/mcp-internal.integration.spec.ts backend/src/mcp/__tests__/tool-registry.service.spec.ts
  ```

  Expected: missing TTL DTO/controller forwarding, missing clamping, and old registry TTL.

- [x] **Step 3: Implement bounded profile-driven TTL**

  Add `ttlSeconds?: number` to `GenerateTokenInput`, forward it after `allowedNodeIds`, clamp within `McpAuthService`, and change `REGISTRY_TTL_SECONDS` to `3 * 60 * 60`.

  Extend:

  ```ts
  getGatewaySessionToken(runId, organizationId, connectedToolNodeIds, ttlSeconds);
  ```

  and include `ttlSeconds` in the internal JSON body.

- [x] **Step 4: Write failing worker gateway behavior tests**

  Cover:

  - no connected nodes → `not-requested`, no token request;
  - token success → `configured`;
  - token failure + `required` → `ConfigurationError`;
  - token failure + `best-effort` → `degraded` with a user-readable message;
  - AI SDK discovery returning zero tools + `required` → failure;
  - best-effort degradation is included in the generated agent prompt/status output.

- [x] **Step 5: Run worker tests and confirm RED**

  ```powershell
  bun test worker/src/components/ai/__tests__/agent-tool-access.test.ts worker/src/components/ai/__tests__/ai-agent.test.ts worker/src/components/ai/__tests__/opencode.test.ts worker/src/components/ai/__tests__/claude-code-agent.test.ts worker/src/components/ai/__tests__/agent-runner-utils.test.ts
  ```

- [x] **Step 6: Implement shared explicit tool availability**

  Add `toolAvailability` to all agent parameter schemas. Use `prepareAgentGatewayAccess` in all agents and pass the profile MCP TTL.

  Required mode must fail when a connected gateway cannot be configured. AI SDK required mode must also fail if discovery returns zero tools.

  Best-effort mode must continue, emit warning progress, return `toolStatus.status = 'degraded'`, and add this prompt section:

  ```text
  # Tool Availability
  Connected MCP tools are unavailable for this run: <reason>.
  Continue with built-in capabilities and state this limitation in the final result.
  ```

  Add the same `toolStatus` output shape to all three agents.

- [x] **Step 7: Run focused tests and typechecks**

  ```powershell
  bun test backend/src/mcp/__tests__/mcp-auth.service.spec.ts backend/src/mcp/__tests__/mcp-internal.integration.spec.ts backend/src/mcp/__tests__/tool-registry.service.spec.ts
  bun test worker/src/components/ai/__tests__/agent-tool-access.test.ts worker/src/components/ai/__tests__/ai-agent.test.ts worker/src/components/ai/__tests__/opencode.test.ts worker/src/components/ai/__tests__/claude-code-agent.test.ts worker/src/components/ai/__tests__/agent-runner-utils.test.ts
  bun --cwd=backend run typecheck
  bun --cwd=worker run typecheck
  ```

  Expected: zero failures.

---

### Task 3: Exact per-workflow MCP tool selection and runtime enforcement

**Files:**

- Modify: `worker/src/components/core/mcp-library.ts`
- Modify: `worker/src/components/core/mcp-library-utils.ts`
- Modify: `worker/src/components/core/__tests__/mcp-library-utils.test.ts`
- Modify: `worker/src/components/core/__tests__/mcp-library.integration.test.ts`
- Modify: `frontend/src/components/workflow/McpLibraryToolSelector.tsx`
- Modify: `frontend/src/components/workflow/McpLibraryConfig.tsx`
- Modify: `frontend/src/components/workflow/ParameterField.tsx`
- Create: `frontend/src/components/workflow/__tests__/McpLibraryToolSelector.test.tsx`
- Modify: `frontend/src/components/workflow/__tests__/ParameterField.security.test.tsx`

**Interfaces:**

- Produces:
  - `mcp.custom.params.toolExclusions: string[]`
  - exclusion key helper `${serverId}:${toolName}`
  - worker filtering that intersects live discovery, global enabled records, and workflow exclusions before Redis registration.

- [x] **Step 1: Write worker filtering tests**

  Add tests proving:

  - disabled persisted tools are removed;
  - workflow exclusion removes only the matching server/tool pair;
  - another server with the same tool name remains;
  - no persisted records means live discovery remains usable;
  - zero tools after filtering throws a clear error and is handled by existing `continueOnServerError`.

- [x] **Step 2: Run worker tests and confirm RED**

  ```powershell
  bun test worker/src/components/core/__tests__/mcp-library-utils.test.ts worker/src/components/core/__tests__/mcp-library.integration.test.ts
  ```

- [x] **Step 3: Implement worker-side exact filtering**

  Add a Zod-validated fetch of `/mcp-servers/tools` using the same internal token and organization headers already used for server/config access.

  Filter in this order:

  ```text
  live-discovered tools
    ∩ persisted enabled tools (only when persisted records exist for that server)
    − workflow toolExclusions
  ```

  Register only the final list. Add the `toolExclusions` parameter to `mcp.custom` with an empty-array default.

- [x] **Step 4: Write frontend selector tests**

  Cover selected-server-only rendering, global disabled tools shown unavailable, `${serverId}:${toolName}` exclusion keys, same-name independence across servers, and `ParameterField` updating `toolExclusions` through `onUpdateParameter`.

- [x] **Step 5: Run frontend tests and confirm RED**

  ```powershell
  bun test frontend/src/components/workflow/__tests__/McpLibraryToolSelector.test.tsx frontend/src/components/workflow/__tests__/ParameterField.security.test.tsx
  ```

- [x] **Step 6: Wire the tool selector into the existing MCP configuration**

  Refocus `McpLibraryToolSelector` on:

  ```ts
  interface McpLibraryToolSelectorProps {
    selectedServerIds: string[];
    toolExclusions: string[];
    onToolExclusionsChange: (exclusions: string[]) => void;
    disabled?: boolean;
  }
  ```

  Render it once for the `toolExclusions` parameter. Show only selected/enabled servers, group tools below each server, make global-disabled tools non-interactive, and display the final enabled-tool count. Keep API data in existing TanStack Query hooks.

- [x] **Step 7: Run focused tests and package typechecks**

  ```powershell
  bun test worker/src/components/core/__tests__/mcp-library-utils.test.ts worker/src/components/core/__tests__/mcp-library.integration.test.ts
  bun test frontend/src/components/workflow/__tests__/McpLibraryToolSelector.test.tsx frontend/src/components/workflow/__tests__/ParameterField.security.test.tsx
  bun --cwd=worker run typecheck
  bun --cwd=frontend run typecheck
  ```

  Expected: zero failures.

---

### Task 4: OpenCode durable trace identity parity

**Files:**

- Modify: `worker/src/components/ai/opencode.ts`
- Modify: `worker/src/components/ai/__tests__/opencode.test.ts`

**Interfaces:**

- Consumes: existing `AgentStreamRecorder`.
- Produces: `agentRunId` output and replayable message lifecycle matching Claude Code’s post-completion trace behavior.

- [x] **Step 1: Write the failing OpenCode trace test**

  Assert that a successful execution:

  - returns `agentRunId` in the `${runId}:${componentRef}:<uuid>` form;
  - emits message start, text delta(s), and finish;
  - emits progress with `agentStatus: running` then `completed`;
  - settles trace publication before workspace cleanup.

- [x] **Step 2: Run the test and confirm RED**

  ```powershell
  bun test worker/src/components/ai/__tests__/opencode.test.ts
  ```

- [x] **Step 3: Implement trace parity**

  Create `AgentStreamRecorder` before execution, emit the final sanitized report in bounded `16_000` character chunks, add the `agentRunId` output, emit lifecycle progress, and call `settleWithoutChangingExecution()` in `finally`.

  Do not add unverified OpenCode CLI streaming flags. Real incremental CLI tool-event streaming remains a later adapter task.

- [x] **Step 4: Run the focused agent tests and worker typecheck**

  ```powershell
  bun test worker/src/components/ai/__tests__/opencode.test.ts worker/src/components/ai/__tests__/agent-stream-recorder.test.ts
  bun --cwd=worker run typecheck
  ```

  Expected: zero failures.

---

### Task 5: Integrated verification and browser acceptance

**Files:**

- Modify only if verification reveals a task-owned defect.

**Interfaces:**

- Consumes all previous tasks.
- Produces fresh evidence for handoff.

- [x] **Step 1: Run the changed-area automated checks**

  ```powershell
  bun test worker/src/components/ai/__tests__/agent-execution-profile.test.ts worker/src/components/ai/__tests__/agent-tool-access.test.ts worker/src/components/ai/__tests__/ai-agent.test.ts worker/src/components/ai/__tests__/opencode.test.ts worker/src/components/ai/__tests__/claude-code-agent.test.ts worker/src/components/ai/__tests__/agent-runner-utils.test.ts worker/src/components/ai/__tests__/agent-stream-recorder.test.ts worker/src/components/core/__tests__/mcp-library-utils.test.ts worker/src/components/core/__tests__/mcp-library.integration.test.ts
  bun test backend/src/mcp/__tests__/mcp-auth.service.spec.ts backend/src/mcp/__tests__/mcp-internal.integration.spec.ts backend/src/mcp/__tests__/tool-registry.service.spec.ts
  bun test frontend/src/components/workflow/__tests__/McpLibraryToolSelector.test.tsx frontend/src/components/workflow/__tests__/ParameterField.security.test.tsx
  bun --cwd=worker run typecheck
  bun --cwd=backend run typecheck
  bun --cwd=frontend run typecheck
  git diff --check
  ```

- [x] **Step 2: Perform one browser acceptance pass on active instance 0**

  At `http://localhost:5173/workflows/new`:

  - add an AI SDK, Claude Code, or OpenCode agent and confirm `Execution Profile` and `Tool Availability` are visible;
  - add Custom MCPs, select a configured server, and confirm exact tools can be included/excluded;
  - confirm the selected tool count updates and no unrelated layout regression is visible.

- [x] **Step 3: Review scope and security observations**

  Confirm no unrelated user files are staged, no new dependency was added, and the diff does not add blanket capability restrictions. Record but do not expand scope for the previously identified runtime SSRF/stdio isolation concerns.
