#!/usr/bin/env bash
# Applies any db/migrations/*.sql files not yet recorded in schema_migrations, in filename order.
# Runs ON THE SERVER (invoked over SSH by .github/workflows/docker.yml on every push to main),
# against the isim-pg container — same commands the manual process in this directory's README
# already used, just looped and gated by a tracking table instead of typed by hand.
#
# Safety, unconditionally, no flag to skip it:
#   - pg_dump backup right before EACH migration that actually runs, kept in ~/rollback/.
#   - Each migration file already wraps itself in BEGIN;...COMMIT; (see README "Требования
#     к файлу миграции") — combined with `set -e` + `ON_ERROR_STOP=1` here, a failing migration
#     stops this script immediately, and the GitHub Actions step (and the whole workflow) fails —
#     the currently-running backend container is left untouched, deploy does not proceed.
#
# Bootstrap note: this script is scoped to the ONE live prod DB, not a general "works on any
# fresh DB" tool. KNOWN_APPLIED below are the migrations that were already applied by hand
# before this automation existed (see README's migration table, entries dated before 2026-08-08).
# On first run against schema_migrations being empty, they're recorded as applied WITHOUT
# re-running their SQL (they're already live). Everything from 004 onward runs for real.
# A fresh DB bootstrapped from db/schema.sql (which already bakes in 001-004) has no use for
# this bootstrap list — that path doesn't go through this script at all (see README).

set -euo pipefail

CONTAINER=isim-pg
DB_USER=isim
DB_NAME=isim
MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLLBACK_DIR="$HOME/rollback"
KNOWN_APPLIED=(001_levels_lookup.sql 001b_levels_fk.sql 002_subjects_lookup.sql 003_student_result_status.sql)

mkdir -p "$ROLLBACK_DIR"

psql_exec() {
    docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -t -A -c "$1"
}

echo "Ensuring schema_migrations tracking table exists..."
psql_exec "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());" > /dev/null

ROW_COUNT=$(psql_exec "SELECT count(*) FROM schema_migrations;")
if [ "$ROW_COUNT" -eq 0 ]; then
    echo "schema_migrations is empty — bootstrapping known-already-applied migrations (SQL not re-run): ${KNOWN_APPLIED[*]}"
    for f in "${KNOWN_APPLIED[@]}"; do
        psql_exec "INSERT INTO schema_migrations (filename) VALUES ('$f') ON CONFLICT DO NOTHING;" > /dev/null
    done
fi

APPLIED_ANY=0
for filepath in "$MIGRATIONS_DIR"/*.sql; do
    filename="$(basename "$filepath")"

    ALREADY=$(psql_exec "SELECT 1 FROM schema_migrations WHERE filename = '$filename';")
    if [ "$ALREADY" = "1" ]; then
        continue
    fi

    echo "Pending migration found: $filename"
    TS=$(date +%Y%m%d_%H%M%S)

    echo "  Backing up (pg_dump) before applying..."
    docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -F c -f "/tmp/pre-$filename.dump"
    docker cp "$CONTAINER:/tmp/pre-$filename.dump" "$ROLLBACK_DIR/pg-pre-$filename-$TS.dump"
    docker exec "$CONTAINER" rm -f "/tmp/pre-$filename.dump"
    echo "  Backup saved: $ROLLBACK_DIR/pg-pre-$filename-$TS.dump"

    echo "  Applying $filename ..."
    docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$filepath"

    psql_exec "INSERT INTO schema_migrations (filename) VALUES ('$filename');" > /dev/null
    echo "  $filename applied and recorded."
    APPLIED_ANY=1
done

if [ "$APPLIED_ANY" -eq 0 ]; then
    echo "No pending migrations — schema already up to date."
else
    echo "All pending migrations applied successfully."
fi
