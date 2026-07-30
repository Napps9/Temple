#!/bin/bash
# Bring up a scratch Postgres 16 for local migration and pgTAP runs.
# Idempotent: re-running against a live cluster is a no-op.
set -uo pipefail

D=/var/tmp/pgt
PORT=5433

if pg_isready -p "$PORT" -h /var/run/postgresql >/dev/null 2>&1; then
  echo "already up on port $PORT"
  exit 0
fi

mkdir -p "$D"
chown -R postgres:postgres "$D"
chmod 755 /var/tmp "$D"

if [ ! -d "$D/data" ]; then
  # trust auth: this cluster holds nothing but throwaway replays.
  su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $D/data -A trust" >/dev/null
fi

su postgres -c \
  "/usr/lib/postgresql/16/bin/pg_ctl -D $D/data -l $D/log -o '-p $PORT' start" >/dev/null

for _ in $(seq 1 20); do
  pg_isready -p "$PORT" -h /var/run/postgresql >/dev/null 2>&1 && break
  sleep 1
done

if pg_isready -p "$PORT" -h /var/run/postgresql >/dev/null 2>&1; then
  echo "postgres up on port $PORT"
else
  echo "failed to start; see $D/log"
  tail -20 "$D/log" 2>/dev/null
  exit 1
fi
