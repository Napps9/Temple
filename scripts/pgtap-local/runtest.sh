#!/bin/bash
# Run one pgTAP file against the replayed schema. Assumes replay.sh has run.
set -uo pipefail
export PGPORT=5433 PGHOST=/var/run/postgresql PGUSER=postgres
S="$(cd "$(dirname "$0")" && pwd)"
cd /home/user/Temple
psql -q -d temple -v ON_ERROR_STOP=1 -f "$S/pgtap-shim.sql" >/dev/null 2>&1 || {
  echo "SHIM FAILED"; psql -q -d temple -f "$S/pgtap-shim.sql" 2>&1 | tail -5; exit 1; }
cd supabase/tests
psql -d temple -X -q -P pager=off -f "$1" 2>&1
