# 3. Архитектура бэкенда

## Стек

| | |
|---|---|
| Runtime | Node.js 22 (образ `node:22`) |
| HTTP | Express 4, `helmet`, `cors`, `cookie-parser`, `express-rate-limit`, `multer` |
| БД | PostgreSQL 17, драйвер `pg`, query builder **Kysely** (типы в `src/types/db.ts`) |
| Auth | `jsonwebtoken` (access + refresh), `bcrypt` |
| Excel | `xlsx` (SheetJS, чтение), `xlsx-js-style` + `fflate` (только генерация шаблона результатов) |
| PDF | `pdf-lib` + `@pdf-lib/fontkit` (сертификаты), `qrcode` |
| Картинки | `sharp` (кроп аватаров по лицу, пережатие фонов сертификатов) |

`mongoose` и `mongodb` всё ещё в `dependencies`, но рантайм их не использует (см. ниже).

## Структура репозитория

```
src/
  index.ts              точка входа: middleware, монтирование роутов, старт
  config/               env.ts (обязательные переменные), pg.ts (единственный экземпляр Kysely), multer.ts
  middleware/           auth.middleware.ts (гварды), activity.middleware.ts, errorHandler.ts
  routes/*.routes.ts    по файлу на домен, монтируются в index.ts под /api/<домен>
  controllers/          разбор запроса, role-скоупинг, вызов usecase/сервиса, ответ
  usecases/             валидация и оркестрация, тонкий слой (есть не у всех доменов)
  services/*.pg.ts      вся бизнес-логика и доступ к данным
  utils/                общие утилиты (коды, учебный год, скоупинг, ранжирование, ...)
  types/db.ts           типы схемы для Kysely (kysely-codegen)
  models/, services/*.service.ts без .pg, _backups_ratings_migration/   мёртвый код эпохи MongoDB
db/
  schema.sql            читаемый снимок итоговой схемы
  migrations/           пронумерованные миграции + apply-pending.sh + README.md
  rating-semantics.md   история и семантика расчёта рейтингов
  docker-compose.pg.yml локальный Postgres
assets/fonts/           шрифты для PDF-сертификатов (коммитятся в репозиторий)
scripts/                разовые скрипты ETL из Mongo и сверок; в рантайме не участвуют
uploads/                файлы пользователей (в .gitignore)
```

В корне лежат старые `*.md` (`EXCEL_VALIDATION.md`, `PARTICIPATION_SCORE_CHANGES.md`, ...). Это
заметки эпохи MongoDB, они частично устарели. Актуальны `docs/`, `CLAUDE.md`,
`db/rating-semantics.md` и `db/migrations/README.md`.

## Слои

```
routes → controllers → usecases → services/*.pg.ts → Kysely → Postgres
```

- **routes** навешивают гварды (`authMiddleware([...роли])`, `checkAdminRole`, `canDelete`) и
  multer. Полная карта — [reference/api.md](reference/api.md).
- **controllers** разбирают запрос (`utils/request-parser.util.ts`: пагинация, фильтры,
  сортировка), **сужают выборку по роли** (см. ниже) и отвечают через
  `utils/response-handler.util.ts` (`ResponseHandler.success/notFound/...`). DI ручной: контроллер
  сам создаёт свои сервисы, контейнера нет.
- **usecases** — валидация (`utils/validation.util.ts`) и склейка нескольких сервисов.
- **services/*.pg.ts** — вся логика и SQL. Сложные запросы написаны сырым `sql\`...\`` из Kysely.
  Компилятор их не проверяет: при переименовании колонок ищите имя по всему `src/` текстом.

Соглашения, которые стоит держать:

- Ошибки ловятся в каждом методе контроллера своим `try/catch`. Глобальный `errorHandler` есть, но
  срабатывает в основном для multer (`LIMIT_FILE_SIZE` → 413) и ошибок с `err.status`, переданных
  через `next(err)`.
- `express-validator` используется только в `auth.controller.ts`, в остальных местах —
  `ValidationUtils`.
- Транзакции включаются явно (`pg.transaction().execute(...)`) там, где запись многошаговая:
  каскад кодов, перевод учителя, закрытие года, повышение классов, импорт результатов, пересчёт
  рейтингов, soft delete, модерация. Остальные пути не атомарны, проверяйте конкретный сервис.
- Сортировка по именам — `COLLATE az_ci` (ICU-коллация из `schema.sql`). Азербайджанский порядок
  букв — требование заказчика.
- Время: даты экзаменов сравниваются по календарному дню в `Asia/Baku`. Старые экзамены хранятся
  как `20:00Z` предыдущего дня, поэтому `getUTCMonth()` для них даёт неверный месяц.
- Тексты ответов пользователю — на азербайджанском, комментарии в коде — на русском или
  английском.

## MongoDB — мёртвый код, не запасной вариант

До 04.08.2026 система работала на MongoDB, затем переехала на Postgres. От Mongo-эпохи остались
`src/models/*`, все `services/*.service.ts` **без** суффикса `.pg` (`stats.service.ts`,
`student.service.ts`, `statistics.service.ts`, ...), `utils/stats.utils.ts`,
`utils/migrate-ratings.ts`, `utils/profile-summary.util.ts` и каталог
`src/_backups_ratings_migration/`. `index.ts` не подключается к Mongo, и ни один живой файл их не
импортирует. Они при этом компилируются в `dist/`.

Главная ловушка: поиск «где считается балл учителя» первым находит `stats.service.ts` на 1866
строк, а живая реализация — `stats.service.pg.ts`. Баг, найденный в файле без `.pg`, на проде
недостижим. Удаление этого кода — отдельное решение владельца, мимоходом его не удаляют.

## Аутентификация

- `POST /api/auth/login` → access-токен (JWT, **15 минут**) в теле ответа, refresh-токен (JWT,
  **7 дней**) в httpOnly-куке `refreshToken`. В production кука ставится с `SameSite=None; Secure`.
- В JWT лежат `userId`, `role` и id привязанной сущности (`regionId` / `districtId` / `schoolId` /
  `teacherId` / `studentId`). Гварды берут роль и привязку **из токена** и в БД не ходят. Смена
  роли или блокировка вступает в силу, когда истечёт access-токен.
- Refresh-токены хранятся в `user_refresh_tokens`. На пользователя не больше 5 сессий, при
  превышении удаляются самые старые (`token.service.pg.ts::limitUserTokens`). Просроченные токены
  чистит фоновый таймер, запущенный при старте (`startTokenCleanupScheduler`).
- Вход возможен только при `users.is_approved = true`. Новых пользователей одобряет администратор
  (`POST /api/auth/approve/:id`) или сразу создаёт их одобренными в админке.
- Вход и refresh отказывают, если сущность пользователя (ученик, учитель, школа, район) скрыта
  soft delete (`utils/deleted-account.util.ts`, 403 / 401).
- Ограничение частоты (`index.ts`, `auth.routes.ts`):
  - анонимный трафик — 100 запросов в минуту с IP. Запросы с токеном нашей подписи
    (даже просроченным) не считаются: школы сидят за общим NAT;
  - `/api/auth/*` — 200 неуспешных попыток за 15 минут с IP;
  - `/api/auth/login` — 10 неуспешных попыток за 15 минут на пару IP+email.
- `app.set('trust proxy', 1)`: перед бэкендом ровно один прокси (`nginx-proxy`). Без этого все
  пользователи выглядели бы для лимитера одним IP.

## Role-скоупинг — граница безопасности

Фронтенд скрывает кнопки и разделы, но **какие строки отдать, решает только бэкенд**. Каждый
эндпоинт списков и статистики сужает фильтры по роли из JWT:

```
regionRepresenter   → filters.districtIds = districtIdsOfRegion(regionId)   (utils/region-scope.util.ts)
districtRepresenter → filters.districtIds = [districtId]
schoolDirector      → filters.schoolIds   = [schoolId]
teacher             → filters.teacherIds  = [teacherId]
student             → только своя запись
superadmin / admin / moderator → без ограничений
```

Этот блок продублирован по контроллерам: `student`, `teacher`, `school`, `district`, `stat`,
`statistics`, `examResults`. Самая аккуратная версия — `statistics.controller.ts::applyRbacFilters`:
она убирает только фильтры шире или вне области пользователя и сохраняет более узкие (например,
директор, открывший профиль своего учителя, видит цифры учителя, а не всей школы). В старых местах
этой доработки может не быть.

Профили (`GET /:id`) дополнительно проверяют, что сущность в области пользователя, иначе 403.
Правки профиля, фото и файлы проверяют владение (`utils/avatar.util.ts`,
`achievementFile.service.pg.ts`). «Админоподобные» роли (`isAdminLike`) — `superadmin`, `admin`,
`moderator`.

**Новая роль со своей областью видимости** = правка каждого из этих контроллеров плюс значения
для всех ключей в `rbac.config.ts` фронтенда.

## Файлы на диске

Облачного хранилища нет, всё пишется в `uploads/` относительно рабочего каталога процесса. На
сервере это каталог `~/uploads`, смонтированный в контейнер (см.
[07-deploy-operations.md](07-deploy-operations.md)).

| Путь | Что | Как отдаётся |
|---|---|---|
| `uploads/<students|teachers|schools|districts|regions>/avatars/` | фото сущностей, кроп по лицу (`utils/smart-crop.util.ts`) | статикой `/uploads/...` без авторизации |
| `uploads/certificates/` | фоны шаблонов сертификатов (пережаты `sharp` из CMYK в RGB) | статикой |
| `uploads/achievements/<teachers|schools>/<id>/` | файлы «Uğurlar» | **не** статикой: префикс закрыт в `index.ts`, файл отдаётся только по подписанной ссылке `/api/achievement-files/:id/content` |
| `uploads/temp/` | временные Excel при импорте | удаляются после обработки |

На маршрутах загрузки `authMiddleware` всегда стоит **до** multer, иначе анонимный запрос успел
бы записать файл в `uploads/temp/`. Новые маршруты загрузки делайте так же.

## Что происходит при старте

1. Запускается таймер очистки refresh-токенов.
2. Загружается кэш шкал pillə (`loadLevelScaleBandsCache`). Если не загрузился, `process.exit(1)`.
3. Автозакрытие завершённых учебных годов (`ensureFinishedYearsClosed`, ошибка только логируется,
   см. [05-academic-year.md](05-academic-year.md)).
4. `app.listen(PORT)`.

Других фоновых задач по расписанию в процессе нет. Пересчёт рейтингов запускается кнопкой или
побочно после удаления, восстановления и перевода (см. [04-ratings.md](04-ratings.md)).
