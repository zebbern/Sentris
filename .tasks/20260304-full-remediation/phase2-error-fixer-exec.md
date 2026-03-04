# Agent: error-fixer (exec→spawn Migration)

## Purpose

Replace all remaining `exec()` / `execAsync()` calls in MCP activity files with `execFile()` using array arguments to eliminate shell injection surface in Docker command execution.

## Skills

Load before starting: none

## Subtasks

### mcp.activity.ts — 4 execAsync calls

- [x] Read `worker/src/temporal/activities/mcp.activity.ts` fully to understand all `execAsync()` call sites and their context
- [x] Replace the `execAsync('docker ps -a --filter "name=mcp-server-" --format "{{.Names}}"')` call (~line 128) with `execFileAsync('docker', ['ps', '-a', '--filter', 'name=mcp-server-', '--format', '{{.Names}}'])` — use `promisify(execFile)` instead of `promisify(exec)`
- [x] Replace the `execAsync('docker rm -f ${containerId}')` call (~line 164) with `execFileAsync('docker', ['rm', '-f', containerId])` — the container ID is already validated with `/^[a-zA-Z0-9_.-]+$/` regex but execFile adds defense-in-depth
- [x] Replace the `execAsync('docker volume ls --filter "label=studio.managed=true" --filter "label=studio.run=${input.runId}" --format "{{.Name}}"')` call (~line 179) with `execFileAsync('docker', ['volume', 'ls', '--filter', 'label=studio.managed=true', '--filter', \`label=studio.run=${input.runId}\`, '--format', '{{.Name}}'])` — the runId is already validated with regex
- [x] Replace the `execAsync('docker volume rm ${volumeName}')` call (~line 198) with `execFileAsync('docker', ['volume', 'rm', volumeName])` — the volume name is already validated with regex
- [x] Update the import at the top of the file: change `const { exec } = await import('node:child_process')` to `const { execFile } = await import('node:child_process')` and create `const execFileAsync = promisify(execFile)`

### mcp-discovery.activity.ts — 1 execAsync call

- [x] Read `worker/src/temporal/activities/mcp-discovery.activity.ts` `cleanupContainer()` function (~line 475-494) to understand the exec call
- [x] Replace the `execAsync('docker rm -f ${containerId}')` call (~line 489) with `execFileAsync('docker', ['rm', '-f', containerId])` — the container ID is validated with `/^[a-zA-Z0-9_.-][a-zA-Z0-9_.-]*$/` regex
- [x] Update the dynamic import: change `const { exec } = await import('node:child_process')` to `const { execFile } = await import('node:child_process')` and create `const execFileAsync = promisify(execFile)`

### Verification

- [x] Verify the `{ stdout }` destructuring still works with `execFileAsync` — `promisify(execFile)` returns `{ stdout, stderr }` just like `promisify(exec)`, so the destructuring is compatible
- [x] Verify that the regex-based container ID / volume name / runId validation is preserved (do NOT remove it — it serves as defense-in-depth alongside the execFile migration)
- [x] Run `bun test --cwd worker` to check for regressions in worker tests
- [x] Search for any other `exec(` or `execAsync(` calls in the worker directory that may also need migration: `grep -r "exec(" worker/src/ --include="*.ts"`. If additional calls are found, migrate them too and note as additional work.

## Notes

- The key security difference: `exec()` spawns a shell (`/bin/sh -c "command"`) which interprets shell metacharacters. `execFile()` invokes the binary directly with an argv array, bypassing the shell entirely.
- Both files currently use dynamic imports (`await import('node:child_process')`) because they run inside Temporal activities. Preserve this pattern.
- The existing input validation (regex checks on containerId, runId, volumeName) should NOT be removed. It's defense-in-depth — the regex prevents invalid values from being passed even without shell interpretation. The combination of validation + execFile provides layers of protection.
- The `{ stdout }` return type from `promisify(execFile)` is identical to `promisify(exec)`, so all existing stdout parsing logic (`.split('\n').map(...).filter(...)`) works without changes.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
