# ──────────────────────────────────────────────────────────────────────────────
# Supabase Security Scanner
# Tag: ghcr.io/zebbern/supabase-scanner:latest
#
# Build:
#   docker build -t ghcr.io/zebbern/supabase-scanner:latest docker/supabase-scanner/
#
# Runs read-only Postgres checks (RLS, roles, extensions, storage, auth) and
# outputs a JSON report with a 0–100 security score.
# ──────────────────────────────────────────────────────────────────────────────

# Stage 1: Install dependencies
FROM python:3.12-slim AS builder

WORKDIR /build

RUN pip install --no-cache-dir --target /build/deps \
      psycopg2-binary \
      pyyaml

# Stage 2: Minimal runtime (distroless-style)
FROM python:3.12-slim

LABEL org.opencontainers.image.title="supabase-scanner" \
      org.opencontainers.image.description="Supabase security posture scanner" \
      org.opencontainers.image.source="https://github.com/zebbern/Sentris"

# Copy only installed packages
COPY --from=builder /build/deps /usr/local/lib/python3.12/site-packages/

# Copy scanner script
COPY supabase_scanner.py /app/supabase_scanner.py

# Create non-root user and output directory
RUN groupadd -r scanner && useradd -r -g scanner scanner \
  && mkdir -p /data && chown scanner:scanner /data

USER scanner
WORKDIR /app

# ENTRYPOINT matches what the component expects:
#   command: [containerConfigPath]   →   python3 /app/supabase_scanner.py <config>
ENTRYPOINT ["/usr/local/bin/python3", "/app/supabase_scanner.py"]
