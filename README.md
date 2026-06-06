# Task Tracker — техническое описание

Небольшое REST + SPA приложение «таск-трекер» (mini-Jira), собранное как
учебно-практический стенд для DevOps: мультисервисный Docker Compose, миграции
Prisma, JWT-аутентификация, health-пробы, структурированные логи, релизы в Docker
Hub и деплой по SSH на Linux-VPS.

Связанные документы:
- [RUNNING-WINDOWS.md](./RUNNING-WINDOWS.md) — пошаговый локальный запуск на Windows + Docker.
- [CLAUDE.md](./CLAUDE.md) — справочник для AI-агентов, работающих с репозиторием.

---

## 1. Стек

| Слой | Технология |
|---|---|
| Backend | NestJS 10 (TypeScript) + Prisma 5 |
| База данных | PostgreSQL 16 |
| Кэш / rate-limit | Redis 7 |
| Frontend | React 18 + Vite + TypeScript + TailwindCSS |
| Auth | JWT (access + ротация refresh), bcrypt |
| Тесты | Jest (backend), Vitest (frontend) |
| Reverse proxy (prod) | nginx (`deploy/edge.conf`) |
| CI / CD | GitHub Actions → Docker Hub → SSH на VPS |

---

## 2. Архитектура

- **Backend** — модульное NestJS-приложение: `auth` (JWT access + ротация refresh,
  bcrypt), `users`, `projects`, `tasks`, `comments`, `health`, `config`.
  Глобальный `ValidationPipe` (`whitelist` + `forbidNonWhitelisted` + `transform`),
  `helmet`, rate-limit (`@nestjs/throttler` + Redis), структурированные JSON-логи
  (`nestjs-pino`) с redact'ом заголовков `Authorization`/`Cookie`.
- **Frontend** — SPA на React: страницы Login/Register, список проектов, детальная
  страница проекта (Kanban-доска, комментарии, назначения). Axios-клиент с
  interceptor'ом, автоматически обновляющим access-токен по 401.
- **БД** — Prisma как source of truth (`backend/prisma/schema.prisma`). Сущности:
  `User`, `Project`, `Task`, `Comment`, `RefreshToken`.
- **Прод** — образы собираются в CI и публикуются в Docker Hub; на VPS их тянет
  `docker-compose.prod.yml`, перед edge-nginx (`deploy/edge.conf`).

### Структура репозитория

```
backend/                 NestJS API
  prisma/                схема, миграции, seed
  src/                   модули: auth, users, projects, tasks, comments, health, config
  test/                  e2e-тесты
  Dockerfile             multi-stage, non-root, с HEALTHCHECK
frontend/                React SPA
  src/                   страницы, компоненты, API-клиент, auth-контекст
  nginx.conf             SPA-фолбэк + /healthz
  Dockerfile             multi-stage build → nginx
deploy/edge.conf         продовый reverse-proxy
docker-compose.yml       локальный dev-стек (сборка из исходников)
docker-compose.prod.yml  прод-стек (образы из Docker Hub)
Makefile                 частые операционные команды
.env.example             шаблон переменных окружения
.github/workflows/       ci.yml, release.yml, deploy.yml
```

---

## 3. Быстрый старт (локально)

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec backend npx prisma migrate deploy   # идемпотентно; миграции в репо
docker compose exec backend npm run prisma:seed
```

Адреса:
- Frontend — <http://localhost:5173>
- API — <http://localhost:3000/api>
- Swagger — <http://localhost:3000/api/docs>
- Health: `/api/health/live` (процесс), `/api/health/ready` (пинг БД)

**Тестовые пользователи**: `admin@tracker.local` / `admin1234` и `test@tracker.local` / `test1234`.
Свои пароли при сиде: `SEED_ADMIN_PASSWORD=... SEED_TEST_PASSWORD=... npm run prisma:seed`.

Подробная инструкция для Windows — в [RUNNING-WINDOWS.md](./RUNNING-WINDOWS.md).
`make help` показывает основные операционные команды.

---

## 4. Переменные окружения

Все объявлены в `.env.example` (корень, используется Compose) и
`backend/.env.example` (для запуска бэкенда вне контейнеров).

| Переменная | Где | Default | Назначение |
|---|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | tracker | Bootstrap Postgres |
| `DATABASE_URL` | backend | (из значений выше) | Строка подключения Prisma |
| `REDIS_HOST` / `REDIS_PORT` | backend | redis / 6379 | Подключение к Redis |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | backend | **сменить в prod** | Ключи подписи JWT |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | backend | 15m / 7d | Время жизни токенов |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | backend | 60 / 120 | Окно / квота rate-limit |
| `CORS_ORIGINS` | backend | http://localhost:5173 | Разрешённые origins (через запятую) |
| `LOG_LEVEL` | backend | info | Уровень логов Pino |
| `VITE_API_URL` | frontend build arg | http://localhost:3000/api | Зашивается в бандл (только dev compose). Для prod задаётся как GitHub repo variable и инжектится `release.yml` при сборке. |
| `DOCKERHUB_USERNAME` | prod compose | — | Namespace образов в Docker Hub (совпадает с GitHub secret) |
| `IMAGE_TAG` | prod compose | latest | Тег раскатываемого образа |

Сгенерировать прод-секреты: `openssl rand -base64 48`.

---

## 5. База данных и миграции

Prisma — source of truth, схема в `backend/prisma/schema.prisma`. Начальная
миграция закоммичена в `backend/prisma/migrations/`, поэтому стенд поднимается без
ручной генерации.

| Действие | Команда |
|---|---|
| Применить миграции (любая среда) | `make migrate` (`prisma migrate deploy`) |
| Создать новую миграцию (dev) | `make migrate-dev` (`prisma migrate dev --name <x>`) |
| Запустить seed | `make seed` |
| Открыть `psql` | `make shell-db` |

В деплое миграции применяются автоматически (workflow `deploy.yml`) **до** выката
новых контейнеров приложения.

---

## 6. CI/CD

Ветка `main` — деплой-trunk.

```
PR → ci.yml (lint + тесты)
push в main → release.yml (build + push :latest и :sha-XXXX в Docker Hub)
            → deploy.yml (SSH на VPS: pull → миграции → up → readiness-probe)
```

### GitHub Secrets

| Secret | Используется | Значение |
|---|---|---|
| `DOCKERHUB_USERNAME` | release.yml | username в Docker Hub |
| `DOCKERHUB_TOKEN` | release.yml | access-token Docker Hub (не пароль) |
| `VPS_HOST` | deploy.yml | хост/IP VPS |
| `VPS_USER` | deploy.yml | SSH-пользователь (например `deploy`) |
| `VPS_SSH_KEY` | deploy.yml | приватный ключ, чей публичный авторизован на VPS |
| `VPS_DEPLOY_DIR` | deploy.yml | путь на VPS с `docker-compose.prod.yml` + `.env` |

### GitHub Variables

| Variable | Значение |
|---|---|
| `VITE_API_URL` | публичный URL API, например `https://tracker.example.com/api` |

---

## 7. Деплой на VPS (bootstrap, один раз)

На свежем Linux-VPS (Ubuntu/Debian):

```bash
# Системные пакеты
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git curl
sudo systemctl enable --now docker

# Пользователь deploy
sudo useradd -m -s /bin/bash deploy && sudo usermod -aG docker deploy
sudo mkdir -p /home/deploy/.ssh
# положить публичный CI-ключ в /home/deploy/.ssh/authorized_keys (chmod 700 .ssh, 600 authorized_keys)

# Каталог деплоя
sudo -u deploy mkdir -p /home/deploy/tracker
# скопировать в него docker-compose.prod.yml, deploy/edge.conf и заполненный .env (НЕ коммитить)

# Первый деплой вручную (до того как CI возьмёт управление)
cd /home/deploy/tracker
docker login
docker compose -f docker-compose.prod.yml --env-file .env pull
docker compose -f docker-compose.prod.yml --env-file .env run --rm backend npx prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Задать `VPS_DEPLOY_DIR=/home/deploy/tracker` в GitHub Secrets.

**TLS.** Сервис `edge` отдаёт plain HTTP. Для prod поставь спереди Caddy
(авто-HTTPS в одну строку), Traefik или Let's Encrypt + certbot.

---

## 8. Observability

Стенд намеренно «голый» — стек наблюдаемости подключается под себя.

- **Логи:** Pino → stdout (JSON). `redact` вырезает заголовки `Authorization` и
  `Cookie`. Сбор — Loki / ELK / Vector на выбор.
- **Health-пробы:** `/api/health/live` (процесс жив) и `/api/health/ready`
  (БД доступна) — заводятся в мониторинг аптайма.
- **Метрики:** пока не экспонированы — можно добавить `@willsoto/nestjs-prometheus`
  и эндпоинт `/metrics` за внутренним ACL.
- **Tracing:** при желании — OpenTelemetry SDK в `main.ts` с OTLP-экспортом.

---

## 9. Шпаргалка команд

```bash
make up              # поднять стек
make migrate         # применить миграции
make seed            # засидить данные
make logs            # смотреть логи
make shell-backend   # шелл в backend-контейнере
make shell-db        # psql в postgres
make test-backend    # юнит-тесты backend
make down            # остановить

# Прод (на VPS)
make prod-pull       # подтянуть образы
make prod-migrate    # применить миграции
make prod-up         # выкатить
make prod-logs       # логи прода
```
