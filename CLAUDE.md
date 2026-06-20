# CLAUDE.md — guide for AI agents working in this repo

Working brief for an AI agent operating on this codebase. Human-facing docs:
[README.md](./README.md) (architecture, API, env vars),
[RUNNING-WINDOWS.md](./RUNNING-WINDOWS.md) (local Docker run),
[RUNNING-VM.md](./RUNNING-VM.md) (server deploy + CI/CD + data ops),
[BACKUPS.md](./BACKUPS.md) (host restic backups: setup, restore, ops).

Read this fully before changing code — it captures the conventions and the
non-obvious traps that the type-checker and tests won't catch for you.

## What this project is

Task Tracker — a small REST + SPA "mini-Jira" used as a DevOps practice ground:
multi-service Docker Compose, Prisma migrations, JWT auth, realtime over
Socket.IO, in-app notifications, per-project roles, an admin metrics dashboard,
health probes, structured logs, Docker Hub releases and an automated deploy to a
Linux server via a self-hosted GitHub Actions runner.

## Stack

- **Backend:** NestJS 10 (TypeScript) + Prisma 5, PostgreSQL 16. Redis 7 backs
  the `@nestjs/throttler` rate-limit counters, the Socket.IO adapter, the admin
  metrics cache and the notifications cron lock; when `REDIS_HOST` is unset
  (bare `npm run start:dev`, unit tests) the app transparently falls back to
  in-process stores.
- **Frontend:** React 18 + Vite + TypeScript + TailwindCSS.
- **Realtime:** Socket.IO via a NestJS WebSocket gateway at `/api/socket.io`.
- **Object storage:** MinIO (S3-compatible) for task attachments AND user
  avatars; accessed with `@aws-sdk/client-s3`, uploads via `multer`. The backend
  proxies up/downloads — MinIO is never exposed to clients. Same code works
  against real AWS S3 by changing `S3_ENDPOINT` / credentials.
- **Auth:** JWT access + rotating refresh, bcrypt. Two independent authority
  axes: global `User.isAdmin` (the `/admin` panel) and per-project roles
  owner > ADMIN > EDITOR (default) > VIEWER (see "Roles" below).
- **Scheduling:** `@nestjs/schedule` (`ScheduleModule.forRoot()` in
  `app.module.ts`) drives the hourly due-soon notification sweep.
- **Tests:** Jest (backend, mocked Prisma), Vitest + React Testing Library (frontend).
- **Infra:** Docker (multi-stage, non-root), nginx reverse proxy in prod, GitHub Actions CI/CD.

## Repo layout

```
backend/    NestJS API — src/ modules (auth, users, projects, tasks, comments,
            labels, activity, notifications, admin, realtime, storage,
            attachments, health, config, metrics, redis, prisma) + src/common
            (pagination helper). prisma/ (schema, migrations, seed,
            seed-bigdata is NOT present — load tooling lives outside dev).
            test/ (e2e: health only), Dockerfile
frontend/   React SPA — src/ (pages, components, ui, api client, auth context,
            lib), nginx.conf (serves on :8080, unprivileged), Dockerfile
deploy/     edge.conf — production reverse-proxy (HTTP + WebSocket upgrade,
            security headers, gzip); tracker-backup.sh + systemd/ — host restic
            backup job + timer (see BACKUPS.md)
.github/    workflows: ci.yml (PRs), dev-cd.yml (push to dev), prod-cd.yml (push to main)
docker-compose.yml        local dev stack (builds from source)
docker-compose.prod.yml   prod stack (pulls images from Docker Hub)
Makefile, .env.example, backend/.env.example
```

## How to run / test

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec backend npx prisma migrate deploy   # applies committed migrations
# seed REQUIRES SEED_* passwords (no defaults); pass them inline for local runs:
docker compose exec \
  -e SEED_ADMIN_PASSWORD=admin1234 -e SEED_TEST_PASSWORD=test1234 \
  backend npm run prisma:seed                            # creates test users + demo data
```

- Frontend http://localhost:5173 (container listens on :8080) · API http://localhost:3000/api · Swagger `/api/docs`
- Health: `/api/health/live` (process), `/api/health/ready` (DB ping)
- Admin dashboards: `/admin` (overview) and `/admin/metrics` (per-service metrics)

### Tests & lint

There is **no `make lint` target** — lint is run per-package. The `make test-*`
targets run inside containers; for tight feedback loops run npm scripts directly
in `backend/` or `frontend/` (needs a local `npm install`).

```bash
# Backend (NestJS / Jest) — from backend/
npm test                                  # unit tests (*.spec.ts under src/)
npm test -- src/auth/auth.service.spec.ts # a single test file
npm test -- -t "rotates refresh token"    # tests matching a name
npm run test:e2e                          # e2e (test/, uses test/jest-e2e.json)
npm run lint                              # eslint, --max-warnings=0

# Frontend (Vite / Vitest) — from frontend/
npm test                                  # vitest run (one-shot)
npm test -- ProjectsPage                  # files/tests matching a pattern
npm run lint                              # eslint, --max-warnings=0
npx tsc -b                                # type-check (the build also runs this)
```

CI (`ci.yml`) runs `npm run lint` + tests + build for both packages — lint is
gated at zero warnings, so treat warnings as errors. Always run lint + tests +
type-check for any package you touch before committing.

**Seeded accounts**: `admin@tracker.local` and `test@tracker.local`. Passwords
have no defaults — taken from required `SEED_ADMIN_PASSWORD` / `SEED_TEST_PASSWORD`
env vars at seed time (snippet above uses admin1234 / test1234 as examples). In
prod they come from GitHub Secrets.

## Key domain concepts (read before touching these areas)

- **Pagination.** Every list endpoint (projects, tasks, activity feeds,
  notifications) is cursor-paginated and returns `{ items, nextCursor }`, built
  via `backend/src/common/pagination.ts` (`PageQueryDto`, `toPage`). The cursor
  is the last row's `id`, and every `orderBy` appends `id` as a unique
  tiebreaker (createdAt/position are not unique). The frontend `endpoints.ts`
  has a `fetchAllPages` helper that walks pages for views that need the whole
  list (board, sidebar). **If you add/modify a list endpoint, keep the
  `{ items, nextCursor }` shape** or you'll break the client.

- **Project roles & access.** Access to a project = you OWN it (`Project.ownerId`)
  OR you have a `ProjectMember` row (any role). There is no implicit membership
  any more. Hierarchy owner > ADMIN > EDITOR > VIEWER is enforced centrally via
  `ProjectsService.roleIn` / `assertRole` (+ `roleAtLeast`); the frontend mirrors
  it in `lib/roles.ts`. VIEWER = read + comment; EDITOR (default) = full task
  editing, labels, uploads; ADMIN = members/roles, rename, close/reopen, delete
  tasks, moderate comments; owner = ADMIN + delete project. **Assigning a task
  to a non-member auto-adds them as EDITOR** (`ProjectsService.ensureMember`,
  called inside the task transaction). When adding a permission check, route it
  through `assertRole` — don't reinvent owner checks.

- **Notifications.** Model `Notification` with `NotificationType` enum
  (MENTIONED, ASSIGNED, TASK_STATUS_CHANGED, DUE_SOON — extensible). `readAt`
  null = unread. Mention/assignment/status notifications are created **inside the
  same transaction** as the comment/task mutation, then pushed to the recipient's
  per-user socket room (`emitNotification`). DUE_SOON is an hourly `@Cron` sweep
  (`notifications.scheduler.ts`) guarded by a Redis lock (so only one replica
  runs it) plus a per-(user, task) dedup window. Recipients are always filtered
  to project participants and never include the actor.

- **Realtime.** One shared client socket (`frontend/src/lib/realtime.ts`).
  Server rooms: `project:<id>` (board/comment/attachment events) and `user:<id>`
  (projects-changed, notification). Gateway auth = JWT in the handshake
  `auth.token`. With Redis, broadcasts use the Redis adapter so they reach
  clients on any backend replica.

- **Attachments & avatars.** Both live in S3/MinIO, served only through the
  authenticated API proxy (never a direct bucket URL). A task attachment may set
  `Attachment.commentId` to render inline inside a comment; the task's Files tab
  still lists all of them. Avatars are stored under `User.avatarKey`; the
  frontend fetches the protected bytes once per `avatarKey` and caches the
  object URL (`lib/avatarCache.ts`).

- **Admin metrics.** `/admin/metrics` shows a per-service dashboard, assembled in
  two layers. The `metrics` module's `@Global() MetricsService` is a live
  in-process collector several layers feed: HTTP request counts (the
  `HttpMetricsMiddleware`, which runs before guards so it also counts
  401/403/404/429), slow Prisma queries, realtime connection counts, and
  rate-limit hits (the `ThrottlerMetricsFilter`, which re-emits the standard 429).
  `admin.service.ts` then merges that snapshot with an infra snapshot (Postgres
  size via `pg_database_size` + version/uptime/connections; Redis via
  `INFO`/`dbsize`; S3 bucket reachability; attachment bytes) cached per
  `metricsCacheTtlMs` and shared across replicas via Redis. No Docker socket is
  used — each service reports through its own protocol. The **Backups** card is
  fed by a
  `status.json` written by the host restic job (`deploy/tracker-backup.sh`) and
  read-only mounted into the backend (`BACKUP_STATUS_FILE`); the app only reads
  it, never runs backups — see BACKUPS.md.

- **Project closure.** A project auto-closes when all tasks are DONE and is
  read-only until explicitly reopened. Every mutating path calls
  `assertNotClosed`. Don't add a mutation without it.

## Conventions

- **Backend:** modular NestJS; validate input with `class-validator` DTOs (global
  `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` + `transform`).
  Prisma is the source of truth — change `prisma/schema.prisma`, then create a
  migration. Structured logging via `nestjs-pino` (JSON to stdout; the pretty
  transport is intentionally disabled for Docker stability — do not re-add a
  `pino-pretty` worker transport).
- **Frontend:** React hooks + Context for auth; Axios client with an interceptor
  that auto-refreshes once on 401 (single in-flight refresh shared across
  concurrent calls — see `api/client.ts`); TailwindCSS with design tokens in
  `tailwind.config.js` / `lib/meta.ts`. The logo is `frontend/public/logo.png`
  (1024×1024); render sizes are set per call site with arbitrary Tailwind values.
- **Migrations:** committed under `backend/prisma/migrations/`. Apply with
  `prisma migrate deploy`; create with `prisma migrate dev --name <x>` when a DB
  is reachable. If no DB is available (e.g. this sandbox), hand-write the
  migration SQL and verify it byte-for-byte against
  `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`
  before committing.
- **Secrets/env:** never commit `.env`. Runtime config comes from env vars
  (README §"Environment variables").

## Gotchas

- The backend Dockerfile runs `npm prune --omit=dev`, so anything needed at
  runtime (`prisma`, `ts-node`, `typescript`, `pino-pretty`) must live in
  `dependencies`, not `devDependencies`. `seed.ts` runs via `ts-node` at runtime.
- `docker-compose.yml` sets `NODE_ENV=development` even though the image is a
  prod build — keep this in mind when gating behaviour on `NODE_ENV`.
- **Jest + Prisma mocks:** `jest.clearAllMocks()` does NOT drain queued
  `mockResolvedValueOnce` values. When a test queues `Once` returns on a tx-mock,
  `mockReset()` those mocks in `beforeEach`, or a failing test leaks its queue
  into the next one.
- **Throttler is per-IP** (`THROTTLE_LIMIT`/`THROTTLE_TTL`). Anything that hits
  the API as a single IP at volume (load tests, scrapers) will be throttled
  before the app saturates — raise the limit in that environment, don't measure
  the throttler by mistake.
- **Frontend container is nginx-unprivileged**, listening on `:8080` (not 80);
  compose maps host `5173`→`8080` and the edge upstream targets `frontend:8080`.
- Redis is optional everywhere: guard new Redis use behind the
  `RedisService.connection` null-check and provide an in-process fallback, the
  way the throttler/metrics/scheduler already do.
- List endpoints that changed shape to `{ items, nextCursor }` are a **breaking
  API change** for any external consumer — the bundled frontend is already
  adapted, but note it if you touch them.
