#!/usr/bin/env bash
#
# Nightly logical backup of the production database.
#
#   deploy/backup/bbtasks-backup.sh          # take a backup now
#
# Install (see deploy/backup/bbtasks-backup for the cron entry):
#   chmod +x deploy/backup/bbtasks-backup.sh
#   cp deploy/backup/bbtasks-backup /etc/cron.d/bbtasks-backup
#   chmod 644 /etc/cron.d/bbtasks-backup
#
# Runs as root over the MySQL unix socket, so no password lives in this file or
# in the crontab. --single-transaction keeps it consistent WITHOUT locking the
# tables, so the app keeps serving while it runs.
#
# This host is shared with five other production apps and its disk sits near
# 80% full, so the script refuses to run when space is short rather than being
# the thing that fills the disk and takes everything down.

set -euo pipefail

DB=taskmanagement
DEST=/var/backups/bbtasks
KEEP_DAYS=14
MIN_FREE_MB=2048

mkdir -p "$DEST"
chmod 700 "$DEST"

FREE_MB="$(df -Pm "$DEST" | awk 'NR==2 {print $4}')"
if [ "$FREE_MB" -lt "$MIN_FREE_MB" ]; then
    echo "$(date -Is) backup ABORTED: only ${FREE_MB}MB free on $(df -P "$DEST" | awk 'NR==2 {print $6}')" >&2
    exit 1
fi

STAMP="$(date +%F_%H%M)"
OUT="${DEST}/${DB}-${STAMP}.sql.gz"
TMP="${OUT}.partial"

# --routines/--triggers matter here: the schema ships 7 triggers that maintain
# comment/attachment/checklist counters. A dump without them restores a database
# that silently stops counting.
if ! mysqldump \
    --single-transaction \
    --quick \
    --routines \
    --triggers \
    --default-character-set=utf8mb4 \
    "$DB" 2>/dev/null | gzip -9 >"$TMP"; then
    rm -f "$TMP"
    echo "$(date -Is) backup FAILED for ${DB}" >&2
    exit 1
fi

# A dump this small means something went wrong (empty DB, truncated pipe).
SIZE="$(stat -c %s "$TMP")"
if [ "$SIZE" -lt 10240 ]; then
    rm -f "$TMP"
    echo "$(date -Is) backup FAILED: dump was only ${SIZE} bytes" >&2
    exit 1
fi

mv "$TMP" "$OUT"
chmod 600 "$OUT"

find "$DEST" -name "${DB}-*.sql.gz" -type f -mtime +"$KEEP_DAYS" -delete

echo "$(date -Is) backup ok ${OUT} ($(du -h "$OUT" | cut -f1)), $(ls -1 "$DEST"/${DB}-*.sql.gz | wc -l) kept"
