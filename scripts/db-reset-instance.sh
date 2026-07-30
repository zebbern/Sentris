#!/usr/bin/env bash
# Backward-compatible Unix entrypoint for the cross-platform reset command.
# Usage: ./scripts/db-reset-instance.sh [instance_number]

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

case "$#" in
  0)
    exec bun "$ROOT_DIR/scripts/db-reset-instance.ts"
    ;;
  1)
    exec bun "$ROOT_DIR/scripts/db-reset-instance.ts" --instance "$1"
    ;;
  *)
    echo "Usage: ./scripts/db-reset-instance.sh [instance_number]" >&2
    exit 1
    ;;
esac
