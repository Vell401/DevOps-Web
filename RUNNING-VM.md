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

Смотреть логи:

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
# {"status":"ok"}
```

Открывай в браузере `http://<IP_VM>/`. Логин — `1@1.com` / `12345678`, если
зайдёшь под seed-аккаунт (см. ниже).

> **Сид в проде?** Сид удаляет существующие данные. Workflow его НЕ запускает.
> Один раз руками после первого деплоя:
> ```bash
> sudo -iu deploy
> cd /opt/tracker
> docker compose -f docker-compose.prod.yml --env-file .env exec backend npm run prisma:seed
> ```

---

## 5. Откат на предыдущую версию

Каждая успешная сборка пушит в Docker Hub тег `sha-<short>`. Чтобы откатиться:

1. Найди тег нужной сборки:
   - В GitHub Actions в summary прогона — там видны теги в шаге `Build & push`.
   - Или в Docker Hub UI → `<user>/tracker-backend` → Tags.
2. GitHub → Actions → *Dev CI/CD* → *Run workflow* → ветка `dev`,
   `image_tag` = `sha-abc1234`. Нажми *Run*.

Workflow пропустит test+build (видит, что тег указан) и сразу пойдёт в deploy
с этим тегом.

---

## 6. Ночные бэкапы Postgres

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

## 7. Шпаргалка на каждый день

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

## 8. Ротация пароля БД — важный нюанс

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

## 9. Траблшутинг

| Симптом | Куда смотреть |
|---|---|
| Workflow висит в "Queued" на deploy-job | runner не подобрал задачу — `sudo systemctl status 'actions.runner.*'`, runner должен быть Idle на странице Settings → Actions → Runners и в его лейблах должен быть `dev` |
| `docker compose pull` пишет "denied" | Docker Hub token протух или репо приватный — обнови `DOCKERHUB_TOKEN` |
| `prisma migrate deploy` падает с `P3009` | предыдущая миграция упала на полпути — `docker compose exec backend npx prisma migrate resolve --rolled-back <name>`, потом повторить |
| Healthcheck не дожидается | `docker compose logs backend` — обычно либо CORS_ORIGINS не совпал, либо DB не поднялась |
| 502 от edge nginx | контейнер backend нездоров — `docker ps` и `docker compose logs backend` |
| Браузер режет CORS | `CORS_ORIGINS` не точно соответствует Origin-у в браузере (без слеша в конце) — поправь секрет, передеплой |
| Бэк не подключается к БД с "password authentication failed" | пароль в `.env` разошёлся с тем, что внутри Postgres-тома — см. секцию 8 |

---

## 10. Добавить prod runner в будущем

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

## 11. Чем это **не** является

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
