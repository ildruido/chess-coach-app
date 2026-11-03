#!/usr/bin/env bash
# Cloud-session setup for this app (run by .claude/hooks/cloud-setup.mjs, cloud sessions only).
# Installs the server's dependencies and starts the container's Postgres with the password the
# web e2e tests expect (postgres://postgres:test@localhost:5432/postgres). Safe to run twice.
set -u
cd "$(dirname "$0")/.."

# Server dependencies.
if [ ! -d server/node_modules ] || [ server/package-lock.json -nt server/node_modules/.package-lock.json ]; then
  npm ci --prefix server --no-audit --no-fund || exit 1
fi

# Postgres: needs root and an installed cluster; otherwise say so and carry on.
if ! command -v pg_ctlcluster >/dev/null 2>&1 || [ "$(id -u)" != 0 ]; then
  echo "Postgres not available here: web e2e and server tests need DATABASE_URL pointing at one."
  exit 0
fi
CLUSTER=$(pg_lsclusters --no-header | awk 'NR==1{print $1, $2}')
if [ -z "$CLUSTER" ]; then
  echo "No Postgres cluster installed."
  exit 0
fi
# shellcheck disable=SC2086
pg_ctlcluster $CLUSTER start 2>/dev/null || true
for _ in $(seq 1 20); do
  su postgres -c "psql -qc \"ALTER USER postgres PASSWORD 'test'\"" >/dev/null 2>&1 && break
  sleep 0.5
done
PGPASSWORD=test psql -h localhost -U postgres -qtAc "select 1" >/dev/null && echo "Postgres ready on localhost:5432 (postgres/test)."
