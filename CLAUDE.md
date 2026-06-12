# CLAUDE.md — guide for AI agents working in this repo

This is the working brief for an AI agent (Claude) operating on this codebase.
For the human-facing technical description see [README.md](./README.md); for the
step-by-step local run on Windows + Docker see [RUNNING-WINDOWS.md](./RUNNING-WINDOWS.md).

## What this project is

Task Tracker — a small REST + SPA "mini-Jira" used as a DevOps practice ground:
multi-service Docker Compose, Prisma migrations, JWT auth, health probes,
structured logs, Docker Hub releases and an automated deploy to a Linux server
via a self-hosted GitHub Actions runner.

## Stack

- **Backend:** NestJS 10 (TypeScript) + Prisma 5, PostgreSQL 16. Redis 7 backs
  the `@nestjs/throttler` rate-limit counters, the Socket.IO adapter and the
  admin metrics cache; when `REDIS_HOST` is unset (bare `npm run start:dev`,
  unit tests) the app transparently falls back to in-process stores.
- **Frontend:** React 18 + Vite + TypeScript + TailwindCSS.
- **Realtime:** Socket.IO via a NestJS WebSocket gateway at `/api/socket.io`.
- **Object storage:** MinIO (S3-compatible) container for task attachments;
  accessed with `@aws-sdk/client-s3`, uploads via `multer`. The backend proxies
  up/downloads — MinIO is never exposed to clients. Same code works against real
  AWS S3 by changing `S3_ENDPOINT` / credentials.
- **Auth:** JWT access + rotating refresh, bcrypt password hashing. Per-project
  roles: owner > ADMIN > EDITOR (default; auto-assigned to task assignees) >
  VIEWER — enforced via `ProjectsService.roleIn/assertRole`.
- **Tests:** Jest (backend), Vitest + React Testing Library (frontend).
- **Infra:** Docker (multi-stage), nginx reverse proxy in prod, GitHub Actions CI/CD.

## Repo layout

```
backend/    NestJS API — src/ modules (auth, users, projects, tasks, comments,
            labels, activity, notifications, admin, realtime, storage,
            attachments, health, config), prisma/ (schema, migrations, seed),
            test/ (e2e), Dockerfile
frontend/   React SPA — src/ (pages, components, api client, auth context), nginx.conf, Dockerfile
deploy/     edge.conf — production reverse-proxy config (HTTP + WebSocket upgrade)
.github/    workflows: ci.yml (PRs), dev-cd.yml (push to dev), prod-cd.yml (push to main)
docker-compose.yml        local dev stack (builds from source)
docker-compose.prod.yml   prod stack (pulls images from Docker Hub)
Makefile, .env.example
```

## How to run / test

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec backend npx prisma migrate deploy   # applies committed migrations
# seed REQUIRES SEED_* passwords (no defaults); pass them inline for local runs:
docker compose exec \
  -e SEED_ADMIN_PASSWORD=admin1234 -e SEED_TEST_PASSWORD=test1234 \
  backend npm run prisma:seed                            # creates test users
```

- Frontend http://localhost:5173 · API http://localhost:3000/api · Swagger `/api/docs`
- Health: `/api/health/live` (process), `/api/health/ready` (DB ping)

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
npm run test:cov                          # coverage
npm run lint                              # eslint, --max-warnings=0

# Frontend (Vite / Vitest) — from frontend/
npm test                                  # vitest run (one-shot)
npm test -- ProjectsPage                  # files/tests matching a pattern
npm run test:watch                        # watch mode
npm run lint                              # eslint, --max-warnings=0

# In-container equivalents
make test-backend   # docker compose exec backend npm test
make test-frontend  # docker compose exec frontend npm test
```

CI (`ci.yml`) runs `npm run lint` + tests for both packages — lint is gated at
zero warnings, so treat warnings as errors.

**Seeded accounts**: `admin@tracker.local` and `test@tracker.local`. Passwords have
no defaults — they are taken from the required `SEED_ADMIN_PASSWORD` /
`SEED_TEST_PASSWORD` env vars at seed time (the snippet above uses admin1234 /
test1234 as examples). In prod they come from GitHub Secrets.

## Conventions

- **Backend:** modular NestJS; validate input with `class-validator` DTOs (a global
  `ValidationPipe` runs with `whitelist` + `forbidNonWhitelisted` + `transform`).
  Prisma is the source of truth — change `prisma/schema.prisma` then create a
  migration. Structured logging via `nestjs-pino` (JSON to stdout; the pretty
  transport is intentionally disabled for Docker stability — do not re-add a
  `pino-pretty` worker transport).
- **Frontend:** React hooks + Context for auth; Axios client with an interceptor
  that auto-refreshes on 401; TailwindCSS for styling.
- **Migrations:** committed under `backend/prisma/migrations/`. Apply with
  `prisma migrate deploy`; create new ones with `prisma migrate dev --name <x>`.
- **Secrets/env:** never commit `.env`. Runtime config comes from env vars
  (see README §"Environment variables").

## Gotchas

- The backend Dockerfile runs `npm prune --omit=dev`, so anything needed at
  runtime (e.g. `prisma`, `ts-node`, `typescript`, `pino-pretty`) must live in
  `dependencies`, not `devDependencies`.
- `docker-compose.yml` sets `NODE_ENV=development` even though the image is a
  prod build — keep this in mind when gating behaviour on `NODE_ENV`.
