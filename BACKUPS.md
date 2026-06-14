# Резервное копирование Tracker (restic)

Полная инструкция по установке, настройке и эксплуатации бэкапов на
прод-сервере. Общий деплой описан в [RUNNING-VM.md](./RUNNING-VM.md).

## TL;DR

- Бэкапятся **PostgreSQL** (логический дамп `pg_dump`) и **MinIO** (каталог тома
  с вложениями и аватарами) в один зашифрованный **restic**-репозиторий.
- Запуск — на хосте под **root** через **systemd-timer**, каждые **6 часов**.
  Не контейнер и не от CI-аккаунта `deploy`.
- Хранение (GFS): `keep-last 8 / daily 7 / weekly 4 / monthly 3`.
- Целостность: `restic check` каждый прогон, `--read-data-subset` раз в неделю,
  полный restore-drill раз в месяц вручную.
- Статус последнего прогона виден в админке: `/admin/metrics` → карточка
  «restic backups».
- Что НЕ бэкапим: Redis (кэш/адаптер — восстановимо), `.env`/секреты (в GitHub
  Secrets), код (в git).

## Почему так

- **restic**: дедупликация + инкремент (MinIO не пере-архивируется целиком
  каждый раз), встроенное шифрование, встроенный GFS-ретеншн и проверка
  целостности, гранулярное восстановление.
- **На хосте, не в контейнере**: на одной VM systemd-timer надёжнее и
  наблюдаемее (`journalctl`, `systemctl list-timers`), чем спящий cron-контейнер;
  `pg_dump` берётся из уже работающего образа `postgres:16` (версии совпадают).
- **От root, не от `deploy`**: репозиторий и пароль root-only, поэтому
  скомпрометированный GitHub-workflow (`deploy`) не прочитает и не затрёт бэкапы.

### Как обеспечивается консистентность БД

restic **не** копирует файлы Postgres напрямую (это дало бы «битые» страницы).
Дамп делает `pg_dump`, который берёт **MVCC-снимок**: видит базу на один момент
времени, не блокируя приложение. Поток `pg_dump` пайпится прямо в restic
(`--stdin`) — на диск открытый дамп не ложится. Консистентность гарантирует
`pg_dump`, restic лишь хранит его байты.

---

## 1. Установка (один раз, под root)

```bash
# restic (Ubuntu 24.04). Можно взять свежий бинарь с GitHub-релизов, если в
# репозитории дистрибутива версия устарела.
sudo apt update && sudo apt install -y restic

# Сгенерировать СИЛЬНЫЙ пароль репозитория и положить его в файл (root, 600).
# ВАЖНО: храните копию этого пароля ВНЕ сервера (менеджер паролей). Потеря
# пароля = невозможность восстановиться из всех снапшотов.
umask 077
openssl rand -base64 48 | sudo tee /root/.restic-pass >/dev/null
sudo chmod 600 /root/.restic-pass

# Инициализировать репозиторий на локальном диске сервера.
sudo RESTIC_PASSWORD_FILE=/root/.restic-pass \
  restic -r /opt/tracker/backups/restic init
```

## 2. Установка systemd-timer

Скрипт `deploy/tracker-backup.sh` и reference-копии unit'ов попадают на сервер
автоматически (шаг «Sync deploy assets» в CI кладёт их в
`/opt/tracker/deploy/`). Установить таймер:

```bash
sudo cp /opt/tracker/deploy/systemd/tracker-backup.service /etc/systemd/system/
sudo cp /opt/tracker/deploy/systemd/tracker-backup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tracker-backup.timer

# Проверка:
systemctl list-timers tracker-backup.timer
```

Таймер: `OnCalendar=*-*-* 00,06,12,18:15:00` (каждые 6 часов, `Persistent=true`
догоняет пропущенный прогон). Параметры restic заданы в `.service` через
`Environment=` (`RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE`) — в `.env`
приложения секретов бэкапа нет.

### Еженедельная глубокая проверка (опционально)

`restic check` каждый прогон проверяет структуру. Чтобы раз в неделю
дополнительно перечитывать часть реальных данных, добавьте drop-in для
отдельного запуска или второй таймер с `Environment=BACKUP_CHECK_READ_DATA=1`.

### Алерт «бэкап не пришёл» (опционально)

Задайте в `.service` `Environment=BACKUP_PING_URL=https://hc-ping.com/<uuid>`
(healthchecks.io или self-hosted) — скрипт пингует URL при успехе; сервис
поднимет тревогу, если прогон пропал. Это ловит «таймер вообще не сработал»,
чего локальные логи не покажут.

## 3. Первый прогон и проверка

```bash
# Запустить вручную, не дожидаясь таймера:
sudo systemctl start tracker-backup.service
journalctl -u tracker-backup.service -n 50 --no-pager

# Снимки появились?
sudo RESTIC_PASSWORD_FILE=/root/.restic-pass \
  restic -r /opt/tracker/backups/restic snapshots

# Статус виден в админке: /admin/metrics → карточка «restic backups».
```

---

## 4. Восстановление

Восстанавливать БД и MinIO из снапшотов **одного прогона** (близкие по времени),
чтобы строки `Attachment` соответствовали объектам. `cd /opt/tracker`.

Удобные алиасы для сессии:

```bash
export RESTIC_PASSWORD_FILE=/root/.restic-pass
export RESTIC_REPOSITORY=/opt/tracker/backups/restic
alias rc='sudo -E restic'
rc snapshots          # выбрать нужный <snapshotID>
```

### 4.1 PostgreSQL

```bash
docker compose -f docker-compose.prod.yml --env-file .env stop backend
rc dump <snapshotID> tracker-db.dump \
  | docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
      pg_restore -U tracker -d tracker --clean --if-exists
docker compose -f docker-compose.prod.yml --env-file .env start backend
```

### 4.2 MinIO

```bash
docker compose -f docker-compose.prod.yml --env-file .env stop minio backend
# Восстановить файлы во временную папку…
rc restore <snapshotID> --target /tmp/minio-restore
# …и залить их в том MinIO (путь тома — docker volume inspect):
VOL=$(docker volume inspect -f '{{ .Mountpoint }}' tracker_minio_data)
sudo rsync -a --delete "/tmp/minio-restore$VOL/" "$VOL/"
docker compose -f docker-compose.prod.yml --env-file .env start minio backend
```

После восстановления — проверить `curl -sS http://localhost/api/health/ready` и
вход в приложение.

---

## 5. Ежемесячный restore-drill (вручную)

Бэкап без проверки восстановления — «бэкап Шрёдингера». Раз в месяц:

```bash
export RESTIC_PASSWORD_FILE=/root/.restic-pass
export RESTIC_REPOSITORY=/opt/tracker/backups/restic
# Поднять одноразовый Postgres и восстановить в него последний дамп:
docker run -d --rm --name restore-test -e POSTGRES_PASSWORD=x postgres:16-alpine
sudo -E restic dump latest tracker-db.dump \
  | docker exec -i restore-test pg_restore -U postgres -d postgres --clean --if-exists --no-owner
docker exec restore-test psql -U postgres -d postgres -c 'SELECT count(*) FROM "User";'
docker stop restore-test
```

Непустой счётчик пользователей = дамп валиден и восстановим.

---

## 6. Эксплуатация

```bash
export RESTIC_PASSWORD_FILE=/root/.restic-pass
export RESTIC_REPOSITORY=/opt/tracker/backups/restic

sudo -E restic snapshots                 # список снапшотов
sudo -E restic stats                     # размер/дедуп репозитория
sudo -E restic check                     # проверка целостности
journalctl -u tracker-backup.service -f  # логи прогонов
df -h /opt/tracker                       # свободное место (см. ниже)
```

Ротация выполняется автоматически (`restic forget --prune` в каждом прогоне).

---

## 7. Ограничения (осознанные, для пет-проекта)

- **Не 3-2-1.** Бэкапы лежат на той же машине: защищают от логических аварий
  (кривая миграция, случайный `down -v`, удаление/порча данных) и от
  компрометации CI-аккаунта `deploy`, но **не от смерти диска/VM и не от
  компрометации root**. Полноценная защита — копия вне сервера.
- **Append-only недостижим локально.** Защита от «ransomware» (нельзя удалить
  старые снапшоты) требует remote-бэкенда: `rest-server --append-only` на другой
  машине или bucket с object-lock (B2/S3). Это будущий шаг.
- **Один критичный пароль репозитория** — хранить офлайн обязательно.
- **Диск.** Репозиторий растёт на том же диске, что и тома БД/MinIO. Если диск
  заполнится — Postgres не сможет писать. Митигация: умеренный ретеншн (п. TL;DR)
  + следить за `df` / `restic stats`; при росте проекта — отдельный раздел/диск.
- **MinIO** копируется как каталог живого тома: теоретически можно поймать
  один недописанный объект, но не весь бэкап. Для низкой записи приемлемо.

## 8. Как это связано с приложением

Приложение бэкапы **не запускает** — это полностью ops-слой. Единственная связь:
скрипт пишет `/opt/tracker/backups/status.json` (без секретов: время и результат
прогона, число снапшотов, размер репо, результат `check`), а бэкенд монтирует
этот файл **read-only** и показывает на `/admin/metrics`. Карточка краснеет/желтеет,
если бэкап провалился или устарел (старше ~7 ч) — это и есть визуальный сигнал.
