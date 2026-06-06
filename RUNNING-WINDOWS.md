# Локальный запуск и тестирование на Windows (Docker)

Пошаговая инструкция, как поднять и проверить проект на Windows-машине с Docker.
Техническое описание проекта — в [README.md](./README.md).

---

## 1. Предпосылки

- **Docker Desktop** для Windows (с включённым **WSL2**-бэкендом — это дефолт).
  Проверка: открой PowerShell и выполни `docker version` и `docker compose version`.
- **Git for Windows** (если будешь клонировать репозиторий).
- Свободные порты на хосте: `5173` (фронтенд), `3000` (API), `5432` (Postgres),
  `6379` (Redis). Postgres/Redis биндятся только на `127.0.0.1`.

> Все команды ниже работают в PowerShell. В Git Bash они тоже работают; отличается
> только копирование `.env` (`copy` в PowerShell против `cp` в Git Bash).

---

## 2. Первый запуск

```powershell
# 1. Скопировать шаблон переменных окружения
copy .env.example .env

# 2. Собрать и поднять весь стек (postgres + redis + backend + frontend)
docker compose up -d --build

# 3. Применить миграции БД (миграции уже в репозитории — создаются таблицы)
docker compose exec backend npx prisma migrate deploy

# 4. Засидить тестовые данные (пользователи + демо-проект с задачами)
docker compose exec backend npm run prisma:seed
```

После этого открой:

- Фронтенд: <http://localhost:5173>
- API: <http://localhost:3000/api>
- Swagger: <http://localhost:3000/api/docs>
- Liveness: <http://localhost:3000/api/health/live>
- Readiness (пинг БД): <http://localhost:3000/api/health/ready> — должно вернуть `ok`

---

## 3. Тестовые учётки для входа

Засеяны две учётки:

| Email                  | Пароль      | Назначение                |
|------------------------|-------------|---------------------------|
| `admin@tracker.local`  | `admin1234` | Владелец demo-проектов    |
| `test@tracker.local`   | `test1234`  | Для тестов assignment-ов  |

Войди на <http://localhost:5173> с любой из них. Можно проверить и через API:

```powershell
curl -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" `
  -d "{\"email\":\"admin@tracker.local\",\"password\":\"admin1234\"}"
```

Хочешь свои пароли — задай env-переменные перед сидом:

```powershell
$env:SEED_ADMIN_PASSWORD = "тут-длинный-пароль"
$env:SEED_TEST_PASSWORD = "another-pass"
docker compose exec backend npm run prisma:seed
```

Ответ — пара JWT-токенов (`accessToken` + `refreshToken`).

---

## 4. Прогон тестов

```powershell
# Backend (Jest) — в контейнере
docker compose exec backend npm test

# Frontend (Vitest) — в контейнере
docker compose exec frontend npm test   # если фронт-контейнер без dev-зависимостей,
                                         # запусти локально: cd frontend && npm install && npm test

# Линт бэкенда
docker compose exec backend npm run lint
```

> На хосте без Docker тесты тоже гоняются: `cd backend && npm install && npm test`
> (нужен Node.js 20) и `cd frontend && npm install && npm test`.

---

## 5. Повседневные команды

```powershell
docker compose up -d --build     # пересобрать и поднять
docker compose logs -f backend   # смотреть логи бэкенда
docker compose ps                # статус сервисов
docker compose down              # остановить (данные БД сохраняются в volume)
docker compose down -v           # остановить и удалить данные БД (чистый старт)
```

Если установлен GNU Make (например, через Git Bash), доступны ярлыки:
`make up`, `make migrate`, `make seed`, `make logs`, `make down`,
`make test-backend`, `make shell-db`.

---

## 6. Частые проблемы

- **`docker compose` не найден** — обнови Docker Desktop (Compose v2 встроен) или
  используй `docker-compose` (со старым дефисом).
- **Порт занят** (`port is already allocated`) — освободи `5173/3000/5432/6379`
  или поменяй проброс портов в `docker-compose.yml`.
- **Backend в рестарте сразу после старта** — почти всегда не применены миграции
  (шаг 3) или БД ещё поднимается. Глянь `docker compose logs backend` и убедись,
  что `postgres` healthy (`docker compose ps`).
- **`/api/health/ready` не `ok`** — БД недоступна: проверь, что контейнер `postgres`
  запущен и миграции применены.
- **Изменения в коде не подхватились** — пересобери образ: `docker compose up -d --build`.
