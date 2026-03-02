# Agent: frontend

## Purpose

Fix S0 (broken/unusable) and S1 (degraded) visual regressions identified by the browser-tester.

## Skills

Load before starting: none

## Subtasks

- [ ] Read the browser-tester's completed task file (`.tasks/20260302-r26-browser-docs-tests/browser-tester.md`) to understand all visual regression findings
- [ ] Fix all S0 (broken/unusable) visual issues — these are the highest priority
- [ ] Fix all S1 (degraded functionality or appearance) visual issues
- [ ] For each fix, verify the correction does not break other pages or components
- [ ] If any JavaScript console errors were reported, investigate and fix the root cause
- [ ] After fixes, re-screenshot the affected pages to confirm the regressions are resolved
- [ ] Save comparison screenshots to `test-screenshots/round26/` with `-fixed` suffix
- [ ] Compile a summary of all files modified and visual issues resolved

## Notes

- This agent runs AFTER the browser-tester completes — do not start until browser-tester findings are available
- The specific files to modify depend entirely on the browser-tester's findings — this is a reactive task
- Common visual regression causes: Tailwind class changes, layout component updates, dark mode theme gaps, z-index conflicts, missing responsive breakpoints
- Follow existing frontend conventions: Tailwind for styling, component composition patterns, existing design system components in `frontend/src/components/ui/`
- Do NOT fix S2 (cosmetic) issues in this round unless they are trivially bundled with an S0/S1 fix
- Read `frontend/docs/state.md` and `frontend/docs/performance.md` before making any data-fetching or state changes

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
