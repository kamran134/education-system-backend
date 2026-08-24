# Миграции

`db/schema.sql` — снимок итогового состояния схемы, не история изменений. Он накатывался
один раз на пустую БД при переезде на Postgres (04.08.2026) и не идемпотентен — повторный
прогон на непустой базе упадёт (`CREATE TABLE` без `IF NOT EXISTS`, и это осознанно: на
пустой базе лишняя защита не нужна, а на непустой — она бы маскировала реальную ошибку).

Начиная с этой директории, любое изменение живой схемы идёт через пронумерованный SQL-файл
здесь, а `schema.sql` вручную приводится в соответствие (не автоматически!) после того, как
миграция подтверждена рабочей.

## Автоматическое применение (с 2026-08-08)

Начиная с миграции `004`, применение на прод — часть CI/CD (`.github/workflows/docker.yml`,
шаги "Copy DB migration files to server" / "Run pending DB migrations"): при каждом push в
`main` эта директория копируется на сервер и запускается `apply-pending.sh`. Он:

1. Заводит (если ещё нет) таблицу `schema_migrations` — трекинг того, что уже применено.
2. Для каждого файла `NNN_*.sql`, которого ещё нет в `schema_migrations`: делает `pg_dump`
   (кладёт в `~/rollback/` на сервере), применяет файл, записывает в `schema_migrations`.
3. Останавливается на первой же ошибке (`set -e` + `ON_ERROR_STOP=1`) — деплой самого
   backend-контейнера в этом случае не происходит, старый контейнер продолжает работать.

Бэкап перед КАЖДОЙ миграцией — по-прежнему без исключений, просто теперь его делает скрипт,
а не человек руками. Ручной способ (ниже) остаётся рабочим и нужен для миграций, применяемых
не через обычный деплой (например, экстренный хотфикс схемы без нового образа бэкенда).

## Прод уже живой

С 04.08.2026 `isim-pg` — не копия для тестов, а реальная база, которую читает и пишет
`backend-app`. Каждая миграция здесь — это правка данных настоящих детей и учителей.
Перед применением — обязательно `pg_dump` (см. ниже).

## Порядок применения

Файлы применяются строго по номеру, по одному:

```bash
# Бэкап перед КАЖДОЙ миграцией — без исключений
ssh isim "docker exec isim-pg pg_dump -U isim -d isim -F c -f /tmp/pre-migration.dump && docker cp isim-pg:/tmp/pre-migration.dump /root/rollback/pg-pre-00X-\$(date +%Y%m%d_%H%M%S).dump"

# Применение миграции (с рабочей машины, через файл на сервере, или напрямую с локального файла через stdin)
docker exec -i isim-pg psql -U isim -d isim < db/migrations/00X_name.sql
```

Если миграция не прошла (упала в середине) — она обёрнута в `BEGIN; ... COMMIT;`, так что
Postgres сам откатит незавершённую транзакцию. Восстановление из дампа нужно только если
проблема обнаружилась ПОСЛЕ коммита (данные оказались не те, что ожидались).

## Требования к файлу миграции

- Обёрнут в `BEGIN; ... COMMIT;`
- Шапка: что делает, зачем, дата, какую задачу закрывает (ссылка на `DB_REFACTOR_TASKS.md`
  или `PG_MIGRATION_TASKS.md`, где применимо)
- Только вперёд. Если откат нетривиален (не просто `DROP TABLE`) — рядом кладётся
  `00X_name_rollback.sql`
- Идемпотентность (`IF NOT EXISTS` и т.п.) — приветствуется, но не в ущерб ясности:
  на первом же прогоне миграция должна быть проверяемо детерминированной

## Список миграций

| файл | что делает |
|---|---|
| `001_levels_lookup.sql` | справочник уровней `levels` (E/D/C/B/A/Lisey) |
| `001b_levels_fk.sql` | исправление единственной мусорной записи `level='7'` → `'B'` (решение пользователя 05.08.2026) + FK `student_results.level → levels(code)` |
| `002_subjects_lookup.sql` | справочник предметов `subjects` + view `v_student_result_subject_scores` + валидация ключей `booklets.disciplines` |
| `003_student_result_status.sql` | `student_results.status` → generated-колонка от `development_score` (гейт: см. `DB_REFACTOR_TASKS.md` §4) |
| `004_code_change_log.sql` | таблица `code_change_logs` — журнал каскадных перекодировок teacher/school → потомки (`PHASE3_PLAN.md` п.4) |
| `005_regions.sql` | сущность `regions` (12 RTİ), `districts.region_id`, `region_year_ratings`, роль `regionRepresenter`, views `v_region_year_scores`/`v_region_places`. Привязка район→регион НЕ автоматическая — состав районов в проде разошёлся со справочником докса (см. шапку файла), пользователь привязывает сам через UI |
| `006_district_region_required.sql` | `districts.region_id` → `NOT NULL`. Пользователь вручную привязал все 41 район к региону через UI, привязка завершена — поле стало обязательным |
| `007_teacher_school_district_place.sql` | `v_teacher_places`/`v_school_places`: `district_place` считается (dense_rank по среднему баллу в рамках района), раньше был жёсткий `NULL` — путь B никогда не переносил эту логику с учеников на учителей/школы |
| `008_student_ranking_uses_historical_grade.sql` | `v_student_places` группировала место/districtPlace ученика по живому `students.grade` — массовое повышение класса задним числом ломало уже посчитанные места за прошедший год. Переключено на исторический `student_results.grade` (добавлен в `v_student_year_scores`) |
| `009_student_year_scores_single_grade.sql` | Инцидент сразу после 008: у части учеников `grade` расходится внутри одного `academic_year` (реальная грязь в данных) — `GROUP BY sr.grade` размножал строки, `INSERT` в `student_year_ratings` падал на PK, таблица осталась пустой. Один grade на (student_id, academic_year) теперь берётся из самого позднего по дате результата. Применена вручную на проде до пуша (см. commit) — прод был в проде неработоспособен |
| `010_school_teacher_profile_text_fields.sql` | `schools.description`/`schools.history`, `teachers.biography` — свободные текстовые поля для профиля школы/учителя, первый шаг набора по просьбе заказчика |
| `011_certificates.sql` | Именные сертификаты (`CERTIFICATES_TASK.md`): `certificate_templates` (картинка шаблона + раскладка полей `fields` jsonb, редактируется визуальным конструктором в админке), `issued_certificates` (снапшот на момент выдачи — школа/учитель не историчны в схеме, статистика пересчитывается задним числом), `certificate_serial_seq` для человекочитаемого номера |
| `012_profile_fields.sql` | Переделка профильных страниц (`PROFILES_TASK.md`): `teachers.pedagogical_start_year`/`achievements`, `schools.director_name`/`founded_year`/`achievements`, `districts.education_head_name` |
| `013_ratings_by_raw_score.sql` | Отмена решения от 04.08.2026: место учителей/школ/районов/регионов (`v_teacher_places`/`v_school_places`/`v_district_places`/`v_region_places`) переключено с `average_score` на сырой `score` — «путь B» был неверным пониманием требования заказчика, не его выбором. Ученики не менялись (уже были на `score`). См. `db/rating-semantics.md` §20.08.2026 |
| `014_teacher_grade_label.sql` | `teachers.grade_label` — класс учителя вводится вручную текстом (`PROFILES_V3_TASK.md` §2) |
| `015_academic_year_closures.sql` | `academic_year_closures` — реестр закрытых учебных годов (`ACADEMIC_YEAR_ARCHIVE_TASK.md` §3): закрытый год пересчитывать нельзя, `*_year_ratings` за него становится замороженным архивом |

Обновлять таблицу при добавлении новых файлов.
