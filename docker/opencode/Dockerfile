# ──────────────────────────────────────────────────────────────────────────────
# OpenCode Agent
# Tag: ghcr.io/zebbern/opencode:latest
#
# Build:
#   docker build -t ghcr.io/zebbern/opencode:latest docker/opencode/
#
# Autonomous coding/investigation agent. The component overrides entrypoint to
# /bin/sh and runs a wrapper script that calls `opencode mcp list` and
# `opencode run`.
#
# NOTE: The original opencode-ai/opencode project was archived and development
# continued as charmbracelet/crush. This Dockerfile installs from the latest
# available release. If the Go module path changes, update the go install line.
# ──────────────────────────────────────────────────────────────────────────────

# Stage 1: Build opencode from source
FROM golang:1.24-alpine AS builder

RUN apk add --no-cache git ca-certificates

# Install opencode CLI.
# Primary: try the original module path (opencode-ai/opencode).
# Fallback: charmbracelet/crush publishes the same CLI under a new module.
# If the upstream module path changes, update this line accordingly.
RUN go install github.com/opencode-ai/opencode@latest 2>/dev/null \
  || go install github.com/charmbracelet/crush@latest 2>/dev/null

# Ensure the binary is named 'opencode' regardless of source
RUN if [ ! -f /go/bin/opencode ] && [ -f /go/bin/crush ]; then \
      mv /go/bin/crush /go/bin/opencode; \
    fi \
  && test -f /go/bin/opencode

# Stage 2: Minimal runtime
FROM alpine:3.20

LABEL org.opencontainers.image.title="opencode" \
      org.opencontainers.image.description="OpenCode autonomous agent for investigation workflows" \
      org.opencontainers.image.source="https://github.com/zebbern/Sentris"

# Runtime deps: shell (for wrapper script), ca-certs (for HTTPS/MCP), git
RUN apk add --no-cache ca-certificates git curl jq

COPY --from=builder /go/bin/opencode /usr/local/bin/opencode

# Create non-root user with a writable home (opencode writes config there)
RUN addgroup -S agent && adduser -S agent -G agent \
  && mkdir -p /workspace && chown agent:agent /workspace

USER agent
WORKDIR /workspace

ENTRYPOINT ["opencode"]
CMD ["help"]
