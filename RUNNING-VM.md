# Запуск Tracker на локальной Linux-виртуалке

Сквозная инструкция: от чистой Ubuntu 24.04 до того момента, когда `git push origin dev`
автоматически выкатывает новую версию. Адресат — ты, через полгода.

Архитектура напоминалка:

```
push в dev ──► GitHub Actions (ubuntu-latest)
                   │
                   ├── test    (postgres-сервис, jest, vitest)
                   ├── build   (Buildx → Docker Hub :sha-XXXX, :dev, :latest)
                   ▼
                self-hosted runner на VM (тянет задания по HTTPS, входящих нет)
                   │
                   ├── пишет .env из GitHub Secrets
                   ├── docker compose pull
                   ├── prisma migrate deploy
                   ├── docker compose up -d
                   └── curl /api/health/ready до 200
```

VM не имеет публичного IP. Runner — единственная точка взаимодействия с GitHub,
и он подключается **наружу**.

---

## Чеклист — что нужно завести до начала

Креды нигде не лежат в репо. Всё хранится в **GitHub Secrets**, на VM попадает
только во время деплоя и пишется в `/opt/tracker/.env` с правами `600`.

### Secrets (Settings → Secrets and variables → Actions → New secret)

- [ ] `DOCKERHUB_USERNAME` — твой логин Docker Hub
- [ ] `DOCKERHUB_TOKEN` — access token из Docker Hub (НЕ пароль аккаунта)
- [ ] `POSTGRES_PASSWORD` — придумай любой длинный пароль, никуда не вписывай
- [ ] `JWT_ACCESS_SECRET` — вывод `openssl rand -base64 48`
- [ ] `JWT_REFRESH_SECRET` — ещё один `openssl rand -base64 48`
- [ ] `CORS_ORIGINS` — `http://<IP_VM>` (узнаешь после шага 1)
- [ ] `SEED_ADMIN_PASSWORD` — пароль для seeded admin@tracker.local (любая длинная строка)
- [ ] `SEED_TEST_PASSWORD` — пароль для seeded test@tracker.local

### Variables (Settings → Secrets and variables → Actions → Variables) — опционально

- [ ] `DEPLOY_DIR` — путь на VM, по умолчанию `/opt/tracker`
- [ ] `VITE_API_URL` — URL API в собранном фронте, по умолчанию `/api`

### Настройки репо (Settings → Actions → General)

- [ ] *Fork pull request workflows from outside collaborators* → **Require approval for all outside collaborators**
- [ ] *Workflow permissions* → **Read repository contents and packages permissions**

> Эти две настройки критичны для **публичного** репо. Без них чужой PR из форка
> сможет дёрнуть deploy-job на твоей VM и выполнить там произвольный код.

---

## 1. Поднять VM (Ubuntu 24.04 LTS)

VirtualBox / VMware / Hyper-V / Proxmox / Multipass — что угодно.
Минимум: 2 vCPU / 4 ГБ RAM / 20 ГБ диск.

Выдай VM **статический IP** в локалке (через DHCP reservation на роутере или
через netplan). Запиши его — этот IP пойдёт в `CORS_ORIGINS` и его же ты
будешь открывать в браузере.

Подключись по SSH под обычным пользователем, которого создал на установке
(назовём его `you` — НЕ `deploy`, `deploy` мы заведём ниже).

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

Если в приложение должен ходить только твой ноут:

```bash
sudo ufw delete allow 80/tcp
sudo ufw allow from 192.168.1.0/24 to any port 80 proto tcp
```

### 1.3 Docker Engine + Compose plugin

Официальный one-shot installer:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
docker --version            # ожидаем 24+
docker compose version      # ожидаем v2.20+
```

---

## 2. Завести пользователя `deploy` и рабочую директорию

Зачем отдельный пользователь: GitHub runner будет исполнять команды из
workflow-файла. Нужен изолированный аккаунт без sudo, но с доступом к
docker-сокету.

```bash
sudo adduser --system --group --shell /bin/bash --home /home/deploy deploy
sudo usermod -aG docker deploy
sudo mkdir -p /opt/tracker/deploy
sudo chown -R deploy:deploy /opt/tracker
```

Проверка: переключись на `deploy` и убедись что docker работает:

```bash
sudo -iu deploy
docker ps                   # должна вывести шапку без permission denied
exit
```

---

## 3. Установить self-hosted GitHub runner

GitHub → твой репо → *Settings → Actions → Runners → New self-hosted runner →
Linux x64*. На этой странице GitHub генерирует **готовые команды** с одноразовым
registration token. Идея простая: копируешь их по порядку и вставляешь в SSH-сессию
под пользователем `deploy`.

Сначала переключись на `deploy` — флаг `-i` важен, он логинит как полноценный
shell и оставляет тебя в `/home/deploy`:

```bash
sudo -iu deploy
pwd             # должно быть /home/deploy
```

Все файлы раннера будут жить в `/home/deploy/actions-runner` — это нормальное
рабочее место для self-hosted runner-а, и `svc.sh install` ниже запишет этот путь
в systemd-юнит. Не путай с `/opt/tracker` — там данные приложения.

Дальше — копи-пейст со страницы GitHub:

1. **Download** — три команды (`mkdir actions-runner && cd actions-runner`, `curl -o …`, `tar xzf …`).
   URL версии меняется со временем, поэтому бери его именно со страницы GitHub.
2. **Configure** — команда `./config.sh --url https://github.com/<твой-юзер>/<твой-репо> --token <TOKEN>`.
   GitHub задаст несколько интерактивных вопросов:
   - *Enter the name of the runner group* — Enter (по умолчанию `Default`).
   - *Enter the name of runner* — введи **`dev-vm`** (так будет понятно в UI, когда заведёшь второй runner для prod).
   - *Enter any additional labels* — введи **`dev`**. Это критично: workflow `dev-cd.yml`
     ищет runner с лейблами `self-hosted` + `dev`, и без второго он не запустится. GitHub
     по умолчанию вешает `self-hosted`, `Linux`, `X64` — а `dev` мы добавляем здесь.
   - *Enter name of work folder* — Enter (по умолчанию `_work`).

После того как `config.sh` отработал и сказал "Runner successfully added" — выйди из shell-а `deploy`:

```bash
exit
```

### 3.1 Запустить как systemd-сервис

GitHub даёт хелпер. Запускай от **root**, сам сервис будет работать от `deploy`:

```bash
cd /home/deploy/actions-runner
sudo ./svc.sh install deploy
sudo ./svc.sh start
sudo ./svc.sh status
```

После этого `systemctl status 'actions.runner.*'` покажет, что сервис активен.
Runner автоматически перезапустится при ребуте или падении.

### 3.2 Проверить, что runner подключился

Репо → Settings → Actions → Runners. Должен быть `dev-vm` со статусом
**Idle** и набором лейблов `self-hosted, Linux, X64, dev`. Сделай тестовый push в `dev`
— deploy-job заберётся.

---

## 4. Первый деплой

Запушь в `dev`. Pipeline запустится.

Смотреть логи раннера на VM:

```bash
sudo journalctl -u 'actions.runner.*' -f
```

После успешного deploy-job на VM:

```bash
sudo ls /opt/tracker
# docker-compose.prod.yml  deploy/  .env

sudo -iu deploy docker ps
# postgres, redis, backend, frontend, edge — все Up (healthy)

curl -sS http://localhost/api/health/ready
# {"status":"ok","info":{"database":{"status":"up"}}, ...}
```

### Что произошло автоматически

Шаг `Run database migrations` в workflow выполняет `npx prisma migrate deploy`
в одноразовом контейнере **до** того как поднимет основной стэк. Это значит:
- таблицы (`User`, `Project`, `Task`, …) создаются автоматически;
- все коммиченные миграции из `backend/prisma/migrations/` применяются;
- если миграция упала — весь деплой свалился бы красным в Actions UI.

То есть **миграции вручную после первого деплоя запускать не надо**.

### Что нужно сделать вручную один раз — сид

База создана, но **пустая**. Чтобы появились два seeded-аккаунта (admin и test)
и пара демо-проектов:

```bash
cd /opt/tracker
docker compose -f docker-compose.prod.yml --env-file .env exec backend npm run prisma:seed
```

Пароли seed возьмёт из env-переменных контейнера, которые workflow прописал
из GitHub Secrets `SEED_ADMIN_PASSWORD` и `SEED_TEST_PASSWORD`. Сам seed их
нигде не печатает — ты их задал в GitHub-у, ты их и знаешь.

После сида: открой `http://<IP_VM>/login`, войди как `admin@tracker.local` с
паролем из секрета — у тебя появится пункт **Admin** в сайдбаре.

Workflow специально его не запускает: сид перетирает существующие данные, а в
проде это не то, что хочется делать на каждом push в `dev`.

**Без сида ты можешь либо вручную зарегистрироваться через UI** (`/register`),
либо запустить сид и логиниться готовыми аккаунтами. Если регистрация во фронте
ругается "email may already be in use" — на самом деле это **общий** обработчик
любой ошибки, истинную причину смотри в логах бэка:

```bash
docker compose -f docker-compose.prod.yml --env-file .env logs --tail=80 backend
```

Открывай `http://<IP_VM>/` в браузере и логинься.

---

## 5. Что умеет встроенная админка

Если ты залогинен как пользователь с флагом `isAdmin = true`, в сайдбаре
появляется пункт **Admin** (`/admin`). На странице:

- **Stats-карточки** — общее число юзеров (+ сколько админов), проектов,
  задач, комментариев, открытых задач. И разбивка задач по статусам.
- **Список юзеров** — с количеством их проектов/задач/комментов.
  - Клик на чип "User" → "Admin" — повышаешь до администратора (и обратно).
  - Кнопка `Reset pw` → задать новый пароль, открытые сессии этого юзера
    отзываются (refresh-токены удаляются), он будет вынужден залогиниться
    снова с новым паролем.
  - Иконка корзины — удалить (каскадом сносятся его проекты, задачи,
    комменты).
- **Recent signups** — последние 5 регистраций.

### Safety net в админ-сервисе

В коде встроены два защитника от самопростреливания:
1. **Нельзя удалить себя** через админ-панель (UI кнопка disabled + backend
   тоже отказывает).
2. **Нельзя демотировать последнего админа** — если в системе остался
   единственный `isAdmin = true`, бэк не даст снять с него флаг.

### Сделать первого админа после первого деплоя

Workflow создаёт админа только через `npm run prisma:seed`. Если ты по
какой-то причине НЕ запускал сид (например, регистрировался руками
через UI), повысить себя до админа можно одной SQL-командой:

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U tracker -d tracker -c \
  "UPDATE \"User\" SET \"isAdmin\" = true WHERE email = 'твой-email@example.com';"
```

Перелогинься — `/admin` появится в меню.

---

## 5a. Администрирование данных через CLI

Все операции запускаются из `/opt/tracker`. Везде нужен либо root (на dev-VM так
и есть), либо `sudo -iu deploy bash -c '...'` если хочешь явно от deploy-юзера.

### 5.1 Сделать бэкап перед любой деструктивной операцией

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  pg_dump -U tracker -d tracker | gzip > "backup-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

Файл `backup-…sql.gz` остаётся в текущей директории. Если что-то пойдёт не так,
восстановление — в секции 6.

### 5.2 Прогнать seed заново

**Заметка:** seed чистит все проекты, задачи, лейблы и комменты, но **оставляет
пользователей** (это `upsert`). Если ты на демо-данных и хочешь "вернуть как
было" — это твоя команда.

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec backend npm run prisma:seed
```

Свои пароли для admin/test:

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec \
  -e SEED_ADMIN_PASSWORD='длинный-пароль-сюда' \
  -e SEED_TEST_PASSWORD='другой-пароль' \
  backend npm run prisma:seed
```

### 5.3 Полная очистка БД (всё под ноль, включая юзеров)

Если хочешь начать с **абсолютно** чистой базы, как будто только что развернулся:

```bash
# Сначала бэкап (см. 5.1) — без него восстановить нельзя.
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U tracker -d tracker <<'SQL'
TRUNCATE TABLE
  "Activity",
  "Comment",
  "Task",
  "_TaskLabels",
  "Label",
  "Project",
  "RefreshToken",
  "User"
RESTART IDENTITY CASCADE;
SQL
```

После этого можно прогнать seed (5.2), чтобы получить admin+test и demo-проекты.

### 5.4 Удалить только задачи и проекты, юзеров оставить

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U tracker -d tracker <<'SQL'
TRUNCATE TABLE
  "Activity",
  "Comment",
  "Task",
  "_TaskLabels",
  "Label",
  "Project"
RESTART IDENTITY CASCADE;
SQL
```

`RefreshToken` и `User` остаются. Юзеры перелогиниваться не должны (access-токены
живут 15 минут, refresh — 7 дней, ничего не сломается).

### 5.5 Удалить конкретного пользователя

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U tracker -d tracker -c \
  "DELETE FROM \"User\" WHERE email = 'кого-удаляем@example.com';"
```

Каскад в Prisma-схеме снесёт его проекты, задачи (как assignee → `assigneeId`
станет NULL у чужих задач), комменты, refresh-токены.

### 5.6 Сбросить пароль пользователя

Самый чистый способ — через бэкенд, чтобы получить тот же bcrypt-хэш, что и
при регистрации. Одной командой:

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

Замени `admin@tracker.local` и `'новый-пароль'` на нужные. Кавычки вокруг
пароля — обязательно (внутри могут быть спецсимволы).

### 5.7 Посмотреть кто есть в системе

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U tracker -d tracker -c \
  'SELECT email, name, "createdAt" FROM "User" ORDER BY "createdAt";'
```

### 5.8 Откатить миграции (опасно)

Откат миграции через Prisma — операция руками. Сценарий: применил миграцию,
поняли что она кривая, хочешь снести изменения и переделать.

```bash
# Посмотреть статус миграций
docker compose -f docker-compose.prod.yml --env-file .env run --rm backend \
  npx prisma migrate status

# Пометить миграцию как откаченную (Prisma НЕ выполняет SQL отката —
# down-миграцию надо написать самому или восстановить из бэкапа)
docker compose -f docker-compose.prod.yml --env-file .env run --rm backend \
  npx prisma migrate resolve --rolled-back 20260606000000_jira_extensions
```

В 95% случаев правильнее: **восстановить базу из последнего бэкапа** (см. 6)
и применить только нужные миграции.

---

## 6. Откат на предыдущую версию

Каждая успешная сборка пушит в Docker Hub тег `sha-<short>`. Чтобы откатиться:

1. Найди тег нужной сборки:
   - В GitHub Actions в summary прогона — там видны теги в шаге `Build & push`.
   - Или в Docker Hub UI → `<user>/tracker-backend` → Tags.
2. GitHub → Actions → *Dev CI/CD* → *Run workflow* → ветка `dev`,
   `image_tag` = `sha-abc1234`. Нажми *Run*.

Workflow пропустит test+build (видит, что тег указан) и сразу пойдёт в deploy
с этим тегом.

Если откат тебе нужен **из-за** битых данных — сначала восстанови данные из
бэкапа (секция 7), потом откати код. Иначе старый код встретит новую схему.

---

## 7. Ночные бэкапы Postgres

Простой вариант для пет-проекта: cron на VM дампит в `/opt/tracker/backups/`.

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
# держим 14 дней
find backups -type f -name 'tracker-*.sql.gz' -mtime +14 -delete
EOF
```

Crontab под пользователем `deploy`:

```bash
sudo -iu deploy crontab -e
# добавить:
15 3 * * *  /usr/local/bin/tracker-backup.sh >> /opt/tracker/backups/backup.log 2>&1
```

Восстановление (стек должен быть остановлен у backend-а):

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

## 8. Подключиться к Postgres с локального ПК (DBeaver / psql / любой клиент)

Postgres биндится только на `127.0.0.1` VM-ы (не на LAN — это специально, безопасность).
Чтобы попасть с ноута, поднимаем **SSH-туннель**. Сам туннель шифруется поверх SSH,
снаружи ничего лишнего не торчит.

### Через DBeaver

Database → New Database Connection → **PostgreSQL**.

**Вкладка Main:**

| Поле | Значение |
|---|---|
| Host | `localhost` (это локальный конец туннеля, не VM) |
| Port | `5432` |
| Database | `tracker` |
| Username | `tracker` |
| Password | значение `POSTGRES_PASSWORD` из GitHub Secrets |

**Вкладка SSH** → поставить галочку *Use SSH Tunnel*:

| Поле | Значение |
|---|---|
| Host/IP | IP твоей VM |
| Port | `22` |
| User Name | твой SSH-юзер (тот, под которым логинишься в VM, **не** `deploy`) |
| Authentication Method | Public Key (рекомендую) или Password |
| Private key | путь к твоему `~/.ssh/id_ed25519` или `id_rsa` |

Жмёшь *Test Connection* — должно зелёное. DBeaver сам поднимет туннель, отправит трафик
через SSH на VM, оттуда уже в `127.0.0.1:5432` (наш Postgres).

> Где взять пароль БД: GitHub → Settings → Secrets and variables → Actions → но
> сам секрет посмотреть **нельзя** (GitHub скрывает). Если забыл — на VM прочитаешь:
> `sudo cat /opt/tracker/.env | grep POSTGRES_PASSWORD`.

### Через `psql` с локального ПК (если не хочется DBeaver)

Открываешь в локальном терминале:

```bash
ssh -L 5432:127.0.0.1:5432 <твой-ssh-юзер>@<ip-vm>
```

Пока эта SSH-сессия открыта, на твоём ноуте локальный порт 5432 проброшен на VM.
В **другом** окне терминала:

```bash
psql -h localhost -p 5432 -U tracker -d tracker
# попросит пароль — тот же POSTGRES_PASSWORD
```

### Если порт `5432` на ноуте уже занят локальным Postgres

Используй любой другой свободный — например `15432`:

В DBeaver: SSH-вкладка → Local Port: `15432`. В Main: Port: `15432` (DBeaver сам мапит).

Через psql:
```bash
ssh -L 15432:127.0.0.1:5432 user@vm
# другом окне:
psql -h localhost -p 15432 -U tracker -d tracker
```

### Почему так, а не "просто открыть 5432 наружу"

Потому что Postgres с публичным паролем на LAN/интернете живёт ровно до первого
сканера портов. SSH-туннель — стандартная безопасная схема: и тебе не надо
заморачиваться с TLS / pg_hba правилами, и снаружи ничего не светится.

---

## 9. Шпаргалка на каждый день

```bash
# Что запущено?
sudo -iu deploy docker compose -f /opt/tracker/docker-compose.prod.yml --env-file /opt/tracker/.env ps

# Логи бэка
sudo -iu deploy docker compose -f /opt/tracker/docker-compose.prod.yml --env-file /opt/tracker/.env logs -f backend

# Какой тег образа сейчас крутится?
sudo -iu deploy docker compose -f /opt/tracker/docker-compose.prod.yml --env-file /opt/tracker/.env config | grep image:

# Сколько места ест docker
sudo docker system df

# Подчистить старые слои (workflow сам делает, но можно вручную)
sudo docker image prune -af
```

---

## 10. Ротация пароля БД — важный нюанс

Postgres инициализирует пароль из `POSTGRES_PASSWORD` **только на первом
старте**, когда том пустой. Если просто поменять секрет в GitHub и сделать
deploy — backend получит **новый** пароль, а Postgres внутри тома будет
помнить **старый**, и подключение упадёт.

Если действительно нужно поменять пароль:

```bash
sudo -iu deploy
cd /opt/tracker
# Поставить новый пароль внутри Postgres
docker compose -f docker-compose.prod.yml --env-file .env exec postgres \
  psql -U tracker -d tracker -c "ALTER USER tracker WITH PASSWORD 'НОВЫЙ_ПАРОЛЬ';"
```

После этого обнови `POSTGRES_PASSWORD` в GitHub Secrets — следующий деплой
пройдёт чисто.

---

## 11. Траблшутинг

| Симптом | Куда смотреть |
|---|---|
| Workflow висит в "Queued" на deploy-job | runner не подобрал задачу — `sudo systemctl status 'actions.runner.*'`, runner должен быть Idle на странице Settings → Actions → Runners и в его лейблах должен быть `dev` |
| `docker compose pull` пишет "denied" | Docker Hub token протух или репо приватный — обнови `DOCKERHUB_TOKEN` |
| `prisma migrate deploy` падает с `P3009` | предыдущая миграция упала на полпути — `docker compose exec backend npx prisma migrate resolve --rolled-back <name>`, потом повторить |
| Регистрация во фронте пишет "email may already be in use" | это generic-обёртка над любой ошибкой; смотри `docker compose logs --tail=80 backend` или `curl -i -X POST http://localhost/api/auth/register -H 'Content-Type: application/json' -d '{...}'` чтобы увидеть реальный код/тело |
| Логиниться нечем (нет юзеров) | прогнать сид руками: `docker compose -f docker-compose.prod.yml --env-file .env exec backend npm run prisma:seed` |
| Проверить какие миграции применились | `docker compose -f docker-compose.prod.yml --env-file .env run --rm backend npx prisma migrate status` |
| Healthcheck не дожидается | `docker compose logs backend` — обычно либо CORS_ORIGINS не совпал, либо DB не поднялась |
| 502 от edge nginx | контейнер backend нездоров — `docker ps` и `docker compose logs backend` |
| Браузер режет CORS | `CORS_ORIGINS` не точно соответствует Origin-у в браузере (без слеша в конце) — поправь секрет, передеплой |
| Бэк не подключается к БД с "password authentication failed" | пароль в `.env` разошёлся с тем, что внутри Postgres-тома — см. секцию 10 |

---

## 12. Добавить prod runner в будущем

Когда поднимешь вторую VM под prod, повторяешь шаги 1-3.1 с одной разницей:

- На вопросе `Enter the name of runner` введи **`prod-vm`**.
- На вопросе `Enter any additional labels` введи **`prod`** (не `dev`).
- В GitHub Secrets заведи отдельные значения для prod (другой `POSTGRES_PASSWORD`,
  другие JWT-секреты, другой `CORS_ORIGINS`). Чтобы они не пересекались с dev,
  используй **GitHub Environments**:
  - Repo → Settings → Environments → New environment → имя `production`.
  - Внутри environment-а заведи те же ключи секретов (`POSTGRES_PASSWORD` и т.д.),
    но с прод-значениями. Они **перекроют** одноимённые secrets уровня репо,
    но только когда workflow указал `environment: production`.
  - Включи *Required reviewers* — деплой в prod будет ждать твоей кнопки "Approve".

Затем создай `.github/workflows/prod-cd.yml` по образу `dev-cd.yml`, поменяв:

```yaml
on:
  push:
    branches: [main]              # вместо dev
# ...
  deploy:
    runs-on: [self-hosted, prod]  # вместо [self-hosted, dev]
    environment: production       # вместо dev — включит approval gate
```

Дальше workflow `dev-cd.yml` будет уходить только на `dev-vm`, `prod-cd.yml`
только на `prod-vm`, потому что лейблы у них разные. Один не подменит другой
даже случайно.

---

## 13. Чем это **не** является

- **Не multi-host.** Одна VM. Если умрёт — приложение умерло. В реальном проде
  был бы как минимум standby и managed Postgres.
- **Не zero-downtime.** `docker compose up -d` пересоздаёт контейнеры — 1-3 с
  даунтайма. В проде делают rolling deploy с двумя репликами бэкенда за edge.
- **Без TLS.** Чистый HTTP. Для локалки норм, для интернета — нет. Если
  выставишь наружу — поставь Caddy/Traefik спереди, получи Let's Encrypt.
- **Без секрет-менеджера.** Секреты лежат в GitHub Actions, при деплое пишутся
  в `/opt/tracker/.env`. Любой, кто залогинится как `deploy`, прочитает их.
  В проде используют Vault / SOPS / cloud KMS.

Для пет-проекта норм; честно про ограничения.
