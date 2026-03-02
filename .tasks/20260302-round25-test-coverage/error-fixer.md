# Agent: error-fixer

## Purpose

Fix issues surfaced by the code reviewer, browser tester, and any test failures from the tester agents.

## Skills

Load before starting: testing-patterns

## Subtasks

### Test failures (from tester agents)

- [ ] Review test output from tester-utils — fix any failing tests or source code issues that cause failures
- [ ] Review test output from tester-hooks — fix any failing tests or source code issues that cause failures
- [ ] Review test output from tester-stores-lib — fix any failing tests or source code issues that cause failures

### Code review findings (from code-reviewer)

- [ ] Fix all S0 (bug/security) findings from the code review
- [ ] Fix all S1 (code quality) findings from the code review
- [ ] Address S2 (style/minor) findings if time permits — prioritize by impact

### Visual regressions (from browser-tester)

- [ ] Fix any S0 (broken layout/functionality) visual issues flagged by browser tester
- [ ] Fix any S1 (degraded experience) visual issues flagged by browser tester

### Verification

- [ ] Run `bun test` across all frontend tests to verify no regressions
- [ ] Run `bun run typecheck` to verify no type errors introduced
- [ ] Run `bun run lint` to verify no lint violations introduced

## Notes

- This agent runs LAST — it depends on outputs from all prior agents
- Specific subtasks will be refined based on actual findings from the code-reviewer and browser-tester
- When fixing test failures, prefer fixing the test if the test expectation is wrong; prefer fixing source code if the source has a bug
- When fixing code review findings, make minimal changes to address the issue — do not refactor beyond what's needed
- If a finding is a false positive or intentional design choice, document why in the completion summary rather than changing the code

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
