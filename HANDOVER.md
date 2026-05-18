# Handover — что сделано и что делать дальше

Этот файл — краткая выжимка для тебя как DevOps-инженера, который принимает проект «как есть» и должен поднять, настроить и обслуживать его. Полная техническая документация — в [README.md](./README.md).

---

## Что готово в репозитории

**Backend (NestJS + Prisma)** — `backend/`
- Модули: auth (JWT access + ротация refresh, bcrypt), users, projects, tasks, comments, health
- Health-эндпоинты: `/api/health/live` + `/api/health/ready` (пинг БД через Prisma)
- Swagger на `/api/docs`, валидация DTO, rate-limit, helmet, структурированные JSON-логи (Pino) с redact'ом токенов
- Prisma-схема, seed-скрипт, юнит-тесты (auth, projects) + e2e-тест health'а
- Multi-stage `Dockerfile` (non-root, tini, `HEALTHCHECK`)

**Frontend (React + Vite + TS + Tailwind)** — `frontend/`
- Страницы: Login, Register, Projects (list+create+delete), Project detail (Kanban-доска со сменой статусов кнопками, комментарии, назначения)
- Axios-клиент с автоматическим refresh при 401
- `Dockerfile` (multi-stage) + nginx с SPA-фолбэком и `/healthz`

**Инфра** — корень
- `docker-compose.yml` (dev): postgres + redis + backend + frontend, healthcheck'и, `depends_on` с условиями
- `docker-compose.prod.yml`: тянет образы из Docker Hub + edge-nginx (`deploy/edge.conf`)
- `Makefile` с командами для dev и prod
- `.env.example` с пояснениями по каждой переменной

**CI/CD** — `.github/workflows/`
- `ci.yml` — тесты backend (с реальным Postgres в `services`) + frontend на PR/push
- `release.yml` — матрица build+push в Docker Hub (теги: `latest`, `sha-...`, `v*`), `gha`-кэш
- `deploy.yml` — SSH на VPS → pull → миграции → up → readiness-probe; ручной запуск с выбором тега

---

## Что делать дальше — пошагово

### 1. Инициализировать git и запушить на GitHub
См. отдельный раздел в этом же файле ниже («Создание репозитория из проводника через Git Bash»).

### 2. Поднять локально (sanity check, ещё до VPS)
```bash
cp .env.example .env

# ОДИН РАЗ: сгенерить начальную миграцию (папка prisma/migrations/ не в репо).
docker compose up -d postgres
docker compose run --rm backend npx prisma migrate dev --name init --skip-seed
# Закоммитить созданный backend/prisma/migrations/.

# Дальше штатно:
docker compose up -d --build
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npm run prisma:seed
```
Открыть:
- http://localhost:5173 (фронт; логин `alice@example.com` / `password123`)
- http://localhost:3000/api/docs (Swagger)
- http://localhost:3000/api/health/ready (должно вернуть `ok`)

### 3. Подготовить Docker Hub
1. Завести аккаунт на hub.docker.com.
2. В **Account Settings → Personal access tokens** создать токен с правами Read/Write.
3. Запомнить username и токен — пригодятся для GitHub Secrets.

### 4. Поднять VPS (bootstrap, один раз)
Подробно — раздел «6. VPS bootstrap» в README. Кратко:
- поставить `docker.io` + `docker-compose-plugin`
- завести пользователя `deploy`, добавить его в группу `docker`
- сгенерить SSH-ключ для CI (`ssh-keygen -t ed25519 -C "github-actions"`), публичный положить в `/home/deploy/.ssh/authorized_keys`, **приватный** сохранить — он пойдёт в GitHub Secret `VPS_SSH_KEY`
- создать директорию `/home/deploy/tracker`, положить туда:
  - `docker-compose.prod.yml` (из репо)
  - `deploy/edge.conf` (из репо)
  - `.env` — заполнить продовыми значениями, **не коммитить**

### 5. Завести GitHub Secrets и Variables
**Settings → Secrets and variables → Actions**

Secrets:
| Имя | Значение |
|---|---|
| `DOCKERHUB_USERNAME` | имя пользователя на Docker Hub |
| `DOCKERHUB_TOKEN` | токен из шага 3 |
| `VPS_HOST` | IP или домен VPS |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | приватный ключ из шага 4 (целиком, включая `-----BEGIN/END-----`) |
| `VPS_DEPLOY_DIR` | `/home/deploy/tracker` |

Variables:
| Имя | Значение |
|---|---|
| `VITE_API_URL` | публичный URL API, например `https://tracker.example.com/api` |

### 6. Первый деплой
Пушни любой коммит в `main` — `release.yml` соберёт и запушит образы, `deploy.yml` раскатит на VPS. Если что-то падает — открой Actions, лог покажет, где упало.

### 7. Дальше — твоя «домашка»
Чеклист в разделе **«8. DevOps practice ideas»** README. Что больше всего ценится в резюме для middle:
- Loki + Promtail + Grafana для логов
- Prometheus + node-exporter + cAdvisor + Grafana для метрик
- Автоматизированные `pg_dump` → S3/Backblaze + **протестированный** restore
- Trivy/grype-сканирование образов перед push
- Замена SSH-деплоя на Ansible-плейбук, потом — Terraform под сам VPS
- Перенос на k8s (kind/minikube локально → managed cluster)

Когда у тебя три-четыре пункта работают end-to-end и ты можешь это рассказать — это уже сильный middle.

---

## Создание репозитория из проводника через Git Bash

У тебя ситуация «наоборот»: код уже лежит локально, репозитория на GitHub ещё нет. Поток такой:

### Вариант A — через веб-интерфейс GitHub (классика)

**1. Создать пустой репо на GitHub.com**
- Зайти на github.com → справа сверху `+` → **New repository**
- Имя репо: например `devops-tracker`
- Видимость: Private или Public — твой выбор
- **Не ставить галочки** «Add README», «Add .gitignore», «Add license» — у нас уже всё своё, иначе будет конфликт
- Нажать **Create repository**
- GitHub покажет страницу с командами — оттуда нам нужен только URL вида `https://github.com/<твой-username>/devops-tracker.git`

**2. Открыть Git Bash в папке проекта**
Через проводник:
- Открыть `C:\web\DevOps-Web` в проводнике
- Правый клик на пустом месте внутри папки → **Open Git Bash here**
  *(если такого пункта нет — у тебя не установлен Git for Windows, поставь с https://git-scm.com/download/win)*

**3. Проверить, кто ты в git (один раз на машину)**
```bash
git config --global user.name "Твоё Имя"
git config --global user.email "egor.kiselman@gmail.com"
git config --global init.defaultBranch main
```

**4. Инициализировать репо и сделать первый коммит**
```bash
git init
git status                        # глянуть, что git видит как новые файлы
git add .
git commit -m "Initial commit: NestJS + React + Docker + CI/CD"
```

**5. Привязать GitHub-репо как remote и запушить**
Подставь свой URL из шага 1:
```bash
git branch -M main
git remote add origin https://github.com/<твой-username>/devops-tracker.git
git push -u origin main
```

При первом пуше Git Bash запросит логин/пароль. **Пароль больше не работает** — нужен Personal Access Token:
- GitHub → Settings (профиля) → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token
- Scopes: минимум `repo`
- Скопировать токен (показывается один раз)
- В Git Bash при запросе пароля вставить токен

Чтобы Git не спрашивал токен каждый раз — он сохранится в Credential Manager автоматически на Windows.

**6. Проверить**
Обнови страницу репо на GitHub — файлы должны появиться. Перейди во вкладку **Actions** — там сразу запустится `ci.yml` (а после настройки секретов — `release.yml`).

---

### Вариант B — через GitHub CLI (быстрее, если ставил `gh`)

Если установлен [GitHub CLI](https://cli.github.com/):

```bash
cd /c/web/DevOps-Web        # в Git Bash так пишется путь
gh auth login               # один раз, выбрать HTTPS + браузерную авторизацию
git init
git add .
git commit -m "Initial commit"
gh repo create devops-tracker --private --source=. --remote=origin --push
```

Одна команда `gh repo create` и создаёт репо на GitHub, и привязывает remote, и пушит. Удобно, если будешь делать ещё пет-проекты — стоит поставить.

---

## Полезные команды на каждый день

```bash
# Посмотреть, что изменилось
git status
git diff

# Сохранить изменения
git add .
git commit -m "feat: add monitoring stack"
git push

# Создать ветку под фичу (вместо push прямо в main)
git checkout -b feature/loki-logging
# ... коммиты ...
git push -u origin feature/loki-logging
# дальше создаёшь Pull Request в веб-интерфейсе GitHub

# Подтянуть изменения с GitHub (если что-то редактировал в вебе)
git pull
```

Маленький совет: **не пуш в `main` напрямую**, как только репо ожил — делай ветки и PR. Заодно `ci.yml` отработает на PR и ты увидишь, проходят ли тесты, до того как сольёшь в `main` и оно поедет на прод.







  Что починил

  HIGH — безопасность и логика                                                                                            - backend/src/auth/auth.service.ts:67-82 — refresh теперь атомарный (deleteMany одним запросом), при повторном
  использовании токена сносит всё семейство пользователя                                                                  - backend/src/auth/auth.controller.ts — на /register, /login, /refresh отдельный жёсткий throttle (10/мин), чтобы
  общий 120/мин не помогал брутфорсу
  - frontend/src/api/client.ts — interceptor больше не блокирует refresh на /auth/me (раньше любой /auth/* исключался —
  токен переставал обновляться)
  - backend/src/tasks/tasks.service.ts — добавлен assertAssigneeExists, в create/update явная деструктуризация полей
  вместо ...dto (нельзя протащить лишние ключи в Prisma)

  MED — инфра и конфиги
  - docker-compose.yml — postgres/redis забинжены на 127.0.0.1 (а не на 0.0.0.0)
  - docker-compose.prod.yml — CORS_ORIGINS:?... (fail-fast если не задано), переименовал DOCKERHUB_USER →
  DOCKERHUB_USERNAME чтобы совпадало с GitHub secret
  - .env.example — то же переименование + комментарий что VITE_API_URL это билдовый аргумент только для dev compose
  - .github/workflows/ci.yml и deploy.yml — permissions: contents: read, script_stop: true, убран бесполезный envs:
  IMAGE_TAG
  - Makefile — SHELL := /usr/bin/env bash (на Windows через Git Bash таргеты работали через раз)
  - Удалил backend/docker-entrypoint.sh (не COPY'ился в образ, миграции и так гонит deploy.yml)
  - backend/src/auth/auth.service.spec.ts — добавлен мок refreshToken.deleteMany под новый auth.service
  - README + HANDOVER — добавлен шаг с генерацией начальной миграции

  Что осталось руками сделать тебе

  Один обязательный шаг перед первым пушем — сгенерить начальную миграцию (папки backend/prisma/migrations/ в репо нет,
  и без неё prisma migrate deploy в CI/проде упадёт):

  cp .env.example .env
  docker compose up -d postgres
  docker compose run --rm backend npx prisma migrate dev --name init --skip-seed
  # затем закоммитить созданный backend/prisma/migrations/

  Дальше всё по HANDOVER.md: git init → пуш на GitHub → Docker Hub токен → секреты в GitHub → bootstrap VPS. Проект
  теперь в состоянии «можно катить и не стыдно показывать на собесе как стартовую точку».