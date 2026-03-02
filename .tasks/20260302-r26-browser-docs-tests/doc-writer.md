# Agent: doc-writer

## Purpose

Fix stale, inaccurate, or outdated documentation identified by the researcher's audit findings.

## Skills

Load before starting: none

## Subtasks

- [x] Read the researcher's completed task file (`.tasks/20260302-r26-browser-docs-tests/researcher.md`) to understand all findings
- [x] Fix all S0 (factually wrong/dangerous) documentation issues identified by the researcher
- [x] Fix all S1 (stale/misleading) documentation issues identified by the researcher
- [ ] Fix S2 (minor inaccuracy) issues if time permits — prioritize by user impact
- [x] For each fix, verify the correction against the actual codebase (do not introduce new inaccuracies)
- [ ] Update `docs/docs.json` if any documentation files were added, removed, or restructured
- [x] Verify all edited files render valid Markdown/MDX (no broken links, unclosed tags, or syntax errors)
- [x] Compile a summary of all files modified and changes made

## Notes

- This agent runs AFTER the researcher completes — do not start until researcher findings are available
- Focus on factual corrections, not stylistic rewrites — make minimal changes to fix accuracy issues
- If a doc references a feature that no longer exists, either remove the section or add a note that the feature has been deprecated/removed
- If a doc is missing coverage of a new feature, add a brief section but do not over-document — keep it proportional
- Follow existing documentation conventions: frontmatter format, heading hierarchy, code block language tags
- Cross-reference `AGENTS.md` for any instructions about keeping docs in sync with code changes

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
