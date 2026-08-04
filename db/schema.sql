-- İSİM — схема PostgreSQL.
-- Источник перевода: education-system-back/src/models/*.ts по состоянию на 04.08.2026.
-- Составлено Opus 5. Решения по типам и ключам обоснованы в MONGO_TO_POSTGRES.md §2.
--
-- Правила, действующие по всему файлу:
--   * PK — bigserial (surrogate). `code` — бизнес-ключ, UNIQUE, но НЕ первичный: коды меняются (PHASE3 п.4).
--   * Баллы — double precision, никогда не numeric: иначе округление разойдётся с текущей системой (§2.4).
--   * legacy_mongo_id — временный столбец на время миграции и сверки. Удалить после переключения.
--   * Денормализованные score/averageScore/place НЕ хранятся — это views в конце файла.
--     Хранятся только исторические снапшоты по годам (*_year_ratings), они приходят из Mongo как есть.
--
-- Применение: psql -f schema.sql (idempotent-обёртки намеренно нет — накатывается на пустую БД).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Азербайджанская сортировка. Замена .collation({ locale: 'az', strength: 2 }) из stats.service.ts.
-- strength: 2 (ICU level 2) = диакритика учитывается, регистр нет → deterministic = false обязателен.
-- ВНИМАНИЕ: соответствие проверяется эмпирически (задача 5 в PG_MIGRATION_TASKS.md), не на веру.
CREATE COLLATION IF NOT EXISTS az_ci (provider = icu, locale = 'az-u-ks-level2', deterministic = false);


-- ============================================================ справочники и сущности

CREATE TABLE districts (
    id                          bigserial PRIMARY KEY,
    code                        bigint  NOT NULL UNIQUE,          -- 3 знака
    name                        text    NOT NULL,
    region                      text,                             -- в проде NULL у всех 41 (аудит 25.07.2026); PHASE3 п.1б сделает из этого сущность
    student_count               int,
    rate                        double precision,
    district_of_the_year_score  double precision DEFAULT 0,
    active                      boolean NOT NULL DEFAULT true,
    avatar_url                  text,
    legacy_mongo_id             text UNIQUE
);

CREATE TABLE schools (
    id                        bigserial PRIMARY KEY,
    code                      bigint  NOT NULL UNIQUE,            -- 5 знаков = district*100 + nn
    name                      text    NOT NULL,
    address                   text,
    district_id               bigint  NOT NULL REFERENCES districts(id),
    student_count             int,
    status                    text,
    school_of_the_year_score  double precision DEFAULT 0,
    active                    boolean NOT NULL DEFAULT true,
    avatar_url                text,
    legacy_mongo_id           text UNIQUE
    -- School.districtCode намеренно НЕ переносится: денормализованная копия districts.code,
    -- в Postgres это JOIN. Если фронт ждёт districtCode в ответе — отдавать из джойна.
);

CREATE TABLE teachers (
    id                         bigserial PRIMARY KEY,
    code                       bigint  NOT NULL UNIQUE,           -- 7 знаков = school*100 + nn
    fullname                   text    NOT NULL,
    school_id                  bigint  REFERENCES schools(id),    -- NULL допустим: в проде 2 учителя без школы
    district_id                bigint  REFERENCES districts(id),
    student_count              int,                               -- ВАЖНО: именно на него делится average_score (см. views)
    status                     text,
    teacher_of_the_year_score  double precision DEFAULT 0,
    active                     boolean NOT NULL DEFAULT true,
    avatar_url                 text,
    legacy_mongo_id            text UNIQUE
);

CREATE TABLE students (
    id               bigserial PRIMARY KEY,
    code             bigint  NOT NULL UNIQUE,                     -- 10 знаков = teacher*1000 + nnn. bigint обязателен: не влезает в int4
    last_name        text,
    first_name       text    NOT NULL,
    middle_name      text,
    grade            int,
    teacher_id       bigint  REFERENCES teachers(id),
    school_id        bigint  REFERENCES schools(id),
    district_id      bigint  REFERENCES districts(id),
    max_level        int,
    status           text,
    avatar_url       text,
    legacy_mongo_id  text UNIQUE
    -- UNIQUE(code) — то, чего нет в Mongo. В проде 2 группы дублей (аудит 25.07.2026),
    -- ETL на них упадёт. Это гейт, а не баг: заказчик решает, кому менять код.
);

CREATE TABLE exams (
    id               bigserial PRIMARY KEY,
    code             bigint      NOT NULL UNIQUE,
    name             text        NOT NULL,
    date             timestamptz NOT NULL,
    active           boolean     NOT NULL DEFAULT true,
    legacy_mongo_id  text UNIQUE
    -- PHASE3 п.5 добавит include_in_rating boolean NOT NULL DEFAULT true — отдельной миграцией,
    -- вместе с правкой v_student_year_scores (JOIN exams ... WHERE include_in_rating).
);


-- ============================================================ результаты

CREATE TABLE student_results (
    id          bigserial PRIMARY KEY,
    student_id  bigint NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    exam_id     bigint REFERENCES exams(id),                      -- в Mongo required:false, оставлено nullable
    grade       int    NOT NULL,

    -- disciplines.* — баллы по предметам. Набор фиксирован → столбцы, не JSONB (§2.3)
    az                 double precision NOT NULL,
    math               double precision NOT NULL,
    life_knowledge     double precision,
    logic              double precision,
    english            double precision,

    -- questionCounts.* — количество вопросов по тем же предметам
    az_count             int NOT NULL,
    math_count           int NOT NULL,
    life_knowledge_count int,
    logic_count          int,
    english_count        int,

    total_score  double precision NOT NULL,
    score        double precision NOT NULL,
    level        text             NOT NULL,                       -- E/D/C/B/A/Lisey, см. common.service.ts calculateLevel
    status       text,

    -- четыре слагаемых итогового балла ученика (см. v_student_year_scores)
    participation_score                      double precision NOT NULL,
    development_score                        double precision,
    student_of_the_month_score               double precision,
    republic_wide_student_of_the_month_score double precision,

    month  int NOT NULL CHECK (month BETWEEN 1 AND 12),
    year   int NOT NULL,

    -- Замена $or по (month, year) из stats.service.ts:1224. Июль и август → NULL,
    -- то есть автоматически не попадают ни в один учебный год — как и сейчас.
    academic_year int GENERATED ALWAYS AS (
        CASE WHEN month BETWEEN 9 AND 12 THEN year
             WHEN month BETWEEN 1 AND 6  THEN year - 1
        END
    ) STORED,

    legacy_mongo_id text UNIQUE,
    UNIQUE (student_id, exam_id)
);

CREATE TABLE booklets (
    id               bigserial PRIMARY KEY,
    exam_id          bigint NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    district_id      bigint REFERENCES districts(id),
    variant          text   NOT NULL,
    grade            int    NOT NULL,
    disciplines      jsonb  NOT NULL DEFAULT '{}'::jsonb,         -- единственный оправданный JSONB: массивы строк переменной длины (§2.3)
    name             text,
    legacy_mongo_id  text UNIQUE
);


-- ============================================================ исторические рейтинги (бывший ratings[])

-- Четыре таблицы вместо одной полиморфной — ради внешних ключей (§2.2).
-- Хранят ТОЛЬКО историю: за прошедшие годы данные уже не пересчитываются из результатов.
-- Текущий год считают views ниже.

CREATE TABLE student_year_ratings (
    student_id     bigint NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    year           int    NOT NULL,                               -- год НАЧАЛА учебного года (getCurrentAcademicYear)
    score          double precision,
    average_score  double precision,
    place          int,
    district_place int,
    PRIMARY KEY (student_id, year)
);

CREATE TABLE teacher_year_ratings (
    teacher_id     bigint NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    year           int    NOT NULL,
    score          double precision,
    average_score  double precision,
    place          int,
    district_place int,
    PRIMARY KEY (teacher_id, year)
);

CREATE TABLE school_year_ratings (
    school_id      bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    year           int    NOT NULL,
    score          double precision,
    average_score  double precision,
    place          int,
    district_place int,
    PRIMARY KEY (school_id, year)
);

CREATE TABLE district_year_ratings (
    district_id    bigint NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
    year           int    NOT NULL,
    score          double precision,
    average_score  double precision,
    place          int,                                           -- district_place у района отсутствует и в Mongo
    PRIMARY KEY (district_id, year)
);


-- ============================================================ пользователи и служебное

CREATE TABLE users (
    id               bigserial PRIMARY KEY,
    email            text NOT NULL UNIQUE,
    password_hash    text NOT NULL,
    role             text NOT NULL DEFAULT 'student'
                     CHECK (role IN ('superadmin','admin','moderator','districtRepresenter',
                                     'schoolDirector','teacher','student')),
                     -- PHASE3 п.1б добавит 'regionRepresenter' — ALTER ... DROP/ADD CONSTRAINT
    is_approved      boolean NOT NULL DEFAULT false,
    last_login_at    timestamptz,
    district_id      bigint REFERENCES districts(id),
    school_id        bigint REFERENCES schools(id),
    teacher_id       bigint REFERENCES teachers(id),
    student_id       bigint REFERENCES students(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    legacy_mongo_id  text UNIQUE
);

-- Массив refreshTokens[] на документе пользователя → строки. Лимит 5 сессий остаётся в коде.
CREATE TABLE user_refresh_tokens (
    id          bigserial PRIMARY KEY,
    user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       text   NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_settings (
    id                           bigserial PRIMARY KEY,
    -- user_id IS NULL = глобальные настройки колонок (userSettings.controller.ts GLOBAL_SETTINGS_ID='global',
    -- singleton-запись, читаемая всеми ролями и редактируемая admin/superadmin). Найдено на реальных данных 04.08.2026 —
    -- в Mongo это не мусор, а осознанный sentinel, схема должна была это учесть с самого начала.
    user_id                      bigint REFERENCES users(id) ON DELETE CASCADE,
    developing_student_collumns  text[] NOT NULL DEFAULT '{}',    -- орфография поля сохранена намеренно: так его ждёт фронт
    student_collumns             text[] NOT NULL DEFAULT '{}',
    all_student_collumns         text[] NOT NULL DEFAULT '{}',
    all_teacher_collumns         text[] NOT NULL DEFAULT '{}',
    all_school_collumns          text[] NOT NULL DEFAULT '{}',
    all_district_collumns        text[] NOT NULL DEFAULT '{}',
    teacher_view_collumns        text[] NOT NULL DEFAULT '{}',
    director_view_collumns       text[] NOT NULL DEFAULT '{}',
    district_view_collumns       text[] NOT NULL DEFAULT '{}',
    student_view_collumns        text[] NOT NULL DEFAULT '{}',
    role_settings                jsonb  NOT NULL DEFAULT '{}'::jsonb,
    created_at                   timestamptz NOT NULL DEFAULT now(),
    updated_at                   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_settings_user_id_key ON user_settings (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX user_settings_global_singleton ON user_settings ((true)) WHERE user_id IS NULL;

CREATE TABLE grade_promotion_logs (
    id              bigserial PRIMARY KEY,
    academic_year   int  NOT NULL UNIQUE,                         -- UNIQUE — это и есть гарантия «один раз в год»
    status          text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
    promoted_count  int,
    ceiling_count   int,
    executed_by     bigint NOT NULL REFERENCES users(id),
    executed_at     timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz,
    legacy_mongo_id text UNIQUE
);


-- ============================================================ индексы

CREATE INDEX ON schools  (district_id);
CREATE INDEX ON teachers (school_id);
CREATE INDEX ON teachers (district_id);
CREATE INDEX ON students (teacher_id);
CREATE INDEX ON students (school_id);
CREATE INDEX ON students (district_id);
CREATE INDEX ON students (grade);
CREATE INDEX ON student_results (student_id);
CREATE INDEX ON student_results (exam_id);
CREATE INDEX ON student_results (academic_year);
CREATE INDEX ON student_results (exam_id, grade);
CREATE INDEX ON booklets (exam_id);
CREATE INDEX ON user_refresh_tokens (user_id);

-- Поиск по ФИО. Заменяет regex-поиск в student.service.ts buildFilter().
CREATE INDEX students_name_trgm ON students USING gin ((coalesce(last_name,'') || ' ' || first_name) gin_trgm_ops);
CREATE INDEX teachers_name_trgm ON teachers USING gin (fullname gin_trgm_ops);
CREATE INDEX schools_name_trgm  ON schools  USING gin (name gin_trgm_ops);


-- ============================================================ VIEWS: цепочка рейтинга
--
-- Воспроизводят StatsService.updateAllStats() (stats.service.ts:355-373) — «иерархический» путь:
--   ученик ← результаты; учитель ← ученики; школа ← учителя; район ← школы.
--
-- В коде есть ВТОРОЙ, несовместимый путь расчёта (updateEntityStats + updateEntityPlaces,
-- вызывается из district/school/teacher.service.ts). Он пишет те же поля иначе.
-- Что именно расходится и почему это надо решить ДО переключения — см. db/rating-semantics.md.
-- Эти views реализуют первый путь. Второй сознательно не реализован.

-- Ученик: суммы за учебный год. stats.service.ts:1216 updateStudentScores
CREATE VIEW v_student_year_scores AS
SELECT sr.student_id,
       sr.academic_year,
       count(*)::int                                                    AS participation_count,
       sum(coalesce(sr.participation_score, 0))                         AS participation_score,
       sum(coalesce(sr.development_score, 0))                           AS development_score,
       sum(coalesce(sr.student_of_the_month_score, 0))                  AS student_of_the_month_score,
       sum(coalesce(sr.republic_wide_student_of_the_month_score, 0))    AS republic_wide_student_of_the_month_score,
       sum(coalesce(sr.participation_score, 0)
         + coalesce(sr.development_score, 0)
         + coalesce(sr.student_of_the_month_score, 0)
         + coalesce(sr.republic_wide_student_of_the_month_score, 0))    AS score,
       CASE WHEN count(*) > 0
            THEN sum(coalesce(sr.participation_score, 0)
                   + coalesce(sr.development_score, 0)
                   + coalesce(sr.student_of_the_month_score, 0)
                   + coalesce(sr.republic_wide_student_of_the_month_score, 0)) / count(*)
            ELSE 0 END                                                  AS average_score
FROM student_results sr
WHERE sr.academic_year IS NOT NULL
GROUP BY sr.student_id, sr.academic_year;

-- Ученик: места. stats.service.ts:1312 updateStudentPlaces
-- Ранг по score (НЕ по average_score), внутри класса; district_place — внутри класса и района.
-- Фильтра «> 0» здесь нет: у ученика с нулём место есть. Это отличает учеников от остальных уровней.
CREATE VIEW v_student_places AS
SELECT sc.student_id,
       sc.academic_year,
       dense_rank() OVER (PARTITION BY sc.academic_year, s.grade
                          ORDER BY sc.score DESC)                AS place,
       dense_rank() OVER (PARTITION BY sc.academic_year, s.grade, s.district_id
                          ORDER BY sc.score DESC)                AS district_place
FROM v_student_year_scores sc
JOIN students s ON s.id = sc.student_id;

-- Учитель: сумма баллов его учеников, делённая на СОХРАНЁННЫЙ student_count.
-- stats.service.ts:1403. Делить на count(s.id) было бы «правильнее», но это другие цифры
-- у всех учителей сразу — менять только по решению заказчика (MONGO_TO_POSTGRES.md §3.4).
-- Учителя без набравших баллы учеников строки не имеют — в API подставлять 0 через coalesce.
CREATE VIEW v_teacher_year_scores AS
SELECT t.id AS teacher_id,
       sc.academic_year,
       sum(sc.score) AS score,
       CASE WHEN t.student_count > 0 THEN sum(sc.score) / t.student_count ELSE 0 END AS average_score
FROM teachers t
JOIN students s               ON s.teacher_id = t.id
JOIN v_student_year_scores sc ON sc.student_id = s.id
GROUP BY t.id, t.student_count, sc.academic_year;

-- Учитель: места. Решение заказчика 04.08.2026 (гейт 2, db/rating-semantics.md) — официальный
-- путь расчёта мест для учителей/школ/районов: путь B (utils/ranking.util.ts updateEntityPlaces) —
-- ранжирование по average_score, entities с average_score = 0 в ранжировании не участвуют
-- (получают place = NULL, а не место в хвосте) и district_place этот путь не считает вовсе —
-- столбец оставлен для единообразия формата API, всегда NULL.
CREATE VIEW v_teacher_places AS
SELECT ts.teacher_id,
       ts.academic_year,
       dense_rank() OVER (PARTITION BY ts.academic_year ORDER BY ts.average_score DESC) AS place,
       NULL::bigint AS district_place
FROM v_teacher_year_scores ts
WHERE ts.average_score > 0;

-- Школа: сумма баллов её учителей / сохранённый student_count школы. stats.service.ts:1556
CREATE VIEW v_school_year_scores AS
SELECT sch.id AS school_id,
       ts.academic_year,
       sum(ts.score) AS score,
       CASE WHEN sch.student_count > 0 THEN sum(ts.score) / sch.student_count ELSE 0 END AS average_score
FROM schools sch
JOIN teachers t                ON t.school_id = sch.id
JOIN v_teacher_year_scores ts  ON ts.teacher_id = t.id
GROUP BY sch.id, sch.student_count, ts.academic_year;

-- Школа: места. Путь B — та же логика, что и у учителя (см. комментарий у v_teacher_places).
CREATE VIEW v_school_places AS
SELECT ss.school_id,
       ss.academic_year,
       dense_rank() OVER (PARTITION BY ss.academic_year ORDER BY ss.average_score DESC) AS place,
       NULL::bigint AS district_place
FROM v_school_year_scores ss
WHERE ss.average_score > 0;

-- Район: сумма баллов его школ. stats.service.ts:1723
--
-- ⚠️ Делитель воспроизводит текущее поведение ДОСЛОВНО, включая ошибку.
-- В Mongo пайплайн идёт по школам, для каждой школы делает lookup ВСЕХ учеников района
-- и суммирует размеры — то есть делитель равен (учеников в районе × школ в районе),
-- а не числу учеников. Средний балл районов из-за этого занижен в «число школ» раз.
-- Места районов от этого не зависят (они по score), но цифра average_score показывается в UI.
-- Правильный вариант — деление на students_in_district — ниже закомментирован.
-- НЕ подменять молча: это решение заказчика, см. db/rating-semantics.md.
CREATE VIEW v_district_year_scores AS
SELECT d.id AS district_id,
       ss.academic_year,
       sum(ss.score) AS score,
       CASE WHEN cnt.legacy_divisor > 0 THEN sum(ss.score) / cnt.legacy_divisor ELSE 0 END AS average_score
       -- корректный вариант:
       -- CASE WHEN cnt.students_in_district > 0 THEN sum(ss.score) / cnt.students_in_district ELSE 0 END
FROM districts d
JOIN schools sch              ON sch.district_id = d.id
JOIN v_school_year_scores ss  ON ss.school_id = sch.id
CROSS JOIN LATERAL (
    SELECT st.students_in_district,
           sc2.schools_in_district,
           st.students_in_district * sc2.schools_in_district AS legacy_divisor
    FROM (SELECT count(*) AS students_in_district FROM students  WHERE district_id = d.id) st,
         (SELECT count(*) AS schools_in_district  FROM schools   WHERE district_id = d.id) sc2
) cnt
GROUP BY d.id, ss.academic_year, cnt.legacy_divisor, cnt.students_in_district;

-- Район: места. Путь B, та же логика. district_place у района не существовал ни в одном из путей.
CREATE VIEW v_district_places AS
SELECT ds.district_id,
       ds.academic_year,
       dense_rank() OVER (PARTITION BY ds.academic_year ORDER BY ds.average_score DESC) AS place
FROM v_district_year_scores ds
WHERE ds.average_score > 0;

COMMIT;
