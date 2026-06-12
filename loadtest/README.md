# Load testing

Capacity testing for the Task Tracker: how many concurrent users it serves at a
given server size, and how that degrades on a heavily populated database.

The generator is **Locust** (live web UI — set the number of users and spawn
rate by hand, press Start, watch RPS / p95 / failure-% update in real time). It
runs in its own container against an **isolated copy** of the app with a
separate database and object store — your real data is never reachable.

## What's here

| File | Purpose |
|---|---|
| `../docker-compose.loadtest.yml` | Isolated stack: own Postgres + Redis + MinIO + backend + frontend + edge + Locust. Resource limits are env-driven. |
| `locustfile.py` | Virtual-user behaviour: weighted REST workflow (~80% read / 20% write) + an optional Socket.IO connection holder. |
| `Dockerfile` / `requirements.txt` | Locust image + the Socket.IO client. |
| `../backend/prisma/seed-bigdata.ts` | Big-data generator with `seed` / `stats` / `purge` and a safety guard. |

## Quick start

```bash
# 1. Bring up the isolated stack (builds backend/frontend from source)
docker compose -f docker-compose.loadtest.yml up -d --build

# 2. Apply migrations to the throwaway DB
docker compose -f docker-compose.loadtest.yml exec backend npx prisma migrate deploy

# 3. Fill the DB (see volumes below). Creates loadtest+N@tracker.local users.
docker compose -f docker-compose.loadtest.yml exec backend \
  npx ts-node prisma/seed-bigdata.ts seed --users 100 --projects 50 --tasks 20000 --comments 50000 --activity 50000

# 4. Open the Locust UI, set users + spawn rate, press Start
open http://localhost:8089        # generator UI
# (optional) http://localhost:8088 — the app itself, to eyeball it during a run
```

Stop the stack and wipe the throwaway data entirely:

```bash
docker compose -f docker-compose.loadtest.yml down -v
```

## Seeding / managing data

The seeder only ever creates marked rows (projects `LT…`, users
`loadtest+N@…`) and refuses to run against a database that already holds
non-loadtest rows unless you pass `--force` — so it can't clobber a real DB.

```bash
# how much loadtest data is present
… exec backend npx ts-node prisma/seed-bigdata.ts stats

# remove ONLY generated data (cascades children); real rows untouched
… exec backend npx ts-node prisma/seed-bigdata.ts purge
```

Suggested volumes for the "fat DB" comparison (seeding ~1M activity rows takes a
few minutes):

```bash
… seed --users 200 --projects 200 --tasks 100000 --comments 500000 --activity 1000000
```

## Sweeping server resources

Limits are environment variables on the compose file, so you change the "server
size" and re-run without editing anything:

```bash
# 1 CPU / 1 GB backend
BACKEND_CPUS=1 BACKEND_MEM=1g PG_CPUS=1 PG_MEM=1g \
  docker compose -f docker-compose.loadtest.yml up -d

# 2 CPU / 2 GB backend (re-run, then repeat the Locust test)
BACKEND_CPUS=2 BACKEND_MEM=2g PG_CPUS=2 PG_MEM=2g \
  docker compose -f docker-compose.loadtest.yml up -d
```

Record, for each cell, the last user count where p95 stays acceptable and
failures stay near zero:

| Backend | Postgres | Empty DB | Fat DB |
|---|---|---|---|
| 1 CPU / 1 GB | 1 CPU / 1 GB | … users | … users |
| 2 CPU / 2 GB | 2 CPU / 2 GB | … users | … users |

## ⚠️ Generator placement matters

Running Locust **on the same host** as the app means the two compete for CPU,
so the measurement is polluted — you can't tell whether latency rose because the
app saturated or because Locust did. That directly undermines the "users per
server size" question.

- **Same host** (the compose default): fine for getting the scenario working and
  for rough, *pessimistic* relative numbers.
- **Real capacity numbers**: run Locust from a **separate machine** (another VM,
  your laptop, a CI runner) pointed at the server's URL:

  ```bash
  TARGET_URL=http://YOUR_SERVER docker compose -f docker-compose.loadtest.yml up locust
  ```

## Notes

- Rate limiting is disabled in this stack (`THROTTLE_LIMIT=1000000`): the whole
  generator is a single IP, so the per-IP limiter would throttle the *test*, not
  the app. Don't copy that value to production.
- The REST workflow is the primary signal. The Socket.IO user (`WS_USER_WEIGHT`)
  holds open connections to load the realtime gateway + Redis adapter; set its
  weight to 0 to measure pure REST.
- Tune the read/write mix with `REST_USER_WEIGHT` / `WS_USER_WEIGHT` and the
  per-action `@task(weight)` values in `locustfile.py`.
