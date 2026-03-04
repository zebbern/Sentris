# Agent: code-reviewer

## Purpose

Review the notification routing implementation for code quality, correctness, and adherence to codebase conventions.

## Skills

Load before starting: none

## Subtasks

- [x] Verify the Drizzle schema in `notification-channels.ts` follows the `webhooks.ts` pattern: correct column types, proper indexes, FK constraints with cascade, type inference exports
- [x] Verify the NestJS module structure follows `webhooks.module.ts` pattern: correct imports/providers/exports
- [x] Verify the controller follows `webhooks.admin.controller.ts` pattern: correct decorators (`@ApiTags`, `@UseGuards`, `@ApiOperation`, `@ApiOkResponse`), `ParseUUIDPipe` for IDs, `ZodValidationPipe` for bodies
- [x] Verify repository classes follow `webhook.repository.ts` pattern: `@Inject(DRIZZLE_TOKEN)`, correct Drizzle query builder usage, proper filtering with `and()` + `eq()`
- [x] Verify DTOs follow `webhook.dto.ts` pattern: `createZodDto` from `nestjs-zod`, schemas imported from `@sentris/shared`
- [x] Verify service class follows `webhooks.service.ts` pattern: `requireOrganizationId()` for auth, proper error handling (NotFoundException), audit logging
- [x] Verify the event emission wiring in `workflow-run.service.ts` is non-blocking (fire-and-forget) and placed at the correct code path
- [x] Verify the dispatcher uses `@OnEvent` decorator correctly and handles errors in parallel dispatch
- [x] Verify frontend hooks follow `useWebhookQueries.ts` pattern: correct staleTime, skipToken usage, mutation invalidation
- [x] Verify frontend query keys follow `queryKeys.ts` pattern: org-scoped, factory functions
- [x] Verify the SettingsPage integration follows the admin-only tab pattern used by Audit tab
- [x] Check for unused imports, missing error handling, or incomplete implementations (no TODOs or placeholders)
- [x] Verify all shared schemas in `packages/shared/src/notifications.ts` are correctly structured and exported

## Notes

- This is a review-only agent. Do NOT modify source code files. Only edit `.tasks/` task tracking files.
- Flag findings using severity levels: S0 (critical/blocking), S1 (significant), S2 (minor/nit).
- Focus on pattern consistency with existing codebase, not style preferences.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
