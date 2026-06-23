# ──────────────────────────────────────────────────────────────────────────────
# Claude Code Agent
# Tag: ghcr.io/zebbern/claude-code:latest
#
# Build:
#   docker build -t ghcr.io/zebbern/claude-code:latest docker/claude-code/
#
# Headless agent runner for Sentris workflows. The component overrides
# entrypoint to /bin/sh and runs a wrapper script that calls `claude -p`.
#
# Pinned CLI version: @anthropic-ai/claude-code@2.1.185 (update intentionally)
# ──────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine

LABEL org.opencontainers.image.title="claude-code" \
      org.opencontainers.image.description="Claude Code CLI agent for investigation workflows" \
      org.opencontainers.image.source="https://github.com/zebbern/Sentris"

RUN apk add --no-cache ca-certificates git bash

# Pin Claude Code CLI version for reproducible agent behavior.
RUN npm install -g @anthropic-ai/claude-code@2.1.185

# Pre-create plugin mount points (plugins can be baked in later).
RUN mkdir -p /opt/plugins/oh-my-claudecode /opt/plugins/superpowers

RUN addgroup -S agent && adduser -S agent -G agent \
  && mkdir -p /workspace && chown agent:agent /workspace

USER agent
WORKDIR /workspace

ENTRYPOINT ["claude"]
CMD ["--help"]
