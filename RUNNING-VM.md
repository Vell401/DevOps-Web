# Развёртывание Tracker на Linux-сервере

Документ описывает полный путь: от чистой Ubuntu 24.04 до состояния, в котором
`git push` в отслеживаемую ветку автоматически выкатывает новую версию. Документ
рассчитан на повторное использование при пересоздании или масштабировании
окружения.

Схема процесса:

```
push в dev ──► GitHub Actions (ubuntu-latest)          push в main ──► то же
                   │                                                      │
                   ├── test    (postgres-сервис, jest, vitest)            │
                   ├── build   (Buildx → Docker Hub :sha-XXXX, :dev/:prod + Trivy-скан)
                   ▼                                                      ▼
        self-hosted runner "dev" на dev-сервере      self-hosted runner "prod"
                   │                                       (на отдельном сервере)
                   ├── пишет .env из GitHub Secrets
                   ├── docker compose pull
                   ├── prisma migrate deploy
                   ├── docker compose up -d
                   └── curl /api/health/ready до 200
```

Сервер не имеет публичного IP. Runner — единственная точка взаимодействия с
GitHub, и инициирует соединение **исходящее**, наружу. Ветка `dev` обслуживается
runner'ом с лейблом `dev`, ветка `main` — runner'ом с лейблом `prod`; пайплайны
не пересекаются благодаря разным лейблам.

---

## Чеклист: что подготовить заранее

Учётные данные не хранятся в репозитории. Всё размещается в **GitHub Secrets** и
попадает на сервер только во время деплоя — записывается в `/opt/tracker/.env` с
правами `600`.

### Secrets (Settings → Secrets and variables → Actions → New secret)

- [ ] `DOCKERHUB_USERNAME` — логин Docker Hub
- [ ] `DOCKERHUB_TOKEN` — access token из Docker Hub (НЕ пароль аккаунта)
- [ ] `POSTGRES_PASSWORD` — произвольный длинный пароль
- [ ] `JWT_ACCESS_SECRET` — вывод `openssl rand -base64 48`
- [ ] `JWT_REFRESH_SECRET` — второй `openssl rand -base64 48`
- [ ] `CORS_ORIGINS` — `http://<IP_сервера>` (значение определяется после шага 1)
- [ ] `SEED_ADMIN_PASSWORD` — пароль для seeded admin@tracker.local
- [ ] `SEED_TEST_PASSWORD` — пароль для seeded test@tracker.local
- [ ] `S3_ACCESS_KEY` — ключ доступа MinIO/S3 (им же инициализируется MinIO)
- [ ] `S3_SECRET_KEY` — секретный ключ MinIO/S3

Пайплайны `dev` и `prod` по умолчанию используют один и тот же набор секретов
уровня репозитория. При необходимости изолировать значения по средам применяются
**GitHub Environments** (см. раздел 12). Если dev- и prod-серверы доступны по
разным адресам, секрет `CORS_ORIGINS` должен перечислять оба origin через запятую.

### Variables (Settings → Secrets and variables → Actions → Variables) — опционально

- [ ] `DEPLOY_DIR` — путь на сервере, по умолчанию `/opt/tracker`
- [ ] `VITE_API_URL` — URL API в собранном фронтенде, по умолчанию `/api`

### Настройки репозитория (Settings → Actions → General)

- [ ] *Fork pull request workflows from outside collaborators* → **Require approval for all outside collaborators**
- [ ] *Workflow permissions* → **Read repository contents and packages permissions**

Обе настройки критичны для **публичного** репозитория. Без них pull request из
чужого форка способен запустить deploy-job на сервере и выполнить произвольный код.

---

## 1. Подготовка сервера (Ubuntu 24.04 LTS)

Платформа виртуализации произвольна: VirtualBox, VMware, Hyper-V, Proxmox,
Multipass. Минимальные ресурсы: 2 vCPU / 4 ГБ RAM / 20 ГБ диск.

Серверу назначается **статический IP** в локальной сети (через DHCP-резервацию на
роутере или через netplan). Этот адрес используется в `CORS_ORIGINS` и для доступа
к приложению из браузера.

Подключение по SSH выполняется под обычным пользователем, созданным при установке
(далее `you` — не `deploy`; пользователь `deploy` создаётся в разделе 2).

### 1.1 Обновление системы

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git jq ufw ca-certificates
```

### 1.2 Файрвол

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp comment 'tracker edge'
sudo ufw --force enable
sudo ufw status verbose
```

Для ограничения доступа к приложению одной подсетью:

```bash
sudo ufw delete allow 80/tcp
sudo ufw allow from 192.168.1.0/24 to any port 80 proto tcp
```

### 1.3 Docker Engine + Compose plugin

Официальный установщик:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
docker --version            # ожидается 24+
docker compose version      # ожидается v2.20+
```

---

## 2. Пользователь `deploy` и рабочая директория

Отдельный пользователь нужен потому, что GitHub runner исполняет команды из
workflow-файла. Требуется изолированный аккаунт без sudo, но с доступом к
docker-сокету.

```bash
sudo adduser --system --group --shell /bin/bash --home /home/deploy deploy
sudo usermod -aG docker deploy
sudo mkdir -p /opt/tracker/deploy
sudo chown -R deploy:deploy /opt/tracker
```

Проверка доступа к Docker от имени `deploy`:

```bash
sudo -iu deploy
docker ps                   # вывод шапки без ошибки permission denied
exit
```

---

## 3. Установка self-hosted GitHub runner

Путь в интерфейсе: GitHub → репозиторий → *Settings → Actions → Runners →
New self-hosted runner → Linux x64*. На этой странице GitHub формирует готовые
команды с одноразовым registration token; они выполняются по порядку в
SSH-сессии под пользователем `deploy`.

Переключение на `deploy` (флаг `-i` запускает полноценный shell в `/home/deploy`):

```bash
sudo -iu deploy
pwd             # /home/deploy
```

Файлы runner'а размещаются в `/home/deploy/actions-runner` — стандартное рабочее
место self-hosted runner'а; команда `svc.sh install` запишет этот путь в
systemd-юнит. Каталог приложения (`/opt/tracker`) с ним не пересекается.

Далее выполняются команды со страницы GitHub:

1. **Download** — три команды (`mkdir actions-runner && cd actions-runner`,
   `curl -o …`, `tar xzf …`). Версия в URL меняется со временем, поэтому берётся
   именно со страницы GitHub.
2. **Configure** — команда
   `./config.sh --url https://github.com/<user>/<repo> --token <TOKEN>`.
   На интерактивные вопросы:
   - *Enter the name of the runner group* — Enter (по умолчанию `Default`).
   - *Enter the name of runner* — `dev-vm` (различимое имя в UI при добавлении
     второго runner'а для prod).
   - *Enter any additional labels* — `dev`. Это обязательно: workflow `dev-cd.yml`
     ищет runner с лейблами `self-hosted` + `dev`. GitHub по умолчанию назначает
     `self-hosted`, `Linux`, `X64`; лейбл `dev` добавляется здесь.
   - *Enter name of work folder* — Enter (по умолчанию `_work`).

После сообщения «Runner successfully added» выполняется выход из shell'а `deploy`:

```bash
exit
```

### 3.1 Запуск в виде systemd-сервиса

Хелпер от GitHub запускается от **root**; сам сервис работает от `deploy`:

```bash
cd /home/deploy/actions-runner
sudo ./svc.sh install deploy
sudo ./svc.sh start
sudo ./svc.sh status
```

Команда `systemctl status 'actions.runner.*'` подтверждает, что сервис активен.
Runner автоматически перезапускается при перезагрузке или сбое.

### 3.2 Проверка подключения runner'а

Репозиторий → Settings → Actions → Runners. Runner `dev-vm` отображается со
статусом **Idle** и набором лейблов `self-hosted, Linux, X64, dev`. Тестовый push
в `dev` инициирует deploy-job.

---

## 4. Первый деплой

Push в `dev` запускает пайплайн. Просмотр логов runner'а на сервере:

```bash
sudo journalctl -u 'actions.runner.*' -f
```

После успешного deploy-job:

```bash
sudo ls /opt/tracker
# docker-compose.prod.yml  deploy/  .env

sudo -iu deploy docker ps
# postgres, redis, minio, backend, frontend, edge — все Up (healthy)

curl -sS http://localhost/api/health/ready
# {"status":"ok","info":{"database":{"status":"up"}}, ...}
```

### Что выполняется автоматически

Шаг `Run database migrations` выполняет `prisma migrate deploy` в одноразовом
контейнере **до** запуска основного стека. Как следствие:
- таблицы (`User`, `Project`, `Task`, `Label`, `Activity`, …) создаются
  автоматически;
- применяются все закоммиченные миграции из `backend/prisma/migrations/`;
- сбой миграции приводит к падению деплоя в Actions UI.

Таким образом, ручной запуск миграций после деплоя не требуется.

### Что выполняется вручную один раз — seed

База создаётся пустой. Для появления двух seeded-учёток (admin и test) и
демонстрационных проектов:

```bash
cd /opt/tracker
docker compose -f docker-compose.prod.yml --env-file .env exec backend npm run prisma:seed
```

Пароли seed берёт из переменных окружения контейнера, которые workflow записал в
`.env` из секретов `SEED_ADMIN_PASSWORD` и `SEED_TEST_PASSWORD`. Сами значения
seed нигде не печатает.

После выполнения seed: на `http://<IP_сервера>/login` вход под
`admin@tracker.local` с паролем из секрета открывает доступ к пункту **Admin** в
сайдбаре.

Workflow не запускает seed автоматически: операция перезаписывает существующие
проекты и задачи, что недопустимо на каждый push.

Без seed возможна ручная регистрация через UI (`/register`). Если регистрация во
фронтенде возвращает «email may already be in use» — это общий обработчик любой
ошибки; истинная причина определяется по логам бэкенда:

```bash
docker compose -f docker-compose.prod.yml --env-file .env logs --tail=80 backend
```

---

## 5. Возможности встроенной админ-панели

При входе под пользователем с флагом `isAdmin = true` в сайдбаре появляется пункт
**Admin** (`/admin`). На странице:

- **Карточки статистики** — общее число пользователей (и администраторов),
  проектов, задач, комментариев; разбивка задач по статусам.
- **Список пользователей** — с количеством их проектов, задач и комментариев.
  - Переключение чипа «User» ↔ «Admin» меняет роль администратора.
  - Кнопка `Reset pw` задаёт новый пароль; активные сессии пользователя
    отзываются (refresh-токены удаляются), требуется повторный вход.
  - Иконка корзины удаляет пользователя (каскадно — его проекты, задачи,
    комментарии).
- **Recent signups** — последние пять регистраций.

### Страница системных метрик (`/admin/metrics`)

Вторая вкладка админки — живой per-service дашборд (обновление каждые 10 с):

- **Карточки сервисов** со статусом (🟢/🔴/⚪), аптаймом и размерами: backend
  (RSS/heap-память, версия Node), PostgreSQL (размер БД на диске, число
  подключений, версия), Redis (занятая память, ключи, клиенты — либо «Disabled»,
  если `REDIS_HOST` не задан), объектное хранилище S3 (объём вложений, файлы).
- **HTTP-запросы** (всего, по классам статусов и методам, график за 30 минут),
  **медленные запросы** и **срабатывания rate-limit по маршрутам**, **build-info**.

Тяжёлые показатели (размеры Postgres/Redis/S3, активные сессии) кэшируются и
шарятся между репликами через Redis, поэтому поллинг дешёв. Docker-сокет не
используется — каждый сервис отдаёт данные по своему протоколу.

### Защитные ограничения админ-сервиса

В код встроены два ограничения:
1. **Запрет самоудаления** через админ-панель (кнопка в UI заблокирована, бэкенд
   также отклоняет операцию).
2. **Запрет понижения последнего администратора** — если в системе остался
   единственный `isAdmin = true`, снять флаг нельзя.

### Назначение первого администратора без seed

Workflow создаёт администратора только через `npm run prisma:seed`. Если seed не
выполнялся (например, при ручной регистрации через UI), повышение до
администратора выполняется одной SQL-командой:

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U tracker -d tracker -c \
  "UPDATE \"User\" SET \"isAdmin\" = true WHERE email = 'user@example.com';"
```

После повторного входа пункт `/admin` появляется в меню.

---

## 5a. Администрирование данных через CLI

Все операции выполняются из `/opt/tracker` под root (на сервере доступен) либо
через `sudo -iu deploy bash -c '...'` для явного запуска от имени `deploy`.

### 5.1 Резервная копия перед деструктивной операцией

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  pg_dump -U tracker -d tracker | gzip > "backup-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

Файл `backup-…sql.gz` сохраняется в текущей директории. Восстановление описано в
разделе 7.

### 5.2 Повторный запуск seed

Seed очищает все проекты, задачи, лейблы и комментарии, но **сохраняет
пользователей** (операция `upsert`). Команда для возврата демонстрационных данных
к исходному состоянию:

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec backend npm run prisma:seed
```

Запуск с другими паролями admin/test:

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec \
  -e SEED_ADMIN_PASSWORD='длинный-пароль' \
  -e SEED_TEST_PASSWORD='другой-пароль' \
  backend npm run prisma:seed
```

### 5.3 Полная очистка БД (включая пользователей)

Сброс к абсолютно чистой базе. Каскад (`CASCADE`) автоматически очищает
зависимые таблицы (`ProjectMember`, `Notification`, `Attachment`, `LoginEvent`)
и связующие many-to-many (`_TaskLabels`, `_TaskAssignees`):

```bash
# Сначала резервная копия (см. 5.1) — без неё восстановление невозможно.
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U tracker -d tracker <<'SQL'
TRUNCATE TABLE
  "Activity",
  "Comment",
  "Task",
  "Label",
  "Project",
  "RefreshToken",
  "User"
RESTART IDENTITY CASCADE;
SQL
```

Далее можно выполнить seed (5.2) для получения admin+test и демо-проектов.

### 5.4 Удаление только задач и проектов (пользователи сохраняются)

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U tracker -d tracker <<'SQL'
TRUNCATE TABLE
  "Activity",
  "Comment",
  "Task",
  "Label",
  "Project"
RESTART IDENTITY CASCADE;
SQL
```

`RefreshToken` и `User` остаются. Повторный вход пользователям не требуется
(access-токены живут 15 минут, refresh — 7 дней).

### 5.5 Удаление конкретного пользователя

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U tracker -d tracker -c \
  "DELETE FROM \"User\" WHERE email = 'user@example.com';"
```

Каскад в схеме Prisma удаляет проекты, которыми пользователь **владеет** (вместе
с их задачами, лейблами, комментариями и активностью), а также его комментарии,
записи активности и refresh-токены. Из задач и проектов, где пользователь был
лишь исполнителем или участником, удаляются только связи — сами задачи и проекты
сохраняются.

### 5.6 Сброс пароля пользователя

Корректный способ — через бэкенд, чтобы получить тот же bcrypt-хэш, что и при
регистрации:

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec backend node -e "
  const bcrypt = require('bcrypt');
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  (async () => {
    const email = process.argv[1];
    const password = process.argv[2];
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await p.user.update({ where: { email }, data: { passwordHash } });
    console.log('Reset password for', user.email);
    await p.\$disconnect();
  })();
" admin@tracker.local 'новый-пароль'
```

Значения `admin@tracker.local` и `'новый-пароль'` заменяются на требуемые. Кавычки
вокруг пароля обязательны (возможны спецсимволы).

### 5.7 Просмотр списка пользователей

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U tracker -d tracker -c \
  'SELECT email, name, "createdAt" FROM "User" ORDER BY "createdAt";'
```

### 5.8 Откат миграции (потенциально опасно)

Откат миграции в Prisma выполняется вручную. Типовой сценарий: применённая
миграция оказалась некорректной и требуется отменить изменения.

```bash
# Статус миграций
docker compose -f docker-compose.prod.yml --env-file .env run --rm backend \
  npx prisma migrate status

# Пометить миграцию как откаченную (Prisma НЕ выполняет SQL отката —
# down-миграция пишется вручную либо восстанавливается из резервной копии)
docker compose -f docker-compose.prod.yml --env-file .env run --rm backend \
  npx prisma migrate resolve --rolled-back 20260606000000_jira_extensions
```

В большинстве случаев предпочтительно восстановление базы из последней резервной
копии (раздел 7) с последующим применением нужных миграций.

---

## 6. Откат на предыдущую версию

Каждая успешная сборка публикует в Docker Hub тег `sha-<short>`. Порядок отката:

1. Определить тег нужной сборки:
   - в summary прогона GitHub Actions (шаг `Build & push`);
   - либо в Docker Hub UI → `<user>/tracker-backend` → Tags.
2. GitHub → Actions → выбрать соответствующий пайплайн (*Dev CI/CD* для `dev`,
   *Prod CI/CD* для `main`) → *Run workflow* → указать ветку и
   `image_tag = sha-abc1234` → *Run*.

Workflow пропускает test и build (тег задан явно) и сразу переходит к deploy с
указанным тегом.

Если откат вызван повреждением данных, сначала восстанавливается база из
резервной копии (раздел 7), затем откатывается код — иначе старый код встретит
новую схему.

---

## 7. Ночные резервные копии Postgres

`pg_dump` покрывает только базу данных. Файлы вложений хранятся в MinIO (том
`minio_data`) и в SQL-дамп не попадают; при необходимости их полного бэкапа
резервируется сам docker-том (например, `docker run --rm -v
tracker_minio_data:/data -v "$PWD":/backup alpine tar czf /backup/minio.tgz -C /data .`).

Вариант для пет-проекта: cron на сервере создаёт дамп в `/opt/tracker/backups/`.

```bash
sudo install -d -o deploy -g deploy /opt/tracker/backups
sudo install -m 0755 /dev/stdin /usr/local/bin/tracker-backup.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/tracker
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  pg_dump -U "$(grep ^POSTGRES_USER .env | cut -d= -f2)" \
          -d "$(grep ^POSTGRES_DB   .env | cut -d= -f2)" \
  | gzip > "backups/tracker-${TS}.sql.gz"
# хранение 14 дней
find backups -type f -name 'tracker-*.sql.gz' -mtime +14 -delete
EOF
```

Crontab пользователя `deploy`:

```bash
sudo -iu deploy crontab -e
# добавить строку:
15 3 * * *  /usr/local/bin/tracker-backup.sh >> /opt/tracker/backups/backup.log 2>&1
```

Восстановление (backend предварительно останавливается):

```bash
sudo -iu deploy
cd /opt/tracker
docker compose -f docker-compose.prod.yml --env-file .env stop backend
gunzip -c backups/tracker-20260606T030015Z.sql.gz | \
  docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
    psql -U tracker -d tracker
docker compose -f docker-compose.prod.yml --env-file .env start backend
```

---

## 8. Подключение к Postgres с рабочей станции (DBeaver / psql)

Postgres публикуется только на `127.0.0.1` сервера (не в LAN — преднамеренно, по
соображениям безопасности). Доступ с рабочей станции организуется через
**SSH-туннель**, который шифруется поверх SSH и не открывает дополнительных портов
наружу.

### Через DBeaver

Database → New Database Connection → **PostgreSQL**.

**Вкладка Main:**

| Поле | Значение |
|---|---|
| Host | `localhost` (локальный конец туннеля, не сервер) |
| Port | `5432` |
| Database | `tracker` |
| Username | `tracker` |
| Password | значение `POSTGRES_PASSWORD` из GitHub Secrets |

**Вкладка SSH** → отметить *Use SSH Tunnel*:

| Поле | Значение |
|---|---|
| Host/IP | IP сервера |
| Port | `22` |
| User Name | SSH-пользователь сервера (**не** `deploy`) |
| Authentication Method | Public Key (рекомендуется) или Password |
| Private key | путь к `~/.ssh/id_ed25519` или `id_rsa` |

*Test Connection* должен пройти успешно. DBeaver поднимает туннель и направляет
трафик через SSH на сервер, далее в `127.0.0.1:5432`.

Пароль БД нельзя посмотреть в GitHub (секреты скрыты). При утрате значение
читается на сервере: `sudo cat /opt/tracker/.env | grep POSTGRES_PASSWORD`.

### Через `psql`

В локальном терминале:

```bash
ssh -L 5432:127.0.0.1:5432 <ssh-пользователь>@<ip-сервера>
```

Пока SSH-сессия открыта, локальный порт 5432 проброшен на сервер. В отдельном окне:

```bash
psql -h localhost -p 5432 -U tracker -d tracker
# запрашивается пароль — то же значение POSTGRES_PASSWORD
```

### Если порт `5432` на рабочей станции занят

Используется любой свободный порт, например `15432`:

```bash
ssh -L 15432:127.0.0.1:5432 user@server
# в отдельном окне:
psql -h localhost -p 15432 -U tracker -d tracker
```

В DBeaver: SSH-вкладка → Local Port `15432`, Main → Port `15432`.

### Обоснование схемы

Postgres с паролем, открытый в LAN или интернет, остаётся доступным до первого
сканирования портов. SSH-туннель — стандартная безопасная схема: не требует
настройки TLS и правил `pg_hba`, наружу ничего не публикуется.

---

## 9. Повседневные команды

```bash
# Состояние сервисов
sudo -iu deploy docker compose -f /opt/tracker/docker-compose.prod.yml --env-file /opt/tracker/.env ps

# Логи бэкенда
sudo -iu deploy docker compose -f /opt/tracker/docker-compose.prod.yml --env-file /opt/tracker/.env logs -f backend

# Текущий тег образа
sudo -iu deploy docker compose -f /opt/tracker/docker-compose.prod.yml --env-file /opt/tracker/.env config | grep image:

# Использование диска Docker
sudo docker system df

# Очистка старых слоёв (workflow делает это автоматически)
sudo docker image prune -af
```

---

## 10. Ротация пароля БД — важный нюанс

Postgres инициализирует пароль из `POSTGRES_PASSWORD` **только при первом старте**,
когда том пуст. Простая смена секрета в GitHub и повторный деплой приведут к
рассогласованию: backend получит новый пароль, а Postgres в томе сохранит старый,
и подключение завершится ошибкой.

Корректная смена пароля:

```bash
sudo -iu deploy
cd /opt/tracker
# Установить новый пароль внутри Postgres
docker compose -f docker-compose.prod.yml --env-file .env exec postgres \
  psql -U tracker -d tracker -c "ALTER USER tracker WITH PASSWORD 'НОВЫЙ_ПАРОЛЬ';"
```

После этого `POSTGRES_PASSWORD` обновляется в GitHub Secrets — следующий деплой
проходит без ошибок.

---

## 11. Траблшутинг

| Симптом | Диагностика |
|---|---|
| Workflow висит в «Queued» на deploy-job | runner не подобрал задачу — `sudo systemctl status 'actions.runner.*'`; runner должен быть Idle на странице Settings → Actions → Runners, и в его лейблах должен присутствовать `dev` (или `prod`) |
| `docker compose pull` возвращает «denied» | истёк Docker Hub token или репозиторий приватный — обновить `DOCKERHUB_TOKEN` |
| `prisma migrate deploy` завершается с `P3009` | предыдущая миграция упала на полпути — `docker compose exec backend npx prisma migrate resolve --rolled-back <name>`, затем повтор |
| Регистрация во фронтенде возвращает «email may already be in use» | это общая обёртка над любой ошибкой; см. `docker compose logs --tail=80 backend` или `curl -i -X POST http://localhost/api/auth/register -H 'Content-Type: application/json' -d '{...}'` для реального кода/тела |
| Нет учётных записей для входа | выполнить seed: `docker compose -f docker-compose.prod.yml --env-file .env exec backend npm run prisma:seed` |
| Какие миграции применены | `docker compose -f docker-compose.prod.yml --env-file .env run --rm backend npx prisma migrate status` |
| Healthcheck не дожидается готовности | `docker compose logs backend` — обычно несовпадение `CORS_ORIGINS` либо БД не поднялась |
| 502 от edge nginx | контейнер backend нездоров — `docker ps` и `docker compose logs backend` |
| Браузер блокирует CORS | `CORS_ORIGINS` не точно соответствует Origin браузера (без завершающего слеша) — исправить секрет, передеплоить |
| «password authentication failed» при подключении к БД | пароль в `.env` разошёлся со значением в томе Postgres — см. раздел 10 |

---

## 12. Добавление prod-runner'а

Workflow `prod-cd.yml` уже присутствует в репозитории и срабатывает на push в
ветку `main`, разворачивая стек на runner'е с лейблом `prod`. Для ввода
prod-среды в эксплуатацию на отдельном сервере повторяются разделы 1–3.1 со
следующими отличиями:

- на вопрос `Enter the name of runner` указывается **`prod-vm`**;
- на вопрос `Enter any additional labels` указывается **`prod`** (не `dev`);
- секреты по умолчанию переиспользуются на уровне репозитория. Если dev- и
  prod-серверы доступны по разным адресам, `CORS_ORIGINS` должен включать оба
  origin (через запятую), так как секрет общий для обоих пайплайнов.

Разные лейблы гарантируют, что `dev-cd.yml` исполняется только на `dev-vm`, а
`prod-cd.yml` — только на `prod-vm`; взаимная подмена исключена.

### Изоляция секретов и approval-gate (опционально)

Для раздельных значений секретов по средам применяются **GitHub Environments**:

- Repo → Settings → Environments → New environment → имя `prod`.
- Внутри environment задаются те же ключи (`POSTGRES_PASSWORD`, `JWT_*` и т.д.) с
  прод-значениями. Они **перекрывают** одноимённые секреты уровня репозитория, но
  только в job'ах с `environment: prod` (именно так объявлен deploy-job в
  `prod-cd.yml`).
- Включение *Required reviewers* добавляет ручное подтверждение деплоя в prod.

Совместное использование одних JWT-секретов в dev и prod делает токены
взаимозаменяемыми между средами; при необходимости изоляции задаются отдельные
значения через Environments, как описано выше.

---

## 13. Границы решения

- **Не multi-host.** Один сервер на среду. При его отказе приложение
  недоступно. В реальном проде применяются как минимум standby и managed
  Postgres.
- **Не zero-downtime.** `docker compose up -d` пересоздаёт контейнеры — 1–3 с
  даунтайма. В проде используется rolling deploy с несколькими репликами backend
  за edge.
- **Без TLS.** Чистый HTTP, приемлемый для локальной сети. При публикации в
  интернет перед edge ставится Caddy/Traefik с Let's Encrypt.
- **Без секрет-менеджера.** Секреты хранятся в GitHub Actions и при деплое
  записываются в `/opt/tracker/.env`. Любой пользователь с доступом `deploy`
  способен их прочитать. В проде применяются Vault / SOPS / cloud KMS.

Для учебно-практического стенда перечисленные ограничения приемлемы и осознаны.
