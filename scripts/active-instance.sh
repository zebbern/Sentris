#!/usr/bin/env bash
# Workspace-scoped "active instance" selector for multi-instance dev & tests.
#
# Usage:
#   ./scripts/active-instance.sh get
#   ./scripts/active-instance.sh set 5
#
# Behavior:
# - Uses .sentris-instance in repo root
# - Instance must be an integer 0-9

set -euo pipefail

FILE=".sentris-instance"
CMD="${1:-get}"

die() {
  echo "❌ $*" 1>&2
  exit 1
}

is_digit() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

validate_instance() {
  local val="$1"
  local source="${2:-instance}"

  is_digit "$val" || die "$source must be an integer from 0 to 9. Got: $val"
  if [ "$val" -lt 0 ] || [ "$val" -gt 9 ]; then
    die "$source must be an integer from 0 to 9. Got: $val"
  fi
}

case "$CMD" in
  get)
    if [ -n "${SENTRIS_INSTANCE:-}" ]; then
      validate_instance "${SENTRIS_INSTANCE}" "SENTRIS_INSTANCE"
      echo "${SENTRIS_INSTANCE}"
      exit 0
    fi
    if [ -f "$FILE" ]; then
      val="$(tr -d '[:space:]' < "$FILE" || true)"
      if [ -n "$val" ]; then
        validate_instance "$val" ".sentris-instance"
        echo "$val"
        exit 0
      fi
    fi
    echo "0" > "$FILE"
    echo "0"
    ;;
  set)
    val="${2:-}"
    [ -n "$val" ] || die "Missing instance number. Example: ./scripts/active-instance.sh set 5"
    validate_instance "$val"
    echo "$val" > "$FILE"
    echo "✅ Active instance set to $val"
    ;;
  *)
    die "Unknown command: $CMD (expected: get|set)"
    ;;
esac

