# Локальный запуск на Windows (Docker)

Документ описывает порядок развёртывания и проверки проекта на рабочей станции
под Windows с установленным Docker. Техническое описание приложения приведено в
[README.md](./README.md); развёртывание на Linux-сервере — в
[RUNNING-VM.md](./RUNNING-VM.md).

---

## 1. Предварительные требования

- **Docker Desktop** для Windows с включённым бэкендом **WSL2** (вариант по
  умолчанию). Проверка установки — команды `docker version` и
  `docker compose version`.
- **Git for Windows** — при необходимости клонирования репозитория.
- Свободные порты хоста: `5173` (фронтенд), `3000` (API), `5432` (PostgreSQL),
  `6379` (Redis), `9000`/`9001` (MinIO API/консоль). PostgreSQL, Redis и MinIO
  публикуются только на интерфейсе `127.0.0.1`. Консоль MinIO —
  <http://localhost:9001> (логин = `S3_ACCESS_KEY`/`S3_SECRET_KEY`).

Все команды приведены для PowerShell. В Git Bash они также применимы; различается
лишь копирование `.env` (`copy` в PowerShell против `cp` в Git Bash).

---

## 2. Первичное развёртывание

Учётные записи для входа создаёт seed, и пароли для них берутся из переменных
окружения `SEED_ADMIN_PASSWORD` и `SEED_TEST_PASSWORD`. Значений по умолчанию нет —
без этих переменных seed завершится с ошибкой. Поэтому они задаются на шаге 4.

```powershell
# 1. Скопировать шаблон переменных окружения
copy .env.example .env

# 2. Собрать и запустить весь стек (postgres + redis + backend + frontend)
docker compose up -d --build

# 3. Применить миграции БД (миграции уже в репозитории — создаются таблицы)
docker compose exec backend npx prisma migrate deploy

# 4. Загрузить демонстрационные данные (две учётные записи + демо-проекты)
docker compose exec `
  -e SEED_ADMIN_PASSWORD="задать-длинный-пароль" `
  -e SEED_TEST_PASSWORD="задать-другой-пароль" `
  backend npm run prisma:seed
```

После завершения доступны адреса:

- Фронтенд: <http://localhost:5173>
- API: <http://localhost:3000/api>
- Swagger: <http://localhost:3000/api/docs>
- Liveness: <http://localhost:3000/api/health/live>
- Readiness (пинг БД): <http://localhost:3000/api/health/ready> — возвращает `ok`

---

## 3. Учётные записи для входа

Seed создаёт две учётные записи. Их пароли равны значениям переменных
`SEED_ADMIN_PASSWORD` и `SEED_TEST_PASSWORD`, заданных при загрузке данных
(шаг 4 раздела 2). Фиксированных паролей в репозитории нет.

| Email                 | Пароль                          | Назначение                          |
|-----------------------|---------------------------------|-------------------------------------|
| `admin@tracker.local` | значение `SEED_ADMIN_PASSWORD`  | Администратор, владелец демо-проектов |
| `test@tracker.local`  | значение `SEED_TEST_PASSWORD`   | Рядовой пользователь для проверки назначений |

Вход выполняется на <http://localhost:5173>. Проверка через API:

```powershell
curl -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" `
  -d "{\"email\":\"admin@tracker.local\",\"password\":\"<пароль-из-SEED_ADMIN_PASSWORD>\"}"
```

Ответ содержит пару токенов JWT (`accessToken` и `refreshToken`).

Повторная загрузка seed с другими паролями выполняется той же командой, что и на
шаге 4: seed очищает проекты, задачи, лейблы и комментарии, но сохраняет
пользователей (операция `upsert`).

---

## 4. Запуск тестов

```powershell
# Backend (Jest) — внутри контейнера
docker compose exec backend npm test

# Frontend (Vitest) — внутри контейнера
docker compose exec frontend npm test

# Линтер бэкенда
docker compose exec backend npm run lint
```

Если контейнер фронтенда собран без dev-зависимостей, тесты фронтенда запускаются
на хосте: `cd frontend; npm install; npm test` (требуется Node.js 20). Аналогично
для бэкенда: `cd backend; npm install; npm test`.

---

## 5. Повседневные команды

```powershell
docker compose up -d --build     # пересобрать и запустить
docker compose logs -f backend   # просмотр логов бэкенда
docker compose ps                # статус сервисов
docker compose down              # остановка (данные БД сохраняются в volume)
docker compose down -v           # остановка с удалением данных БД (чистый старт)
```

При установленном GNU Make (например, через Git Bash) доступны сокращения:
`make up`, `make migrate`, `make seed`, `make logs`, `make down`,
`make test-backend`, `make shell-db`.

---

## 6. Типовые проблемы

- **`docker compose` не найден** — требуется обновление Docker Desktop (Compose
  v2 встроен) либо использование `docker-compose` (с дефисом).
- **Порт занят** (`port is already allocated`) — необходимо освободить
  `5173/3000/5432/6379` либо изменить публикацию портов в `docker-compose.yml`.
- **Backend перезапускается сразу после старта** — как правило, не применены
  миграции (шаг 3) либо БД ещё инициализируется. Диагностика — `docker compose
  logs backend`; статус `postgres` должен быть healthy (`docker compose ps`).
- **`/api/health/ready` не возвращает `ok`** — БД недоступна: следует
  проверить, что контейнер `postgres` запущен и миграции применены.
- **Seed завершается с ошибкой про `SEED_ADMIN_PASSWORD`** — переменные паролей
  не переданы; см. шаг 4 раздела 2.
- **Изменения в коде не применились** — требуется пересборка образа:
  `docker compose up -d --build`.
