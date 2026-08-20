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

CREATE TABLE regions (
    id                       bigserial PRIMARY KEY,
    code                     bigint  NOT NULL UNIQUE,   -- 2 знака, собственное кодовое пространство (10-21)
    name                     text    NOT NULL,
    region_of_the_year_score double precision DEFAULT 0,
    active                   boolean NOT NULL DEFAULT true,
    avatar_url               text
    -- student_count намеренно НЕ хранится: делитель среднего балла и колонка UI считаются
    -- одним живым count(students), чтобы не рассинхронизироваться (см. db/migrations/005_regions.sql)
);

CREATE TABLE districts (
    id                          bigserial PRIMARY KEY,
    code                        bigint  NOT NULL UNIQUE,          -- 3 знака
    name                        text    NOT NULL,
    region_id                   bigint  NOT NULL REFERENCES regions(id), -- PHASE3 п.1б (005_regions.sql), обязательно с 006_district_region_required.sql
    student_count               int,
    rate                        double precision,
    district_of_the_year_score  double precision DEFAULT 0,
    active                      boolean NOT NULL DEFAULT true,
    avatar_url                  text,
    education_head_name         text,   -- профиль района (012_profile_fields.sql)
    legacy_mongo_id             text UNIQUE
);

CREATE TABLE schools (
    id                        bigserial PRIMARY KEY,
    code                      bigint  NOT NULL UNIQUE,            -- 5 знаков = district*100 + nn
    name                      text    NOT NULL,
    address                   text,
    description               text,   -- профиль школы (010_school_teacher_profile_text_fields.sql)
    history                   text,   -- профиль школы, то же
    director_name             text,   -- профиль школы (012_profile_fields.sql)
    founded_year              int CHECK (founded_year BETWEEN 1800 AND 2100),   -- профиль школы, то же
    achievements              text,   -- профиль школы, то же
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
    biography                  text,   -- профиль учителя (010_school_teacher_profile_text_fields.sql)
    pedagogical_start_year     int CHECK (pedagogical_start_year BETWEEN 1950 AND 2100),   -- профиль учителя (012_profile_fields.sql)
    achievements               text,   -- профиль учителя, то же
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


-- ============================================================ справочники

-- Справочник уровней — заменяет 4 дубля хардкода (calculateLevel, calculateLevelNumb,
-- ParticipationScoreMap, SQL CASE в stats/examResults), см. db/migrations/001_levels_lookup.sql.
-- 6 строк, кэшируется в памяти при старте (services/levels.cache.ts).
CREATE TABLE levels (
    code                text PRIMARY KEY,              -- 'E','D','C','B','A','Lisey'
    name_az             text NOT NULL,
    rank                int  NOT NULL UNIQUE,           -- 1..6, порядок силы уровня
    participation_score double precision NOT NULL,
    min_total_score     int  NOT NULL,                  -- нижняя граница total_score включительно
    max_total_score     int,                             -- верхняя граница включительно, NULL = без предела
    active              boolean NOT NULL DEFAULT true
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
    level        text             NOT NULL REFERENCES levels(code), -- E/D/C/B/A/Lisey, см. таблицу levels
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

-- Справочник предметов — единственный дом понятия "предмет", которое иначе размазано по
-- колонкам student_results, ключам booklets.disciplines и позициям в Excel-парсере.
-- Хранение колонками НЕ меняется (осознанное решение заказчика) — это только метаданные +
-- read-only view. См. db/migrations/002_subjects_lookup.sql.
CREATE TABLE subjects (
    code          text PRIMARY KEY,          -- 'az','math','lifeKnowledge','logic','english'
    name_az       text NOT NULL,
    result_column text NOT NULL,              -- имя колонки балла в student_results
    count_column  text NOT NULL,              -- имя колонки количества вопросов
    min_grade     int,                        -- с какого класса применяется, NULL = без ограничения снизу
    max_grade     int,                        -- по какой класс, NULL = без ограничения сверху
    sort_order    int  NOT NULL,
    active        boolean NOT NULL DEFAULT true
);

-- "Развёрнутая" в строки версия колонок student_results — read-only, хранение не меняет.
-- lifeKnowledge/logic/english фильтруются по границе классов из subjects, а не по
-- "колонка не NULL": в проде есть исторический артефакт (~6480 строк) с english=0 в 1-4
-- классах вместо NULL, который иначе попал бы в любой AVG по предмету как реальная попытка.
CREATE VIEW v_student_result_subject_scores AS
SELECT sr.id AS result_id, sr.student_id, sr.exam_id, sr.grade, sr.academic_year,
       'az'::text AS subject_code, sr.az AS score, sr.az_count AS question_count
FROM student_results sr
UNION ALL
SELECT sr.id, sr.student_id, sr.exam_id, sr.grade, sr.academic_year,
       'math', sr.math, sr.math_count
FROM student_results sr
UNION ALL
SELECT sr.id, sr.student_id, sr.exam_id, sr.grade, sr.academic_year,
       'lifeKnowledge', sr.life_knowledge, sr.life_knowledge_count
FROM student_results sr
JOIN subjects s ON s.code = 'lifeKnowledge'
WHERE (s.min_grade IS NULL OR sr.grade >= s.min_grade)
  AND (s.max_grade IS NULL OR sr.grade <= s.max_grade)
UNION ALL
SELECT sr.id, sr.student_id, sr.exam_id, sr.grade, sr.academic_year,
       'logic', sr.logic, sr.logic_count
FROM student_results sr
JOIN subjects s ON s.code = 'logic'
WHERE (s.min_grade IS NULL OR sr.grade >= s.min_grade)
  AND (s.max_grade IS NULL OR sr.grade <= s.max_grade)
UNION ALL
SELECT sr.id, sr.student_id, sr.exam_id, sr.grade, sr.academic_year,
       'english', sr.english, sr.english_count
FROM student_results sr
JOIN subjects s ON s.code = 'english'
WHERE (s.min_grade IS NULL OR sr.grade >= s.min_grade)
  AND (s.max_grade IS NULL OR sr.grade <= s.max_grade);

-- Защита ключей booklets.disciplines от посторонних кодов предметов (CHECK не может
-- ссылаться на другую таблицу).
CREATE FUNCTION validate_booklet_disciplines_keys() RETURNS trigger AS $$
DECLARE
    bad_key text;
BEGIN
    SELECT key INTO bad_key
    FROM jsonb_object_keys(NEW.disciplines) AS key
    WHERE key NOT IN (SELECT code FROM subjects)
    LIMIT 1;

    IF bad_key IS NOT NULL THEN
        RAISE EXCEPTION 'booklets.disciplines: неизвестный код предмета "%"', bad_key;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booklets_validate_disciplines_keys
    BEFORE INSERT OR UPDATE ON booklets
    FOR EACH ROW EXECUTE FUNCTION validate_booklet_disciplines_keys();


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

CREATE TABLE region_year_ratings (
    region_id      bigint NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    year           int    NOT NULL,
    score          double precision,
    average_score  double precision,
    place          int,                                           -- district_place у региона тоже отсутствует
    PRIMARY KEY (region_id, year)
);


-- ============================================================ пользователи и служебное

CREATE TABLE users (
    id               bigserial PRIMARY KEY,
    email            text NOT NULL UNIQUE,
    password_hash    text NOT NULL,
    role             text NOT NULL DEFAULT 'student'
                     CHECK (role IN ('superadmin','admin','moderator','districtRepresenter',
                                     'schoolDirector','teacher','student','regionRepresenter')),
    is_approved      boolean NOT NULL DEFAULT false,
    last_login_at    timestamptz,
    region_id        bigint REFERENCES regions(id),
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
    all_region_collumns          text[] NOT NULL DEFAULT '{}',
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

-- Журнал каскадных перекодировок (PHASE3 п.4, миграция 004): смена teacher.code/school.code
-- перезаписывает коды потомков, а не только связи. caused_by_* = NULL — прямая правка (корень
-- каскада); заполнено — эта строка изменилась потому, что изменился родитель.
CREATE TABLE code_change_logs (
    id                     bigserial    PRIMARY KEY,
    entity_type            text         NOT NULL CHECK (entity_type IN ('teacher','school','student')),
    entity_id              bigint       NOT NULL,
    old_code                bigint      NOT NULL,
    new_code                bigint      NOT NULL,
    caused_by_entity_type   text        CHECK (caused_by_entity_type IN ('teacher','school')),
    caused_by_entity_id     bigint,
    changed_by              bigint      NOT NULL REFERENCES users(id),
    changed_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX code_change_logs_entity_idx ON code_change_logs (entity_type, entity_id);
CREATE INDEX code_change_logs_changed_at_idx ON code_change_logs (changed_at);

-- Трекинг для db/migrations/apply-pending.sh (автоприменение на CI/CD, см. migrations/README.md).
-- На свежей БД, поднятой из этого файла, остаётся пустой — она уже включает миграции 001-004,
-- бутстрап-список апскрипта сюда не относится (тот привязан к конкретному прод-серверу).
CREATE TABLE schema_migrations (
    filename    text        PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
);


-- ============================================================ сертификаты (011_certificates.sql)

-- Шаблон = картинка + раскладка полей (координаты в px картинки), редактируется визуальным
-- конструктором в админке. image_path иммутабелен (имя = sha1 содержимого) — на него
-- ссылаются уже выданные сертификаты через свою собственную копию пути, см. ниже.
CREATE TABLE certificate_templates (
    id           bigserial PRIMARY KEY,
    award_code   text NOT NULL,                 -- 'developing_student' и далее
    level_code   text REFERENCES levels(code),  -- NULL, если награда не зависит от пилли
    name         text NOT NULL,
    image_path   text NOT NULL,
    image_width  int  NOT NULL,
    image_height int  NOT NULL,
    fields       jsonb NOT NULL DEFAULT '[]'::jsonb,
    active       boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX certificate_templates_award_level_uq
    ON certificate_templates (award_code, coalesce(level_code, ''));

CREATE SEQUENCE certificate_serial_seq;

-- Снапшот на момент выдачи: школа/учитель в схеме не историчны, статистику пересчитывают
-- задним числом — без копии данных/раскладки повторное скачивание давало бы другой документ.
CREATE TABLE issued_certificates (
    id                bigserial PRIMARY KEY,
    serial            text NOT NULL UNIQUE,    -- ISIM-2026-000123, печатается на сертификате
    verify_token      text NOT NULL UNIQUE,    -- неугадываемый, для публичной проверки по QR
    student_result_id bigint NOT NULL REFERENCES student_results(id) ON DELETE CASCADE,
    award_code        text NOT NULL,
    template_id       bigint NOT NULL REFERENCES certificate_templates(id),
    image_path        text  NOT NULL,
    image_width       int   NOT NULL,
    image_height      int   NOT NULL,
    layout            jsonb NOT NULL,
    data              jsonb NOT NULL,
    issued_at         timestamptz NOT NULL DEFAULT now(),
    revoked_at        timestamptz,
    revoke_reason     text,
    UNIQUE (student_result_id, award_code)
);


-- ============================================================ индексы

CREATE INDEX ON districts (region_id);
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
CREATE INDEX issued_certificates_result_idx ON issued_certificates (student_result_id);

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
-- grade в выдаче — исторический класс на момент результатов (student_results.grade), а не
-- живой students.grade: один и тот же для всех результатов ученика внутри одного academic_year
-- (класс меняется раз в год, на повышении), поэтому GROUP BY им не размножает строки.
-- См. 008_student_ranking_uses_historical_grade.sql — почему это важно для v_student_places.
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
            ELSE 0 END                                                  AS average_score,
       sr.grade                                                         AS grade
FROM student_results sr
WHERE sr.academic_year IS NOT NULL
GROUP BY sr.student_id, sr.academic_year, sr.grade;

-- Ученик: места. stats.service.ts:1312 updateStudentPlaces
-- Ранг по score (НЕ по average_score), внутри класса; district_place — внутри класса и района.
-- Фильтра «> 0» здесь нет: у ученика с нулём место есть. Это отличает учеников от остальных уровней.
-- ВАЖНО: класс берётся из v_student_year_scores.grade (исторический, student_results.grade),
-- а не из живого students.grade — иначе массовое повышение класса (Yeni tədris ili) задним
-- числом ломает уже посчитанные места за прошедший учебный год (найдено и исправлено 14.08.2026,
-- 008_student_ranking_uses_historical_grade.sql). students всё ещё нужен — для district_id.
CREATE VIEW v_student_places AS
SELECT sc.student_id,
       sc.academic_year,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.grade
                          ORDER BY sc.score DESC)                AS place,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.grade, s.district_id
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

-- Учитель: места. Решение заказчика 04.08.2026 (гейт 2, db/rating-semantics.md) заменено
-- решением 20.08.2026: заказчик имел в виду места по СЫРОМУ score (как у учеников), а не по
-- среднему — «путь B по average_score» было неверным пониманием требования. Ранжирование —
-- по score, entities с score = 0 в ранжировании не участвуют (получают place = NULL, а не
-- место в хвосте — это отдельное, не пересмотренное сейчас решение). district_place —
-- та же dense_rank-логика, что и у учеников (v_student_places), просто без grade в PARTITION BY.
-- См. 013_ratings_by_raw_score.sql.
CREATE VIEW v_teacher_places AS
SELECT ts.teacher_id,
       ts.academic_year,
       dense_rank() OVER (PARTITION BY ts.academic_year ORDER BY ts.score DESC) AS place,
       dense_rank() OVER (PARTITION BY ts.academic_year, t.district_id ORDER BY ts.score DESC) AS district_place
FROM v_teacher_year_scores ts
JOIN teachers t ON t.id = ts.teacher_id
WHERE ts.score > 0;

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

-- Школа: места. По score — та же логика, что и у учителя (см. комментарий у v_teacher_places).
-- См. 013_ratings_by_raw_score.sql.
CREATE VIEW v_school_places AS
SELECT ss.school_id,
       ss.academic_year,
       dense_rank() OVER (PARTITION BY ss.academic_year ORDER BY ss.score DESC) AS place,
       dense_rank() OVER (PARTITION BY ss.academic_year, sc.district_id ORDER BY ss.score DESC) AS district_place
FROM v_school_year_scores ss
JOIN schools sc ON sc.id = ss.school_id
WHERE ss.score > 0;

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

-- Район: места. По score, та же логика. district_place у района не существовал ни в одном из путей.
-- См. 013_ratings_by_raw_score.sql.
CREATE VIEW v_district_places AS
SELECT ds.district_id,
       ds.academic_year,
       dense_rank() OVER (PARTITION BY ds.academic_year ORDER BY ds.score DESC) AS place
FROM v_district_year_scores ds
WHERE ds.score > 0;

-- Регион (PHASE3 п.1б, 005_regions.sql): сумма баллов его районов. Делитель — ЖИВОЕ число
-- учеников региона, а не денормализованное поле — решение пользователя 08.08.2026.
-- Легаси-ошибка делителя из v_district_year_scores (ученики_района × школы_района) сюда
-- СОЗНАТЕЛЬНО не переносится: это отдельная сущность, не обязана повторять баг района.
-- Пока район не привязан ни к одному региону (region_id IS NULL) — регион просто не
-- получает строки, это корректное поведение, а не пробел.
CREATE VIEW v_region_year_scores AS
SELECT r.id AS region_id,
       ds.academic_year,
       sum(ds.score) AS score,
       CASE WHEN cnt.students_in_region > 0
            THEN sum(ds.score) / cnt.students_in_region ELSE 0 END AS average_score,
       cnt.students_in_region
FROM regions r
JOIN districts d               ON d.region_id = r.id
JOIN v_district_year_scores ds ON ds.district_id = d.id
CROSS JOIN LATERAL (
    SELECT count(*) AS students_in_region
    FROM students st
    JOIN districts d2 ON d2.id = st.district_id
    WHERE d2.region_id = r.id
) cnt
GROUP BY r.id, ds.academic_year, cnt.students_in_region;

-- Регион: места. По score — та же логика, что и у района/школы/учителя. См. 013_ratings_by_raw_score.sql.
CREATE VIEW v_region_places AS
SELECT rs.region_id,
       rs.academic_year,
       dense_rank() OVER (PARTITION BY rs.academic_year ORDER BY rs.score DESC) AS place
FROM v_region_year_scores rs
WHERE rs.score > 0;

COMMIT;
