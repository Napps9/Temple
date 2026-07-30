#!/bin/bash
# Every pgTAP file, against one replayed schema. Each file is its own
# begin/rollback, which is exactly how pg_prove runs them in CI.
set -uo pipefail
export PGPORT=5433 PGHOST=/var/run/postgresql PGUSER=postgres
S="$(cd "$(dirname "$0")" && pwd)"
bash "$S/replay.sh" || exit 1
psql -q -d temple -v ON_ERROR_STOP=1 -f "$S/pgtap-shim.sql" >/dev/null 2>&1
cd /home/user/Temple/supabase/tests
pass=0; fail=0; failed=""
for t in *.sql; do
  out=$(psql -d temple -X -q -P pager=off -f "$t" 2>&1)
  if echo "$out" | grep -q "failed=0" && ! echo "$out" | grep -qE "^ *not ok|but ran"; then
    pass=$((pass+1))
  else
    fail=$((fail+1)); failed="$failed
  --- $t"
    failed="$failed
$(echo "$out" | grep -E '^ *not ok|but ran|ERROR' | head -4)"
  fi
done
echo "PASS=$pass FAIL=$fail"
[ -n "$failed" ] && echo "FAILURES:$failed"
