# Agent: researcher

## Purpose

Evaluate whether `@confluentinc/kafka-javascript` (or another kafkajs alternative) is compatible with the Bun runtime, and provide a go/no-go recommendation.

## Skills

Load before starting: none

## Subtasks

- [x] Identify the current Kafka client used in the project — search `package.json` files for `kafkajs`, `@confluentinc/kafka-javascript`, or other Kafka client packages; note the version and where it's used (likely `worker/` and/or `backend/`)
- [x] Check `@confluentinc/kafka-javascript` npm page and GitHub repo for: Bun compatibility mentions, native addon requirements (N-API/node-gyp), known issues with non-Node runtimes
- [x] Check if `@confluentinc/kafka-javascript` has open GitHub issues related to Bun — search for "bun" in their issue tracker
- [x] If promising: document the installation command and whether `bun install` succeeds without errors (note any native compilation warnings/failures)
- [x] If promising: document whether a basic `import` / `require` of the package works in Bun without runtime errors
- [x] Check for alternative Kafka clients that might work with Bun (e.g., `kafka-ts`, pure-JS implementations) — brief survey only
- [x] Document findings in a structured format: package name, install result, import result, native addon dependencies, Bun-specific issues, and any workarounds found
- [x] Provide a clear go/no-go recommendation with reasoning — if "go", note any caveats; if "no-go", suggest the best alternative or recommend staying with the current client

## Notes

- The project uses Bun as its JavaScript runtime (see `AGENTS.md` — backend uses Bun, worker uses Node.js via Temporal SDK). The Kafka client compatibility question is specifically about the Bun runtime.
- `@confluentinc/kafka-javascript` is a native wrapper around librdkafka — it uses **NAN** (NOT N-API as initially assumed) bindings which **cannot** work with Bun.
- The current setup uses Redpanda as the Kafka broker (see `docker/` compose files).
- This is a research-only task — do not modify any source code.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
