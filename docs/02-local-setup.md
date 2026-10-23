# 2. Локальный запуск с нуля

Цель: поднять бэкенд и фронтенд на своей машине с локальной копией базы.

## Что нужно

- Node.js 22 LTS. Docker-образ бэкенда собирается на `node:22`. Kysely поставляется только как
  ESM, и `require()` ESM-пакетов из CommonJS-сборки работает только с Node 22.12+. На Node 18 бэкенд
  падает с `ERR_REQUIRE_ESM`. Angular 21 тоже требует свежий Node.
- Docker (Docker Desktop на Windows/macOS) — для Postgres.
- Git. `psql` не обязателен: всё делается через `docker exec`.

Клонируйте оба репозитория рядом:

```
<рабочая папка>/
  education-system-back/    ← github.com/kamran134/education-system-backend
  education-system-front/   ← github.com/kamran134/education-system-frontend
```

## 1. Postgres в Docker

В репозитории есть compose-файл для локальной базы: Postgres 17, контейнер `isim-pg-dev`, порт
`127.0.0.1:5433`, пользователь, пароль и база — `isim`. Это локальные учётные данные из файла,
к проду они отношения не имеют.

```bash
cd education-system-back
docker compose -f db/docker-compose.pg.yml up -d
```

Кластер создаётся с ICU-локалью (`POSTGRES_INITDB_ARGS`). Без ICU не создастся коллация `az_ci`,
на которой держится азербайджанская сортировка имён.

## 2. Данные: два пути

### Путь А (рабочий): копия продовой базы

Так разработчики работают на практике. Все справочники, типы экзаменов, шкалы и реальные данные
сразу на месте. Нужен SSH-доступ к прод-серверу (его выдаёт владелец).

```bash
# на своей машине: дамп с сервера (~1 МБ в сжатом custom-формате)
ssh <прод-сервер> 'docker exec isim-pg pg_dump -U isim -d isim -Fc -Z 6' > isim-prod-YYYY-MM-DD.dump

# в локальный контейнер
docker cp isim-prod-YYYY-MM-DD.dump isim-pg-dev:/tmp/prod.dump
docker exec isim-pg-dev pg_restore --no-owner --role=isim -U isim -d isim /tmp/prod.dump
```

- Восстанавливайте в **пустую** базу. Если в `isim` уже что-то есть, пересоздайте её:
  `docker exec isim-pg-dev dropdb -U isim isim` и `docker exec isim-pg-dev createdb -U isim isim`
  (при подключённом бэкенде сначала остановите его).
- В Git Bash на Windows путь `/tmp/...` внутри `docker exec` переписывается в виндовый. Пишите
  `//tmp/prod.dump` или запускайте команды из PowerShell.
- **В дампе персональные данные детей** (ФИО, пол, фото не входят — они на диске сервера).
  Держите дампы вне репозиториев и не передавайте третьим лицам. Отправки писем и SMS в коде нет,
  поэтому локальная копия никому ничего не разошлёт.

### Путь Б: пустая база из `db/schema.sql`

`db/schema.sql` — актуальный снимок **структуры** (включая soft delete и снимок результатов), но
**без данных**. На пустой базе нет 12 регионов, шкалы `isim_percent`, базового типа экзамена с
секциями и справочника предметов, поэтому импорт результатов работать не будет. Эти справочные
данные засеиваются миграциями `005_regions.sql`, `002_subjects_lookup.sql`,
`023_exam_types_and_level_scales.sql`, `025d_question_counts_from_file.sql`. Их `INSERT` придётся
выполнить вручную, а миграции целиком на такую базу не накатываются (структура в них уже есть).
Этот путь не поддерживается, используйте его, только если копии прода нет.

```bash
docker exec -i isim-pg-dev psql -U isim -d isim -v ON_ERROR_STOP=1 < db/schema.sql
```

## 3. Бэкенд

```bash
cd education-system-back
cp .env.example .env
npm install
```

Переменные `.env` (читаются в `src/config/env.ts` и `src/index.ts`):

| Переменная | Обязательна | Значение локально | Назначение |
|---|---|---|---|
| `PG_URL` | да | `postgres://isim:isim@127.0.0.1:5433/isim` | строка подключения к Postgres |
| `JWT_SECRET` | да | любая длинная случайная строка | подпись access-токенов (15 мин). От него же HMAC-ключ ссылок на файлы «Uğurlar» |
| `JWT_REFRESH_SECRET` | да | другая длинная строка | подпись refresh-токенов (7 дней) |
| `PORT` | нет | `5000` | фронтенд в dev-режиме ходит на `localhost:5000` |
| `NODE_ENV` | нет | `development` | в `production` глушатся `console.log/info/warn` и `morgan`, refresh-кука ставится с `SameSite=None` |
| `FRONTEND_URL` | нет | `http://localhost:4200` | адрес в QR-коде сертификата; по умолчанию `https://isim.kpm.az` |
| `CORS_ORIGINS` | нет | — | список origin через запятую; по умолчанию `localhost:4200`, `localhost:5173`, `isim.kpm.az`, `newisim.kpm.az` |
| `MONGO_URI` | нет | — | наследие MongoDB, кодом не читается |

Без `PG_URL`, `JWT_SECRET` или `JWT_REFRESH_SECRET` сервер не стартует.

```bash
npm run dev        # nodemon + ts-node на src/index.ts → http://localhost:5000
```

`GET http://localhost:5000/` отвечает `API is running!`. Перед `listen` сервер загружает в память
шкалы pillə (без них падает) и пытается автоматически закрыть завершённые учебные годы (ошибка
только логируется). Подробнее — в [05-academic-year.md](05-academic-year.md).

После `git pull` сначала `npm install`, иначе ts-node падает на новых модулях.

## 4. Фронтенд

```bash
cd education-system-front
npm install
npm start          # ng serve → http://localhost:4200
```

Адрес API — в `src/environments/environment.ts` (`http://localhost:5000/api`). Продовая сборка
подменяет его на относительный `/api` (`environment.prod.ts`).

`ng serve` читает `angular.json` один раз при старте. После любой правки `angular.json` или
`tsconfig*.json` перезапустите dev-сервер, иначе получите фантомные ошибки сборки и «вечный»
редирект на `/login`.

## 5. Вход

Публичная регистрация создаёт только неодобренного ученика, поэтому администратора на локальной
базе заводят прямо в БД. Хеш пароля — bcrypt с cost 10:

```bash
cd education-system-back
node -e "require('bcrypt').hash(process.argv[1], 10).then(console.log)" 'LocalPass123'
```

```sql
-- docker exec -it isim-pg-dev psql -U isim -d isim
INSERT INTO users (email, password_hash, role, is_approved)
VALUES ('dev@local.test', '<хеш из команды выше>', 'superadmin', true);
```

Чтобы проверить экраны другой роли, создайте пользователя через админку («İdarəetmə →
İstifadəçilər») и привяжите его к сущности (`district_id`, `school_id`, `teacher_id`, ...).
Каждый вход создаёт refresh-сессию, у пользователя их не больше 5. Шестой вход вытесняет самую
старую сессию, и браузер с ней вылетает на `/login`. Для проверок API скриптами удобнее подписать
JWT локальным `JWT_SECRET`, чем каждый раз логиниться.

## 6. Новая миграция локально

`apply-pending.sh` нацелен только на продовый контейнер `isim-pg`. Локально миграцию применяют
руками и записывают в журнал, чтобы локальная база не расходилась с продом:

```bash
docker exec -i isim-pg-dev psql -U isim -d isim -v ON_ERROR_STOP=1 < db/migrations/039_xxx.sql
docker exec isim-pg-dev psql -U isim -d isim -c "INSERT INTO schema_migrations (filename) VALUES ('039_xxx.sql')"
```

Правила написания миграций и что происходит при пуше — в [07-deploy-operations.md](07-deploy-operations.md).

Типы Kysely (`src/types/db.ts`) сгенерированы `kysely-codegen` (devDependency). После изменения
схемы их можно перегенерировать против локальной базы с применённой миграцией
(`npx kysely-codegen --url "$PG_URL" --out-file src/types/db.ts`) или поправить вручную. В обоих
случаях проверьте diff: базовые таблицы называются `students_all` и т. д., а код работает через
одноимённые вьюхи без суффикса (см. [06-features.md](06-features.md#soft-delete-и-silinənlər)).

## 7. Сборка

| | Команда | Результат |
|---|---|---|
| Бэкенд | `npm run build` | `tsc` → `dist/`; запуск собранного — `npm start` (`node dist/index.js`) |
| Фронтенд | `npm run build` | продовая сборка → `dist/education-system-frontend/browser` |

Тестов в бэкенде нет: `npm test` — заглушка с кодом выхода 1. Во фронтенде 39 `.spec.ts`, почти
все — шаблон Angular CLI с одной проверкой `should create`. Зелёная сборка ничего не доказывает:
изменения проверяют вручную на локальной копии прода.
