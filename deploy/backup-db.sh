#!/usr/bin/env bash
# Online SQLite backup for combinewrt.
#
# Usage:
#   install -m 0755 deploy/backup-db.sh /usr/local/sbin/combinewrt-backup
#   DATABASE_PATH=/var/lib/combinewrt/combinewrt.db combinewrt-backup /var/backups/combinewrt
#
# The sqlite3 CLI must be installed. .backup is safe while the app is running.
set -euo pipefail

DB="${DATABASE_PATH:-/var/lib/combinewrt/combinewrt.db}"
DEST_DIR="${1:-/var/backups/combinewrt}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${DEST_DIR}/combinewrt-${STAMP}.db"

if [[ ! -r "$DB" ]]; then
  echo "database is not readable: $DB" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
sqlite3 "$DB" ".backup '${DEST}'"
chmod 0600 "$DEST"
echo "$DEST"
