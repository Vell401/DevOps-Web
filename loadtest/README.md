# Нагрузочное тестирование Task Tracker (k6)

Локальный стек для нагрузочного тестирования. Живёт **только на машине-генераторе**
(папка в `.gitignore`, в репозиторий не попадает). Бьёт по edge VM по LAN:
`http://<VM_IP>/`, тем же путём, что и настоящий пользователь (через nginx).

## TL;DR

```bash
cp .env.example .env          # выставить BASE_URL=http://<VM_IP>, LOAD_PASSWORD=...
docker compose run --rm k6 run /scripts/smoke.js          # 1) sanity (1 юзер)
docker compose run --rm k6 run /scripts/seed-via-api.js   # 2) наполнить БД
docker compose run --rm k6 run /scripts/load-http.js      # 3) HTTP-нагрузка
docker compose run --rm k6 run /scripts/load-socketio.js  # 4) Socket.IO
docker compose run --rm k6 run /scripts/main.js           # 3+4 одновременно
```

Полная JSON-сводка каждого прогона пишется в `./results/summary.json`.

> **Windows / Git Bash:** в Git Bash абсолютный путь `/scripts/...` мутирует в
> `C:/Program Files/Git/scripts/...` и k6 его не найдёт. Запускайте команды из
> **PowerShell/CMD**, либо префиксом `MSYS_NO_PATHCONV=1`, либо удваивайте слэш:
> `//scripts/smoke.js`.

## Перед прогоном: ослабить троттлер (на VM)

Троттлер **per-IP**, а вся нагрузка идёт с одного IP вашего ПК. `trust proxy: 1`
+ edge добавляет реальный IP — подменить его заголовком нельзя, поэтому без
послабления вы упрётесь в 429, а не в реальную ёмкость.

На VM в каталоге деплоя (`/opt/tracker`) в `.env`:

```env
THROTTLE_LIMIT=2000000
THROTTLE_AUTH_LIMIT=2000000
THROTTLE_TTL=60
THROTTLE_AUTH_TTL=60
```

затем пересоздать backend:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d backend
```

После теста — вернуть прежние значения (или убрать строки) и снова `up -d backend`.

### Значения троттлера (дефолт / норма / тест)

| Переменная | Дефолт (прод) | Норма | Нагрузочный тест |
|---|---|---|---|
| `THROTTLE_TTL` | 60 | 60 | 60 |
| `THROTTLE_LIMIT` | 120 | 120 (выше, если много реальных юзеров с одного IP) | 2000000 |
| `THROTTLE_AUTH_TTL` | 60 | 60 | 60 |
| `THROTTLE_AUTH_LIMIT` | 10 | 10 | 2000000 |

Откуда берутся: дефолты зашиты в приложении (`AppConfigService` — глобальные,
`process.env` в `auth.controller.ts` — auth) и продублированы в compose как
`${VAR:-default}`. На VM `.env` пишет CI — теперь из **GitHub Variables**
(Settings → Secrets and variables → Actions → Variables) с теми же дефолтами.
Поэтому для теста: либо выставить Variable в репозитории и передеплоить (значение
переживёт деплой), либо править `.env` на VM руками (но он перезапишется при
следующем деплое).

> `THROTTLE_AUTH_*` действует только если на VM уже выкачен образ с коммитом
> `feat(throttle): make auth rate-limit configurable via env`. Глобальный
> `THROTTLE_LIMIT` работал и раньше. Если auth-лимит не снят — держите `SEED_VUS`
> низким и помните про потолок 10/мин на IP; скрипты считают 429 в метрике
> `throttled_429`, и пороги прогона станут красными.

## Сценарии

| Скрипт | Что делает | Ключевые пороги |
|---|---|---|
| `smoke.js` | 1 VU: register → login → проект+задача → чтение списков → 1 ws-раунд | `checks==100%`, `throttled_429==0` |
| `seed-via-api.js` | заводит `USERS` учёток, каждая создаёт `PROJECTS_PER_USER`×`TASKS_PER_PROJECT` | `throttled_429==0` |
| `load-http.js` | `ramping-vus` до `VUS`; 70% чтений / 30% записей с think-time | `http_req_failed<1%`, p95 списков `<800ms` |
| `load-socketio.js` | держит до `VUS` живых Socket.IO-подключений | `ws_errors==0` |
| `main.js` | http-нагрузка + часть сокетов одновременно | комбинированные |

Идентичности детерминированы: `loadtest+<n>@example.com` с паролем `LOAD_PASSWORD`.
`seed` идемпотентен (существующая учётка → login). `load-*` логинят то, что
создал `seed`; если `seed` не запускали — они заведут юзеров на лету.

## Переменные (`.env`)

| Переменная | Дефолт | Назначение |
|---|---|---|
| `BASE_URL` | `http://localhost` | edge VM, напр. `http://192.168.1.50` |
| `WS_URL` | `BASE_URL` с `ws://` | обычно задавать не нужно |
| `LOAD_PASSWORD` | `Loadtest12345` | общий пароль нагрузочных учёток (≥8) |
| `USERS` | 300 | сколько учёток завести/использовать |
| `PROJECTS_PER_USER` / `TASKS_PER_PROJECT` | 5 / 20 | объём seed на юзера |
| `SEED_VUS` | 20 | параллелизм фазы seed |
| `VUS` | 300 | пик виртуальных пользователей |
| `DURATION` / `RAMP` | 5m / 1m | плато и разгон/спад |
| `SOCKET_HOLD` | 60s | сколько держать каждое ws-подключение |
| `THINK_MIN` / `THINK_MAX` | 1 / 4 | пауза между действиями (сек) |

Любую можно переопределить на запуск: `docker compose run --rm -e VUS=50 -e DURATION=2m k6 run /scripts/load-http.js`.

## Что смотреть

- **Сводка k6** в конце: `http_req_duration` p95/p99 по тегам
  (`name:GET /projects`, `name:GET /tasks/mine`, `name:POST /projects/:id/tasks`…),
  `http_req_failed`, `throttled_429`, `ws_connected` / `ws_events_received` /
  `ws_errors`.
- **`/admin/metrics`** на сайте во время прогона: размер БД, подключения
  Postgres, RSS/heap backend, живые сокеты, медленные запросы, rate-limit.
- **Красные флаги:**
  - `throttled_429 > 0` → троттлер не ослаблен (см. выше);
  - рост p95 на `GET /projects` / `/tasks/mine` по мере наполнения → кандидаты
    на индексы / оптимизацию пагинации;
  - латентность растёт при ровном CPU БД → упор в пул Prisma: поднять
    `DB_CONNECTION_LIMIT` (дефолт 10; размер пула виден на графике admin
    «Server sessions» — упор в потолок = мало коннектов).

## Живой дашборд (опционально: InfluxDB + Grafana)

```bash
docker compose --profile dashboard up -d
docker compose run --rm -e K6_OUT=influxdb=http://influxdb:8086/k6 \
  k6 run /scripts/load-http.js
# Grafana → http://localhost:3001 (anonymous Admin), импортировать дашборд k6 (ID 2587)
docker compose --profile dashboard down   # остановить дашборд
```

## 300 соединений под разными учётками — почему это работает

- **JWT stateless:** 300 разных токенов без пер-юзерных лимитов соединений.
- **Единственный пер-IP барьер — троттлер** (снимается выше).
- **Postgres** `max_connections`=100 по умолчанию; пул Prisma ниже — не упрёмся.
- **nginx edge** `worker_connections` (512×воркеры) — на 300 сокетов+HTTP хватает;
  при кратном росте — первый кандидат на тюнинг.

## Рекомендуемый порядок

1. `smoke.js` — убедиться, что цель жива и троттлер ослаблен (нет 429).
2. `seed-via-api.js` — довести БД до нужного объёма; сверить рост в `/admin/metrics`.
3. `load-http.js` — основная нагрузка; смотреть p95 списков и `http_req_failed`.
4. `load-socketio.js` или `main.js` — сокеты (можно параллельно с записью).
5. Откатить `THROTTLE_*` / `THROTTLE_AUTH_*` на VM и `up -d backend`.

## Требования

- Docker (Docker Desktop на Windows подходит).
- Один раз при первом прогоне нужен исходящий интернет — k6 подтягивает
  `textSummary` из jslib CDN (см. `scripts/lib/summary.js`).
