# Agent: implementer (Nginx Consistent Hash Config)

## Purpose

Configure Nginx to route MCP and Studio-MCP requests to a consistent-hash upstream based on the `mcp_affinity` cookie, while keeping all other routes on the existing round-robin upstream.

## Skills

Load before starting: none

## Subtasks

### Dev config (`docker/nginx/nginx.dev.conf`)

- [x] Add a `map $cookie_mcp_affinity $mcp_affinity_key` block in the `http {}` context (after the existing `map $http_upgrade` block). Map the cookie value to `$mcp_affinity_key`; when the cookie is absent (empty string), fall back to `$remote_addr` so first-time requests still distribute and don't all hash to the same key
- [x] Add a new `upstream backend_mcp` block with `hash $mcp_affinity_key consistent;` and the same `server host.docker.internal:3211;` entry as the existing `backend` upstream. Include a comment that in multi-instance dev mode, additional backend instances can be added here
- [x] Add a dedicated `location /api/v1/mcp/` block (before the generic `/api/v1/` block) that proxies to `http://backend_mcp` instead of `http://backend`. Include the same proxy headers, WebSocket upgrade support, timeouts, `proxy_buffering off`, and CORS headers as the existing `/api/v1/` block. Add a comment explaining this is the sticky-session MCP route
- [x] Add a dedicated `location /api/v1/studio-mcp/` block (before the generic `/api/v1/` block) that also proxies to `http://backend_mcp`. Same proxy settings as the MCP location block
- [x] Verify the existing `location /api/v1/` block still handles all non-MCP API routes via round-robin (no changes needed to it, just confirm the more-specific MCP locations take priority)

### Prod config (`docker/nginx/nginx.prod.conf`)

- [x] Add the same `map $cookie_mcp_affinity $mcp_affinity_key` block in the `http {}` context
- [x] Add a new `upstream backend_mcp` block with `hash $mcp_affinity_key consistent;` and `server backend:3211;` (matches the existing prod `backend` upstream server name)
- [x] Add dedicated `location /api/v1/mcp/` and `location /api/v1/studio-mcp/` blocks that proxy to `http://backend_mcp`. Include proxy headers, WebSocket/SSE support, timeouts, `proxy_buffering off`, and the same security response headers already present in the prod config
- [x] Ensure the prod MCP location blocks do NOT include the dev-only CORS headers (prod relies on same-origin or the frontend proxy)

### Validation

- [x] Verify both configs parse correctly: the Nginx container should start without syntax errors. Include a brief comment at the top of each new block referencing the sticky-session ADR

## Notes

- The `mcp_affinity` cookie is set by the backend controllers (separate implementer track). Nginx only reads it — it never sets or modifies the cookie.
- The `map` fallback to `$remote_addr` ensures first requests (before the cookie exists) still get reasonable distribution rather than all hashing to an empty string.
- In dev mode, only instance 0 is behind Nginx (see the multi-instance comment in dev config). The `upstream backend_mcp` block initially has one server; multi-instance users access their backend directly on its port.
- The `consistent` keyword uses the ketama algorithm for minimal redistribution when backends change.
- Existing location blocks: `/analytics/`, `/_auth`, `/auth/validate`, `/api/v1/`, `/`. The new `/api/v1/mcp/` and `/api/v1/studio-mcp/` blocks must be placed before `/api/v1/` because Nginx prefix matching uses the longest match.
- SSE/streaming is critical for MCP — ensure `proxy_buffering off` and long `proxy_read_timeout` (at least 86400s for SSE, matching the frontend HMR pattern) in the MCP location blocks.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
