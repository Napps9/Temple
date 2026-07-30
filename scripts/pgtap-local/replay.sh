#!/bin/bash
# Replay every migration into a scratch Postgres, then optionally run a pgTAP
# file against it. The Supabase CLI is not available in this environment, so
# this is the only way to find out whether a migration deploys and whether its
# test passes before pushing to a live database.
set -uo pipefail
export PGPORT=5433 PGHOST=/var/run/postgresql PGUSER=postgres
S="$(cd "$(dirname "$0")" && pwd)"
cd /home/user/Temple

psql -d postgres -q -tAc "drop database if exists temple;" >/dev/null
psql -d postgres -q -tAc "create database temple;" >/dev/null
if ! psql -q -d temple -v ON_ERROR_STOP=1 -f "$S/preamble.sql" >/dev/null 2>&1; then
  echo "PREAMBLE FAILED"; psql -q -d temple -v ON_ERROR_STOP=1 -f "$S/preamble.sql" 2>&1 | tail -5; exit 1
fi

tmp=$(mktemp -d)
for f in supabase/migrations/*.sql; do
  # pg_cron and pg_net cannot be installed here; the preamble already provides
  # the schemas and the functions the migrations call, so the CREATE EXTENSION
  # lines go.
  sed -E 's/^[[:space:]]*create extension if not exists (pg_cron|pg_net).*$/select 1;/I' "$f" > "$tmp/m.sql"
  if ! out=$(psql -q -d temple -v ON_ERROR_STOP=1 -f "$tmp/m.sql" 2>&1); then
    echo "MIGRATION FAILED: $(basename "$f")"
    echo "$out" | grep -E "ERROR|psql:" | head -6
    exit 1
  fi
done
echo "ALL $(ls supabase/migrations/*.sql | wc -l) MIGRATIONS APPLIED"
