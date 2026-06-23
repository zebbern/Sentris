#!/usr/bin/env bash
# Clean shared infra resources for a specific instance.
# - Drop/recreate instance DB and re-run migrations (reset)
# - Delete Temporal namespace (best-effort)
# - Delete instance-scoped Kafka topics (best-effort)
#
# Usage: ./scripts/instance-clean.sh [instance_number]

set -euo pipefail

INSTANCE="${1:-0}"
NAMESPACE="sentris-dev-${INSTANCE}"
TEMPORAL_ADDRESS="127.0.0.1:7233"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ${NC} $*"; }
log_success() { echo -e "${GREEN}✅${NC} $*"; }
log_error() { echo -e "${RED}❌${NC} $*"; }

validate_instance() {
  if [[ ! "$1" =~ ^[0-9]+$ ]] || [ "$1" -lt 0 ] || [ "$1" -gt 9 ]; then
    log_error "Instance must be an integer from 0 to 9. Got: $1"
    exit 1
  fi
}

validate_instance "$INSTANCE"

if ! docker ps --filter "name=sentris-postgres" --format "{{.Names}}" | grep -q "^sentris-postgres$"; then
  log_error "Postgres container not found. Is shared infra running?"
  exit 1
fi

log_info "Resetting database for instance $INSTANCE..."
if ! ./scripts/db-reset-instance.sh "$INSTANCE" >/dev/null; then
  log_error "Failed to reset database for instance $INSTANCE"
  exit 1
fi
log_success "Database reset complete"

if command -v temporal >/dev/null 2>&1; then
  log_info "Deleting Temporal namespace (best-effort): $NAMESPACE"
  temporal operator namespace delete --address "$TEMPORAL_ADDRESS" --namespace "$NAMESPACE" --yes >/dev/null 2>&1 || true
fi

if docker ps --filter "name=sentris-redpanda" --format "{{.Names}}" | grep -q "^sentris-redpanda$"; then
  log_info "Deleting Kafka topics for instance $INSTANCE (best-effort)..."
  for base in telemetry.logs telemetry.events telemetry.agent-trace telemetry.node-io; do
    topic="${base}.instance-${INSTANCE}"
    docker exec sentris-redpanda rpk topic delete "$topic" --brokers redpanda:9092 >/dev/null 2>&1 || true
  done
fi

log_success "Instance $INSTANCE infra state cleaned"
