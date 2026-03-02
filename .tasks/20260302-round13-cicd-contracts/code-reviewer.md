# Agent: code-reviewer

## Purpose

Review all Phase 1 changes (CI workflow + two test files) for correctness, coverage gaps, and adherence to project conventions.

## Skills

Load before starting: none

## Subtasks

- [x] Review `.github/workflows/ci.yml` changes: valid YAML syntax, correct bun setup, script names match root `package.json`, appropriate timeout
- [x] Review `packages/contracts/src/__tests__/` (5 files): all exported schemas are tested, both valid and invalid inputs covered, no false-positive tests (tests that pass for wrong reasons)
- [x] Review `backend/src/agents/__tests__/agents.controller.spec.ts`: mock setup is correct, all controller branches covered, `convertAgentTraceToUiChunk` branches tested, no over-mocking that hides bugs
- [x] Check that test file naming follows project conventions (`__tests__/` folder, `.test.ts` for packages, `.spec.ts` for backend)
- [x] Check for any hardcoded or brittle test values that would break on schema changes
- [x] Verify no source code was modified beyond what was planned (only CI + test files)
- [x] Run `get_errors` on all changed files to check for TypeScript/lint errors

## Notes

- Phase 2 agent — do not start until all Phase 1 agents have completed.
- This is a read-only review agent. Do NOT modify source code files. Only edit this task tracking file.
- Flag issues with severity: S0 (blocker), S1 (should fix), S2 (nice to have).
- If `convertAgentTraceToUiChunk` was extracted/exported for testing, verify the export is minimal and doesn't leak internal APIs.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
