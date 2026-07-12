#!/usr/bin/env bash
#
# Task Tracker backup job — runs on the HOST as root via systemd-timer.
# Backs up PostgreSQL (logical dump, consistent via pg_dump's MVCC snapshot)
# and the MinIO data volume into a single restic repository (dedup + encrypted).
#
# It is NOT run by the GitHub runner / `deploy` account — the repo and password
# are root-owned so a compromised CI workflow can't read or wipe backups.
#
# Full setup & operation: see BACKUPS.md. Required environment (set in the
# systemd unit, NOT in the app .env):
#   RESTIC_REPOSITORY     e.g. /opt/tracker/backups/restic
#   RESTIC_PASSWORD_FILE  e.g. /root/.restic-pass   (also kept OFFLINE)
# Optional:
#   DEPLOY_DIR            default /opt/tracker
#   COMPOSE_FILE          default $DEPLOY_DIR/docker-compose.prod.yml
#   ENV_FILE              default $DEPLOY_DIR/.env
#   MINIO_VOLUME          default tracker_minio_data   (docker volume name)
#   BACKUP_CHECK_READ_DATA  "1" to add --read-data-subset=5% (weekly timer)
set -uo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/tracker}"
COMPOSE_FILE="${COMPOSE_FILE:-$DEPLOY_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/.env}"
MINIO_VOLUME="${MINIO_VOLUME:-tracker_minio_data}"
STATUS_FILE="${STATUS_FILE:-$DEPLOY_DIR/backups/status.json}"

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

POSTGRES_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-)"
POSTGRES_DB="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2-)"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
err=""
db_ok=false
minio_ok=false

# --- 1. PostgreSQL: stream a consistent custom-format dump straight into restic.
#        pg_dump takes an MVCC snapshot, so the dump is point-in-time consistent
#        even while the app keeps writing; restic never touches PG's data files.
if compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
    | restic backup --stdin --stdin-filename tracker-db.dump --tag db --host tracker; then
  db_ok=true
else
  err="pg_dump/restic (db) failed"
fi

# --- 2. MinIO: back up the volume's data directory directly (incremental).
MINIO_PATH="$(docker volume inspect -f '{{ .Mountpoint }}' "$MINIO_VOLUME" 2>/dev/null || true)"
if [ -n "$MINIO_PATH" ] && [ -d "$MINIO_PATH" ]; then
  if restic backup "$MINIO_PATH" --tag minio --host tracker; then
    minio_ok=true
  else
    err="${err:+$err; }restic (minio) failed"
  fi
else
  err="${err:+$err; }minio volume '$MINIO_VOLUME' not found"
fi

# --- 3. Retention (GFS). keep-last preserves recent 6-hourly snapshots.
#        Single source of truth for the policy — reused in status.json below.
KEEP_LAST=8 KEEP_DAILY=7 KEEP_WEEKLY=4 KEEP_MONTHLY=3
restic forget \
  --keep-last "$KEEP_LAST" --keep-daily "$KEEP_DAILY" \
  --keep-weekly "$KEEP_WEEKLY" --keep-monthly "$KEEP_MONTHLY" \
  --prune || err="${err:+$err; }restic forget/prune failed"

# --- 4. Integrity check. Structural every run; sample real data when asked
#        (the weekly timer sets BACKUP_CHECK_READ_DATA=1).
check_ok=false
check_args=()
[ "${BACKUP_CHECK_READ_DATA:-0}" = "1" ] && check_args+=(--read-data-subset=5%)
if restic check "${check_args[@]}"; then
  check_ok=true
else
  err="${err:+$err; }restic check failed"
fi

# --- 5. Write status.json (no secrets) for the admin dashboard. 644 so the
#        backend (different uid) can read it; repo + password stay root-only.
snaps_json="$(restic snapshots --json 2>/dev/null || echo '[]')"
repo_bytes="$(restic stats --mode raw-data --json 2>/dev/null \
  | grep -o '"total_size":[0-9]*' | cut -d: -f2)"
run_ok=false
[ "$db_ok" = true ] && [ "$minio_ok" = true ] && run_ok=true

# Snapshot count + recent log + oldest snapshot. jq (installed per RUNNING-VM)
# builds the rich fields; without it we fall back to count-only.
if command -v jq >/dev/null 2>&1; then
  snapshots="$(printf '%s' "$snaps_json" | jq 'length')"
  recent="$(printf '%s' "$snaps_json" \
    | jq -c 'sort_by(.time) | reverse | .[0:20]
             | map({ time: .time, tag: (.tags[0] // ""), id: (.short_id // .id[0:8]) })')"
  oldest="$(printf '%s' "$snaps_json" \
    | jq -r 'if length==0 then "null" else (sort_by(.time)[0].time | tojson) end')"
else
  snapshots="$(printf '%s' "$snaps_json" | grep -o '"id"' | wc -l | tr -d ' ')"
  recent='[]'
  oldest='null'
fi

mkdir -p "$(dirname "$STATUS_FILE")"
cat > "$STATUS_FILE" <<JSON
{
  "lastRun": "$(ts)",
  "ok": $run_ok,
  "db": { "ok": $db_ok },
  "minio": { "ok": $minio_ok },
  "snapshots": ${snapshots:-0},
  "repoSizeBytes": ${repo_bytes:-0},
  "lastCheck": { "ok": $check_ok, "at": "$(ts)" },
  "error": $( [ -n "$err" ] && printf '"%s"' "$err" || printf 'null' ),
  "recent": ${recent:-[]},
  "oldest": ${oldest:-null},
  "retention": { "last": $KEEP_LAST, "daily": $KEEP_DAILY, "weekly": $KEEP_WEEKLY, "monthly": $KEEP_MONTHLY }
}
JSON
chmod 644 "$STATUS_FILE"

# Optional dead-man ping (define BACKUP_PING_URL in the unit to enable).
if [ "$run_ok" = true ] && [ -n "${BACKUP_PING_URL:-}" ]; then
  curl -fsS -m 10 "$BACKUP_PING_URL" >/dev/null 2>&1 || true
fi

[ "$run_ok" = true ] && [ -z "$err" ] || { echo "backup finished with errors: $err" >&2; exit 1; }
echo "backup OK ($(ts))"
