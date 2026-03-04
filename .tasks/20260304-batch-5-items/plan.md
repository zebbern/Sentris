# Plan: Phase 1 — Quick Wins and Research (Batch of 5 Items)

## Overview

Phase 1 runs 4 parallel tracks: one frontend implementation (tool filter scoping), one documentation update, and two research spikes. All tracks are independent with no cross-dependencies, so they can execute simultaneously. The frontend task is a contained UI change; the doc and research tasks are read-only analysis producing written deliverables.

## Architecture Decisions

| Decision                                                 | Alternatives                               | Rationale                                                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filter ToolFilter by component `category === 'security'` | Hardcoded slug list; new "isScanner" field | Components already have a `category` field with a `security` category (23 components). Using the existing category avoids schema changes and stays in sync with the registry. |
| Keep research tasks as separate tracks                   | Combine into one researcher task           | KafkaJS compatibility and feature gap analysis are unrelated domains; separate tasks allow parallel execution and focused deliverables.                                       |

## Affected Files

| Action | File Path                                                      | Change Description                                                                                                                  |
| ------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| MODIFY | `frontend/src/features/findings/ToolFilter.tsx`                | Filter component list to `category === 'security'` only                                                                             |
| CREATE | `frontend/src/features/findings/__tests__/ToolFilter.test.tsx` | Unit test for filtered dropdown                                                                                                     |
| MODIFY | `AGENTS.md`                                                    | Update ARCHITECTURE section with health checks, sticky sessions, Redis sessions, Findings Dashboard v2, SSRF guard, correlation IDs |
| MODIFY | `docs/architecture.mdx`                                        | Add health check endpoints, sticky sessions, Redis session registry sections                                                        |
| MODIFY | `docs/user-guide.mdx`                                          | Add Findings Dashboard documentation                                                                                                |
| CREATE | (research output)                                              | KafkaJS compatibility report                                                                                                        |
| CREATE | (research output)                                              | Feature gap analysis report                                                                                                         |

## Phases

| Phase | Agents      | Purpose                                                          | Depends On |
| ----- | ----------- | ---------------------------------------------------------------- | ---------- |
| 1a    | implementer | Scope ToolFilter to security/scanner components                  | —          |
| 1b    | doc-writer  | Update architecture docs with recent features                    | —          |
| 1c    | researcher  | Test kafkajs alternative compatibility with Bun                  | —          |
| 1d    | researcher  | Feature gap analysis vs. common security orchestration platforms | —          |

## Dependencies

None — all 4 tracks are fully independent and can run in parallel.

## Risk Assessment

| Risk                                                      | Impact                                | Mitigation                                                                      |
| --------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| Component `category` field not available on frontend type | Blocks ToolFilter implementation      | Check `useComponents()` return type; may need backend change to expose category |
| kafkajs testing requires Bun runtime environment          | Researcher may not have Bun available | Document steps clearly so they can be reproduced manually                       |
| Architecture docs may have drifted significantly          | Doc update could be large             | Focus on the 6 specified topics; don't attempt a full rewrite                   |
