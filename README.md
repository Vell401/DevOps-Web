# Task Tracker — DevOps pet-project

A small REST + SPA Task Tracker (think mini-Jira) intentionally shaped to give a DevOps engineer a realistic surface area to practice on: multi-service compose, migrations, JWT auth, health probes, structured logs, Docker Hub releases, and an SSH-based deploy to a Linux VPS.

The application code is provided as a **starting point** — your job is to harden, automate and operate it.

---

## 1. Stack

| Layer       | Tech                                          |
|-------------|-----------------------------------------------|
| Backend     | NestJS 10 (TypeScript) + Prisma 5             |
| Database    | PostgreSQL 16                                 |
| Cache / RL  | Redis 7                                       |
| Frontend    | React 18 + Vite + TypeScript + TailwindCSS    |
| Auth        | JWT (access + rotating refresh) with bcrypt   |
| Tests       | Jest (backend), Vitest (frontend)             |
| Reverse proxy (prod) | nginx (`deploy/edge.conf`)           |
| CI / CD     | GitHub Actions → Docker Hub → SSH to VPS      |

### Repository layout

```
.
├── backend/                NestJS API
│   ├── prisma/             Schema, migrations, seed
│   ├── src/                Modules: auth, users, projects, tasks, comments, health, config
│   ├── test/               e2e tests
│   └── Dockerfile          Multi-stage, non-root, with HEALTHCHECK
├── frontend/               React SPA
│   ├── src/                Pages, components, API client, auth context
│   ├── nginx.conf          SPA fallback + /healthz
│   └── Dockerfile          Multi-stage build → nginx runtime
├── deploy/
│   └── edge.conf           Production reverse-proxy config
├── docker-compose.yml      Local dev stack (builds locally)
├── docker-compose.prod.yml Production stack (pulls from Docker Hub)
├── Makefile                Common operational commands
├── .env.example            Top-level env template
└── .github/workflows/
    ├── ci.yml              Lint + tests on PR / push
    ├── release.yml         Build + push images on push to main / tags
    └── deploy.yml          SSH deploy to VPS
```

---

## 2. Local quickstart

```bash
cp .env.example .env
# Optional: cp backend/.env.example backend/.env (only needed when running backend outside Docker)

# --- ONE-TIME: generate the initial Prisma migration ---
# prisma/migrations/ is not committed — every fork bootstraps its own.
# This step uses the dev DB to derive the migration SQL from prisma/schema.prisma.
docker compose up -d postgres
docker compose run --rm backend npx prisma migrate dev --name init --skip-seed
# Now commit the generated backend/prisma/migrations/ directory.

# --- Day-to-day ---
docker compose up -d --build
docker compose exec backend npx prisma migrate deploy   # idempotent
docker compose exec backend npm run prisma:seed
```

Open:
- Frontend: <http://localhost:5173>
- API: <http://localhost:3000/api>
- Swagger: <http://localhost:3000/api/docs>
- Liveness: `GET /api/health/live`
- Readiness (DB ping): `GET /api/health/ready`

Seeded users (password `password123`): `alice@example.com`, `bob@example.com`.

`make help` lists the most common operational commands.

---

## 3. Environment variables

All vars are declared in `.env.example` (root, used by Compose) and `backend/.env.example` (used when running the backend outside containers).

| Var | Where | Default | Purpose |
|---|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | tracker | Postgres bootstrap |
| `DATABASE_URL` | backend | (built from above) | Prisma connection string |
| `REDIS_HOST` / `REDIS_PORT` | backend | redis / 6379 | Redis connection |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | backend | **change in prod** | JWT signing keys |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | backend | 15m / 7d | Token lifetimes |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | backend | 60 / 120 | Rate limit window / quota |
| `CORS_ORIGINS` | backend | http://localhost:5173 | Comma-separated allowed origins |
| `LOG_LEVEL` | backend | info | Pino log level |
| `VITE_API_URL` | frontend build arg | http://localhost:3000/api | Baked into SPA bundle (dev compose only). For prod, set as GitHub repo variable so `release.yml` injects it at build time. |
| `DOCKERHUB_USERNAME` | prod compose | — | Docker Hub namespace for images (same value as the GitHub secret). |
| `IMAGE_TAG` | prod compose | latest | Image tag rolled out |

Generate prod secrets with:

```bash
openssl rand -base64 48
```

---

## 4. Database & migrations

Prisma is the source of truth. Schema lives at `backend/prisma/schema.prisma`.

| Action | Command |
|---|---|
| Bootstrap initial migration (one-time, per fork) | `docker compose run --rm backend npx prisma migrate dev --name init --skip-seed` |
| Create a new migration (dev) | `make migrate-dev` |
| Apply pending migrations (any env) | `make migrate` |
| Run the seed | `make seed` |
| Open `psql` | `make shell-db` |

Commit the generated `backend/prisma/migrations/` directory to git. Migrations are applied automatically by the deploy workflow **before** rolling out new app containers.

---

## 5. CI/CD — what to wire up

The `main` branch is treated as the deployable trunk. Pipeline overview:

```
PR → ci.yml (lint + tests)
push to main → release.yml (build + push :latest + :sha-XXXX to Docker Hub)
              → deploy.yml (SSH to VPS, pull, migrate, restart, readiness probe)
```

### GitHub secrets to create

| Secret | Used by | Value |
|---|---|---|
| `DOCKERHUB_USERNAME` | release.yml | Docker Hub username |
| `DOCKERHUB_TOKEN` | release.yml | Docker Hub access token (not password) |
| `VPS_HOST` | deploy.yml | VPS hostname or IP |
| `VPS_USER` | deploy.yml | SSH user (e.g. `deploy`) |
| `VPS_SSH_KEY` | deploy.yml | Private key matching an authorised public key on the VPS |
| `VPS_DEPLOY_DIR` | deploy.yml | Absolute path on the VPS where `docker-compose.prod.yml` + `.env` live |

### GitHub variables to create

| Var | Value |
|---|---|
| `VITE_API_URL` | Public URL of the API, e.g. `https://tracker.example.com/api` — baked into the SPA |

---

## 6. VPS bootstrap (one-time)

On a fresh Linux VPS (Ubuntu / Debian assumed):

```bash
# 1. System packages
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git curl
sudo systemctl enable --now docker

# 2. Dedicated deploy user
sudo useradd -m -s /bin/bash deploy
sudo usermod -aG docker deploy
sudo mkdir -p /home/deploy/.ssh
sudo cp ~/.ssh/authorized_keys /home/deploy/.ssh/   # or paste the CI public key
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys

# 3. Deploy directory
sudo -u deploy mkdir -p /home/deploy/tracker
cd /home/deploy/tracker

# 4. Place these two files (copy from your laptop with scp or paste):
#    - docker-compose.prod.yml
#    - .env                     (filled-in production values, NOT committed to git)
#    - deploy/edge.conf         (if you want the reverse proxy)

# 5. First deploy (manually, before CI takes over)
docker login   # one time, so prod can pull private images if needed
docker compose -f docker-compose.prod.yml --env-file .env pull
docker compose -f docker-compose.prod.yml --env-file .env run --rm backend npx prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Set `VPS_DEPLOY_DIR=/home/deploy/tracker` in GitHub secrets.

### Putting TLS in front

The repo's `edge` service is plain HTTP. For prod use one of:
- **Caddy** in front of port 80 (1-line auto-HTTPS) — simplest
- **Traefik** as the edge instead of the bundled nginx
- **Let's Encrypt + certbot** mounted into the `edge` container

Pick one and document it in your fork.

---

## 7. Observability

The starter is intentionally bare so you can wire your preferred stack.

- **Logs:** Pino → stdout, JSON in prod, pretty in dev. `redact` strips `Authorization` and `Cookie` headers. Ship with Loki / ELK / Vector — your call.
- **Health probes:** `/api/health/live` (process up) and `/api/health/ready` (DB reachable). Wire these into your VPS uptime monitor (UptimeRobot / BetterStack / Prometheus blackbox-exporter).
- **Metrics:** not exposed yet — add `@willsoto/nestjs-prometheus` or similar and a `/metrics` endpoint guarded by an internal network ACL.
- **Tracing:** add OpenTelemetry SDK in `main.ts` if you want OTLP export.

---

## 8. DevOps practice ideas (your homework)

These are deliberately not implemented — they are what makes the project worth shipping on a CV:

**Pipelines**
- [ ] Add an ESLint config and fail CI on warnings
- [ ] Add a `docker-compose` job that boots the stack and curls `/api/health/ready` (true smoke test)
- [ ] Cache Prisma client + npm between CI jobs
- [ ] Add `trivy` / `grype` image scanning before push
- [ ] Sign images with cosign

**Infrastructure**
- [ ] Replace SSH deploy with Ansible playbook, then with Terraform-provisioned infra
- [ ] Put Caddy/Traefik in front for auto-HTTPS
- [ ] Set up offsite `pg_dump` backups (cron + S3/Backblaze) — test the restore!
- [ ] Move secrets into Vault / Doppler / SOPS instead of a `.env` file
- [ ] Take the same stack to k8s — minikube/kind locally, then a managed cluster

**Observability**
- [ ] Loki + Promtail + Grafana for logs
- [ ] Prometheus + node-exporter + cAdvisor + alertmanager
- [ ] Add Prometheus metrics to the NestJS app
- [ ] Build a "golden signals" dashboard (latency, traffic, errors, saturation)

**Reliability**
- [ ] Zero-downtime deploys (`--scale backend=2` + healthcheck wait)
- [ ] Blue-green or canary via Traefik weighted routing
- [ ] Add a `make rollback` target that pins `IMAGE_TAG` to the previous tag
- [ ] Chaos test: kill the DB mid-request, kill backend, fill the disk

When you can demonstrate three or four of these end-to-end, you'll have plenty to talk about in a middle-level interview.

---

## 9. Useful commands cheat sheet

```bash
# Dev
make up              # start everything
make migrate         # apply DB migrations
make seed            # seed sample data
make logs            # tail logs
make shell-backend   # shell in backend container
make shell-db        # psql in postgres
make test-backend    # unit tests
make down            # stop everything

# Prod (on the VPS)
make prod-pull       # pull new images
make prod-migrate    # apply migrations
make prod-up         # roll out
make prod-logs       # tail prod logs
```
