#!/usr/bin/env bash
#
# Fires one background job through the internal HTTP endpoint.
#
#   run-job.sh <slug> [--dry-run]
#
# The token is read from server/.env at run time rather than baked into the
# crontab: the crontab is world-readable, .env is 0600, and this way rotating
# the token needs no cron edit.
#
# The API answers 200 {"ok":false,"error":...} for a FAILED job (by design, so a
# scheduler can branch on the body instead of on the status code) — so this
# script inspects the body and exits non-zero, which is what makes cron actually
# report the failure.

set -euo pipefail

APP_DIR="/var/www/html/tasks-beautybooth"
ENV_FILE="${APP_DIR}/server/.env"
API="http://127.0.0.1:5501/api/v1/jobs"

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
    echo "usage: run-job.sh <slug> [--dry-run]" >&2
    exit 2
fi

QUERY=""
if [ "${2:-}" = "--dry-run" ]; then
    QUERY="?dry_run=true"
fi

if [ ! -r "$ENV_FILE" ]; then
    echo "$(date -Is) job=${SLUG} FATAL: cannot read ${ENV_FILE}" >&2
    exit 1
fi

TOKEN="$(grep -m1 '^INTERNAL_JOB_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
if [ -z "$TOKEN" ]; then
    echo "$(date -Is) job=${SLUG} FATAL: INTERNAL_JOB_TOKEN is empty in ${ENV_FILE}" >&2
    exit 1
fi

BODY="$(curl -sS -m 300 -X POST \
    -H "X-Internal-Token: ${TOKEN}" \
    "${API}/${SLUG}${QUERY}")" || {
    echo "$(date -Is) job=${SLUG} FATAL: request failed (is the API up?)" >&2
    exit 1
}

echo "$(date -Is) job=${SLUG} ${BODY}"

case "$BODY" in
    *'"ok":true'*) exit 0 ;;
    *) exit 1 ;;
esac
