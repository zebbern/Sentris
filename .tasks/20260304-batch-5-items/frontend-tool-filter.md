# Agent: implementer

## Purpose

Scope the Findings Dashboard ToolFilter dropdown to show only security scanning tools instead of all 60+ component types.

## Skills

Load before starting: none

## Subtasks

- [x] Read `frontend/src/features/findings/ToolFilter.tsx` to understand the current implementation (uses `useComponents()` to list all components)
- [x] Read the `useComponents` hook in `frontend/src/hooks/queries/useComponentQueries.ts` to understand the data shape — specifically whether `category` is available on the component objects
- [x] Check the component type/interface (likely in `packages/contracts/` or `packages/shared/`) to confirm the `category` field exists and its possible values
- [x] If `category` is available on the frontend type: filter `components` array to only include items where `category === 'security'` (these are the 23 scanner tools: Subfinder, DNSX, Nuclei, Naabu, HTTPx, TruffleHog, Trivy, Semgrep, Katana, etc.)
- [x] If `category` is NOT available on the frontend type: check if the backend `/components` endpoint returns it — if not, add it to the response and update the shared type
- [x] Confirm the "All tools" option (`value="all"`) is present at the top of the dropdown (it already exists — verify it still works after filtering)
- [x] Create a unit test at `frontend/src/features/findings/__tests__/ToolFilter.test.tsx` that verifies: (a) only security-category components appear in the dropdown, (b) the "All tools" option is present, (c) selecting a tool calls `onChange` with the correct component ID, (d) selecting "All tools" calls `onChange` with `undefined`
- [x] Run `bun run typecheck` to confirm no type errors
- [x] Run the new test to confirm it passes

## Notes

- The current `ToolFilter.tsx` is ~50 lines — it fetches all components via `useComponents()` and renders them in a `<Select>`. The only change needed is filtering the `components` array by category before rendering.
- Component categories are documented in `docs/architecture.mdx` — the `security` category has 23 components. Other categories (ai, core, mcp, it_ops, notification, manual_action, github, input, transform, output, process) should be excluded.
- Follow existing test patterns in `frontend/src/` — check nearby `__tests__/` folders for conventions.
- Use TanStack Query patterns per `AGENTS.md` rules — the `useComponents()` hook is already the correct data source.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
