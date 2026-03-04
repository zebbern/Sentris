# Agent: security-reviewer

## Purpose

Review the notification routing implementation for security vulnerabilities, with focus on SSRF prevention, access control, sensitive data handling, and input validation.

## Skills

Load before starting: none

## Subtasks

- [x] Verify SSRF validation in `slack.adapter.ts`: scheme must be HTTPS, hostname must resolve to public IPs only (reject 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16, ::1, fc00::/7, fe80::/10), domain must match `hooks.slack.com` or `hooks.slack-gov.com`
- [x] Verify DNS rebinding protection: hostname resolution should happen at validation time and the resolved IP should be used for the HTTP request (TOCTOU prevention), or the domain allowlist makes this sufficient
- [x] Verify all notification channel endpoints require authentication (`AuthGuard`) and admin role authorization
- [x] Verify `config.webhookUrl` is masked in GET/list responses — full URL should never be returned after initial create
- [x] Verify Zod input validation on all request DTOs: name length limits, URL format validation, enum constraints for type and event types, config shape validation per channel type
- [x] Verify Slack webhook payloads do not leak sensitive data (no secrets, tokens, or PII in the Block Kit message)
- [x] Verify the event emission does not expose internal system details to the notification payload (e.g., temporal run IDs, internal error stack traces)
- [x] Verify cascade delete on `notification_deliveries.channelId` FK does not cause unintended data loss beyond the expected scope
- [x] Verify the `testChannel` endpoint cannot be abused for SSRF (same validation as production dispatch)
- [x] Verify no SQL injection vectors in repository JSONB queries (especially the `findActiveByEventType` array containment query)
- [x] Check that error messages in delivery records do not expose internal system paths, IP addresses, or stack traces

## Notes

- This is a review-only agent. Do NOT modify source code files. Only edit `.tasks/` task tracking files.
- Flag findings using severity levels: S0 (critical/blocking), S1 (significant), S2 (minor/nit).
- The SSRF validation is the highest-priority security concern. Slack incoming webhooks use HTTPS POST to `hooks.slack.com` — the domain allowlist approach is the strongest defense.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
