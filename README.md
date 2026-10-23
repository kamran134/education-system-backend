# İSİM — бэкенд

REST API системы ежемесячных экзаменов и рейтингов İSİM (ученики, учителя, школы, районы и
региональные управления образования Азербайджана). Прод: `https://isim.kpm.az`.

Express 4 + TypeScript + Kysely, PostgreSQL 17. Фронтенд (Angular) — в отдельном репозитории
[education-system-frontend](https://github.com/kamran134/education-system-frontend).

## С чего начать

Читайте по порядку. Первые четыре документа дают общую картину, остальные — по мере надобности.

| # | Документ | О чём |
|---|---|---|
| 1 | [docs/01-overview.md](docs/01-overview.md) | Что за система, роли, коды сущностей, экзамены, pillə, из чего складывается балл, словарь терминов |
| 2 | [docs/02-local-setup.md](docs/02-local-setup.md) | Запуск с нуля: Postgres в Docker, `.env`, данные, бэкенд и фронтенд, первый вход |
| 3 | [docs/03-architecture.md](docs/03-architecture.md) | Слои, структура, аутентификация, role-скоупинг, файлы, мёртвый Mongo-код |
| 4 | [docs/04-ratings.md](docs/04-ratings.md) | Рейтинги: вьюхи и `*_year_ratings`, пересчёт, формулы, места, снимок «где сдавал» |
| 5 | [docs/05-academic-year.md](docs/05-academic-year.md) | Закрытие учебного года, повышение классов, архив, тумблер «Yeni tədris ili» |
| 6 | [docs/06-features.md](docs/06-features.md) | Импорт Excel, переводы, сертификаты, пол, модерация, «Uğurlar», soft delete |
| 7 | [docs/07-deploy-operations.md](docs/07-deploy-operations.md) | CI/CD, миграции при деплое, сервер, проверка версии, бэкапы, логи |
| 8 | [docs/08-traps.md](docs/08-traps.md) | Что выглядит как баг, но так задумано; известные проблемы |
| — | [docs/reference/migrations.md](docs/reference/migrations.md) | Все миграции: что и зачем |
| — | [docs/reference/api.md](docs/reference/api.md) | Все маршруты API и кто имеет доступ |

Документация фронтенда: [README](https://github.com/kamran134/education-system-frontend#readme)
и `docs/` в его репозитории.

Другие источники в этом репозитории:

- `db/rating-semantics.md` — история решений по рейтингам (почему места по сырому баллу, откуда
  делители среднего и т. п.);
- `db/migrations/README.md` и шапки самих миграций — подробное «зачем» каждого изменения схемы;
- `CLAUDE.md` — сжатый конспект для ИИ-ассистента, по фактам совпадает с `docs/`.

Остальные `*.md` в корне (`EXCEL_VALIDATION.md`, `PARTICIPATION_SCORE_CHANGES.md` и т. п.) —
заметки эпохи MongoDB, частично устарели.

## Быстрый старт

```bash
docker compose -f db/docker-compose.pg.yml up -d   # Postgres на 127.0.0.1:5433
cp .env.example .env                               # PG_URL, JWT_SECRET, JWT_REFRESH_SECRET
npm install
npm run dev                                        # http://localhost:5000
```

Базу нужно наполнить: подробности и копия прода — в [docs/02-local-setup.md](docs/02-local-setup.md).

## Пять правил, которые нельзя нарушать

1. **Пуш в `main` = деплой на прод**, включая автоматическое применение новых миграций.
2. **Запушенную миграцию не править**, исправление — только новым файлом.
3. **Доступ к данным ограничивает бэкенд** (role-скоупинг в контроллерах). Фронтенд только прячет
   кнопки.
4. **Живая логика — в `services/*.pg.ts`.** Файлы без `.pg` и `src/models/` — мёртвый код MongoDB.
5. **Закрытые учебные годы не пересчитываются** и ничего настоящего не удаляется: удаление
   сущностей — soft delete.

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev` | dev-сервер (nodemon + ts-node) |
| `npm run build` | компиляция в `dist/` |
| `npm start` | запуск собранного `dist/index.js` |
| `npm test` | заглушка: тестов нет |
