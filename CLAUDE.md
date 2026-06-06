# CLAUDE.md — guide for AI agents working in this repo

This is the working brief for an AI agent (Claude) operating on this codebase.
For the human-facing technical description see [README.md](./README.md); for the
step-by-step local run on Windows + Docker see [RUNNING-WINDOWS.md](./RUNNING-WINDOWS.md).

## What this project is

Task Tracker — a small REST + SPA "mini-Jira" used as a DevOps practice ground:
multi-service Docker Compose, Prisma migrations, JWT auth, health probes,
structured logs, Docker Hub releases and an SSH deploy to a Linux VPS.

## Stack

- **Backend:** NestJS 10 (TypeScript) + Prisma 5, PostgreSQL 16, Redis 7 (rate limiting).
- **Frontend:** React 18 + Vite + TypeScript + TailwindCSS.
- **Auth:** JWT access + rotating refresh, bcrypt password hashing.
- **Tests:** Jest (backend), Vitest + React Testing Library (frontend).
- **Infra:** Docker (multi-stage), nginx reverse proxy in prod, GitHub Actions CI/CD.

## Repo layout

```
backend/    NestJS API — src/ modules (auth, users, projects, tasks, comments, health, config),
            prisma/ (schema, migrations, seed), test/ (e2e), Dockerfile
frontend/   React SPA — src/ (pages, components, api client, auth context), nginx.conf, Dockerfile
deploy/     edge.conf — production reverse-proxy config
.github/    workflows: ci.yml, release.yml, deploy.yml
docker-compose.yml        local dev stack (builds from source)
docker-compose.prod.yml   prod stack (pulls images from Docker Hub)
Makefile, .env.example
```

## How to run / test

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec backend npx prisma migrate deploy   # applies committed migrations
docker compose exec backend npm run prisma:seed         # creates test users
```

- Frontend http://localhost:5173 · API http://localhost:3000/api · Swagger `/api/docs`
- Health: `/api/health/live` (process), `/api/health/ready` (DB ping)
- Tests: `make test-backend` (Jest), `cd frontend && npm test` (Vitest), `make lint`

**Seeded accounts**: `admin@tracker.local` / `admin1234` and `test@tracker.local` / `test1234`.
Override passwords at seed time with `SEED_ADMIN_PASSWORD` / `SEED_TEST_PASSWORD` env vars.

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
