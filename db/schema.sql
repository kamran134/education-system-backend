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
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- EXCLUDE USING gist ниже (level_scale_bands, exam_type_sections)

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
    pedagogical_start_year     int CHECK (pedagogical_start_year BETWEEN 1950 AND 2100),   -- профиль учителя (012_profile_fields.sql). Из UI и всех чтений убран (016), но сам не удалён — вдруг пригодится.
    achievements               text,   -- профиль учителя, то же
    school_id                  bigint  REFERENCES schools(id),    -- NULL допустим: в проде 2 учителя без школы
    district_id                bigint  REFERENCES districts(id),
    student_count              int,                               -- ВАЖНО: именно на него делится average_score (см. views)
    status                     text,
    teacher_of_the_year_score  double precision DEFAULT 0,
    active                     boolean NOT NULL DEFAULT true,
    avatar_url                 text,
    legacy_mongo_id            text UNIQUE,
    grade_label                text CHECK (grade_label IS NULL OR char_length(btrim(grade_label)) BETWEEN 1 AND 40),  -- 014_teacher_grade_label.sql
    pedagogical_experience_years int CHECK (pedagogical_experience_years IS NULL OR pedagogical_experience_years BETWEEN 0 AND 70)  -- 016_teacher_pedagogical_experience.sql: стаж вводится числом лет, не годом начала (работал не непрерывно)
);

-- last_name/first_name/middle_name (легаси, вытеснены fullname в 025b_student_fullname.sql,
-- SAGIRD_FULLNAME_TASK.md) и max_level (перестал влиять на любое решение после
-- IMTAHAN_NOVLERI_TASK.md §15 — maxPriorBandRank считает "прошлый максимум" из student_results,
-- а не из lifetime-колонки без разбивки по типу экзамена) удалены
-- 026_drop_legacy_subject_columns.sql (§20).
CREATE TABLE students (
    id               bigserial PRIMARY KEY,
    code             bigint  NOT NULL UNIQUE,                     -- 10 знаков = teacher*1000 + nnn. bigint обязателен: не влезает в int4
    fullname         text    NOT NULL,                            -- "Soyad Ad Ata adı", как у teachers.fullname
    grade            int,
    teacher_id       bigint  REFERENCES teachers(id),
    school_id        bigint  REFERENCES schools(id),
    district_id      bigint  REFERENCES districts(id),
    status           text,
    avatar_url       text,
    gender           text CHECK (gender IN ('m', 'f')),          -- 033_student_gender.sql; NULL = unknown (boy certificate)
    legacy_mongo_id  text UNIQUE
    -- UNIQUE(code) — то, чего нет в Mongo. В проде 2 группы дублей (аудит 25.07.2026),
    -- ETL на них упадёт. Это гейт, а не баг: заказчик решает, кому менять код.
);

-- ============================================================ типы экзаменов и шкалы pillə (023_exam_types_and_level_scales.sql)
--
-- Идут раньше exams, потому что exams.exam_type_id на них ссылается (порядок CREATE TABLE
-- в этом файле = порядок физической зависимости FK, без ALTER TABLE постфактум).
--
-- level_scale_bands — набор процентных диапазонов E/D/C/B/A/Lisey. Таблица, а не константа,
-- чтобы проценты правились и уровни добавлялись без миграции. Диапазоны — ПОЛУИНТЕРВАЛЫ
-- [min_percent, max_percent): иначе дробный процент (29.5%) не попадает ни в один бэнд.
-- Верхний бэнд закрывает 100 включительно (max_percent = 100.001 у Lisey).
CREATE TABLE level_scales (
    id      bigserial PRIMARY KEY,
    code    text NOT NULL UNIQUE,
    name_az text NOT NULL,
    note    text,
    active  boolean NOT NULL DEFAULT true
);

CREATE TABLE level_scale_bands (
    id                  bigserial PRIMARY KEY,
    scale_id            bigint NOT NULL REFERENCES level_scales(id) ON DELETE CASCADE,
    code                text   NOT NULL,
    name_az             text   NOT NULL,
    rank                int    NOT NULL,
    participation_score double precision NOT NULL,
    min_percent         numeric(6,3) NOT NULL,
    max_percent         numeric(6,3) NOT NULL,
    UNIQUE (scale_id, code),
    UNIQUE (scale_id, rank),
    CHECK (min_percent >= 0 AND max_percent <= 100.001 AND min_percent < max_percent),
    EXCLUDE USING gist (scale_id WITH =, numrange(min_percent, max_percent) WITH &&)
);

-- exam_types — то, по чему считается отдельный рейтинг. Все нынешние экзамены — один тип,
-- is_base = true (единственный тип с этим флагом, см. exam_types_single_base ниже).
-- has_question_counts убрана 025d_question_counts_from_file.sql (IMTAHAN_NOVLERI_TASK.md §16):
-- колонка "(sual sayı)" в шаблоне Excel теперь генерируется всегда, для любого типа.
CREATE TABLE exam_types (
    id                   bigserial PRIMARY KEY,
    code                 text    NOT NULL UNIQUE,
    name_az              text    NOT NULL,
    level_scale_id       bigint  NOT NULL REFERENCES level_scales(id),
    month_award_min_rank int,          -- NULL = награда месяца не зависит от pillə
    is_base              boolean NOT NULL DEFAULT false,
    active               boolean NOT NULL DEFAULT true,
    sort_order           int     NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX exam_types_single_base ON exam_types (is_base) WHERE is_base;

-- exam_type_sections — группа классов внутри типа со своим набором предметов. У базового
-- типа две: "1-4 sinif" и "5-11 sinif". exam_type_section_subjects (набор предметов секции,
-- FK на subjects) идёт ниже, после того как subjects определена в файле.
CREATE TABLE exam_type_sections (
    id           bigserial PRIMARY KEY,
    exam_type_id bigint NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
    name_az      text   NOT NULL,
    grade_from   int    NOT NULL,
    grade_to     int    NOT NULL,
    -- 040_exam_type_section_years_and_order.sql: учебные годы действия секции (включительно, NULL = без
    -- границы) и порядок в редакторе. Секцию с результатами прошлых лет не меняют, а архивируют
    -- (to_year = текущий - 1) и создают новую с текущего года — examType.service.pg.ts::upsertSections.
    from_year    int,
    to_year      int,
    sort_order   int    NOT NULL DEFAULT 0,
    CHECK (grade_from <= grade_to),
    CONSTRAINT exam_type_sections_years_check CHECK (from_year IS NULL OR to_year IS NULL OR from_year <= to_year),
    -- grade_to + 1: секция трактует свой диапазон классов как ВКЛЮЧАЮЩИЙ (grade_from..grade_to),
    -- а int4range сам по себе полуоткрытый — без +1 секции "1-4 sinif" (grade_to=4) и
    -- "5-11 sinif" (grade_from=5) не считались бы корректно соседствующими на границе класса 4/5.
    -- Классы не пересекаются в пределах одного учебного года; NULL-границы лет = бесконечность.
    CONSTRAINT exam_type_sections_grades_years_excl EXCLUDE USING gist (
        exam_type_id WITH =,
        int4range(grade_from, grade_to + 1) WITH &&,
        int4range(from_year, to_year + 1) WITH &&
    )
);

-- code (трёхзначное собственное пространство номеров, никак не связанное с иерархией
-- район→школа→учитель→ученик в utils/entity-codes.const.ts) удалён миграцией
-- 025c_drop_exam_code.sql (IMTAHAN_KODU_TASK.md) — заказчику код экзамена не нужен.
-- UNIQUE (name, date) занял место прежней защиты от дублей, которую держал code.
CREATE TABLE exams (
    id               bigserial PRIMARY KEY,
    name             text        NOT NULL,
    date             timestamptz NOT NULL,
    active           boolean     NOT NULL DEFAULT true,
    exam_type_id     bigint      NOT NULL REFERENCES exam_types(id),  -- 023_exam_types_and_level_scales.sql
    legacy_mongo_id  text UNIQUE,
    CONSTRAINT exams_name_date_key UNIQUE (name, date)
    -- PHASE3 п.5 добавит include_in_rating boolean NOT NULL DEFAULT true — отдельной миграцией,
    -- вместе с правкой v_student_year_scores (JOIN exams ... WHERE include_in_rating).
);


-- ============================================================ справочники

-- levels (справочник уровней 001_levels_lookup.sql) снесена 026_drop_legacy_subject_columns.sql
-- (IMTAHAN_NOVLERI_TASK.md §20) — заменена level_scales/level_scale_bands выше (023).


-- ============================================================ результаты

-- Пять колонок предметов (az/math/life_knowledge/logic/english) и их *_count — ЛЕГАСИ,
-- заменены строками student_result_subject_scores ниже (024_student_result_subject_scores.sql,
-- произвольный набор предметов вместо пяти фиксированных колонок), удалены
-- 026_drop_legacy_subject_columns.sql (IMTAHAN_NOVLERI_TASK.md §20) после сверки сумм.
CREATE TABLE student_results (
    id          bigserial PRIMARY KEY,
    student_id  bigint NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    exam_id     bigint REFERENCES exams(id),                      -- в Mongo required:false, оставлено nullable
    grade       int    NOT NULL,

    total_score  double precision NOT NULL,
    score        double precision NOT NULL,
    level        text             NOT NULL,   -- E/D/C/B/A/Lisey — код бэнда шкалы level_scale_id, см. FK ниже
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

    -- Колонки типа экзамена (024_student_result_subject_scores.sql, IMTAHAN_NOVLERI_TASK.md §4).
    -- exam_type_id NOT NULL: по нему партиционируются все рейтинги и месячные награды (025),
    -- NULL там означал бы не «неизвестный тип», а результат, молча выпавший из всех рейтингов.
    -- level_scale_id NOT NULL: композитный FK ниже работает по MATCH SIMPLE, и NULL в этой
    -- колонке отключил бы проверку level целиком — тише, чем прежний student_results_level_fkey.
    -- section_id намеренно остаётся nullable: класс вне диапазонов секций (например, grade
    -- вне 1..11) — законное состояние, а не ошибка.
    exam_type_id    bigint NOT NULL REFERENCES exam_types(id),
    section_id      bigint REFERENCES exam_type_sections(id),
    level_scale_id  bigint NOT NULL REFERENCES level_scales(id),
    max_questions   int,              -- знаменатель score_percent, справочно для истории (§3 ТЗ)
    score_percent   numeric(6,3),     -- справочный, NULL допустим у замороженной истории (§2 ТЗ)

    -- Снимок на момент записи результата (038_result_snapshot.sql, TRANSFERS_TASK.md): учитель ученика, школа этого
    -- учителя, район этой школы. Рейтинги учителей/школ/районов агрегируют по снимку, а не по текущим связям, поэтому
    -- переход учителя/ученика не уносит прошлые баллы. Заполняет триггер student_results_snapshot (ниже).
    teacher_id   bigint REFERENCES teachers(id)  ON DELETE SET NULL,
    school_id    bigint REFERENCES schools(id)   ON DELETE SET NULL,
    district_id  bigint REFERENCES districts(id) ON DELETE SET NULL,

    legacy_mongo_id text UNIQUE,
    UNIQUE (student_id, exam_id),
    -- Композитный FK вместо простого level -> levels(code) (снят в 024, levels снесена в 026):
    -- коды pillə у разных шкал разных типов экзаменов могут совпасть при разном смысле,
    -- level_scale_id снимает неоднозначность.
    CONSTRAINT student_results_level_band_fkey
        FOREIGN KEY (level_scale_id, level) REFERENCES level_scale_bands (scale_id, code)
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

-- Справочник предметов — единственный дом понятия "предмет". Баллы по предметам хранятся
-- строками в student_result_subject_scores ниже (024_student_result_subject_scores.sql) —
-- subjects сам по себе чистый справочник кодов, использующийся набором предметов секций типов
-- экзаменов (exam_type_section_subjects ниже). См. db/migrations/002_subjects_lookup.sql
-- (создание) и 023_exam_types_and_level_scales.sql (result_column/count_column/min_grade/
-- max_grade убраны — они описывали колонки student_results, а не сам предмет).
CREATE TABLE subjects (
    code          text PRIMARY KEY,          -- 'az','math','lifeKnowledge','logic','english'
    name_az       text NOT NULL,
    sort_order    int  NOT NULL,
    active        boolean NOT NULL DEFAULT true
);

-- Набор предметов секции типа экзамена (023_exam_types_and_level_scales.sql). С
-- 025d_question_counts_from_file.sql (IMTAHAN_NOVLERI_TASK.md §16) задаёт ТОЛЬКО состав
-- предметов — max_questions отсюда убран: число вопросов по предмету свойство конкретной
-- работы, а не типа экзамена, читается построчно из student_result_subject_scores.question_count
-- (см. studentResult.service.pg.ts::computeScoreSummary). Секция "5-11 sinif" базового типа
-- сеялась пустой в 023 (§3 того ТЗ), досеяна az/math/english миграцией 025d.
CREATE TABLE exam_type_section_subjects (
    section_id    bigint NOT NULL REFERENCES exam_type_sections(id) ON DELETE CASCADE,
    subject_code  text   NOT NULL REFERENCES subjects(code),
    sort_order    int    NOT NULL DEFAULT 0,
    PRIMARY KEY (section_id, subject_code)
);

-- Баллы по предметам, по строке на (результат, предмет) — заменяет пять фиксированных колонок
-- student_results.az/math/life_knowledge/logic/english (024_student_result_subject_scores.sql,
-- IMTAHAN_NOVLERI_TASK.md §4). Произвольный набор предметов на тип экзамена — то, ради чего
-- всё затевалось: колонками такое не выразить. question_count nullable в схеме (историю не
-- переоцениваем и не блокируем), но с 025d (§16) обязателен по факту для НОВЫХ строк —
-- проверяется на уровне приложения (computeScoreSummary/processStudentResultsFromExcel), не
-- CHECK constraint.
CREATE TABLE student_result_subject_scores (
    result_id      bigint NOT NULL REFERENCES student_results(id) ON DELETE CASCADE,
    subject_code   text   NOT NULL REFERENCES subjects(code),
    score          double precision NOT NULL,
    question_count int,
    PRIMARY KEY (result_id, subject_code)
);

-- v_student_result_subject_scores (совместимая вьюха на время переезда с колонок, 024) снесена
-- 026_drop_legacy_subject_columns.sql (IMTAHAN_NOVLERI_TASK.md §20) — читателей не осталось
-- с шага 2.

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
    -- exam_type_id (025_ratings_by_exam_type.sql, IMTAHAN_NOVLERI_TASK.md §4 шаг 3): рейтинги
    -- дробятся по типу экзамена, очки разных типов не смешиваются (§2 ТЗ). Все существовавшие
    -- до этой миграции строки принадлежат базовому типу (backfill).
    exam_type_id   bigint NOT NULL REFERENCES exam_types(id),
    average_place          int,                                    -- 039: place by average_score (within the grade)
    average_district_place int,                                    -- 039
    school_place           int,                                    -- 039: within the grade and the school
    average_school_place   int,                                    -- 039
    PRIMARY KEY (student_id, year, exam_type_id)
);

-- Исторический класс ученика по учебным годам (018_student_grade_history.sql,
-- SINIF_TARIXCESI_TASK.md). students.grade — живое поле, раз в год перезаписывается
-- повышением классов; всё, что показывает класс ученика в разрезе КОНКРЕТНОГО прошедшего
-- учебного года, должно читать эту таблицу, а не students.grade. Пишет её только повышение
-- классов (gradePromotion.service.pg.ts) — снимок уходящего и нового года при каждом запуске;
-- прошлое до введения таблицы восстановлено бэкфиллом из v_student_year_scores.
CREATE TABLE student_grade_history (
    student_id    bigint NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    academic_year int    NOT NULL,   -- год НАЧАЛА учебного года, как везде в схеме
    grade         int    NOT NULL,
    PRIMARY KEY (student_id, academic_year)
);

CREATE TABLE teacher_year_ratings (
    teacher_id     bigint NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    year           int    NOT NULL,
    score          double precision,
    average_score  double precision,
    place          int,
    district_place int,
    exam_type_id   bigint NOT NULL REFERENCES exam_types(id),      -- 025_ratings_by_exam_type.sql
    average_place  int,                                            -- 035: place by average_score
    average_district_place int,                                    -- 035
    school_place   int,                                            -- 039: within the teacher's school
    average_school_place int,                                      -- 039
    PRIMARY KEY (teacher_id, year, exam_type_id)
);

CREATE TABLE school_year_ratings (
    school_id      bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    year           int    NOT NULL,
    score          double precision,
    average_score  double precision,
    place          int,
    district_place int,
    exam_type_id   bigint NOT NULL REFERENCES exam_types(id),      -- 025_ratings_by_exam_type.sql
    average_place  int,                                            -- 035: place by average_score
    average_district_place int,                                    -- 035
    PRIMARY KEY (school_id, year, exam_type_id)
);

CREATE TABLE district_year_ratings (
    district_id    bigint NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
    year           int    NOT NULL,
    score          double precision,
    average_score  double precision,
    place          int,                                           -- district_place у района отсутствует и в Mongo
    exam_type_id   bigint NOT NULL REFERENCES exam_types(id),      -- 025_ratings_by_exam_type.sql
    average_place  int,                                            -- 035: place by average_score
    PRIMARY KEY (district_id, year, exam_type_id)
);

CREATE TABLE region_year_ratings (
    region_id      bigint NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    year           int    NOT NULL,
    score          double precision,
    average_score  double precision,
    place          int,                                           -- district_place у региона тоже отсутствует
    exam_type_id   bigint NOT NULL REFERENCES exam_types(id),      -- 025_ratings_by_exam_type.sql
    average_place  int,                                            -- 039: place by average_score
    PRIMARY KEY (region_id, year, exam_type_id)
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
    last_seen_at     timestamptz,  -- 030: bumped by activity.middleware.ts, max once/min
    region_id       bigint REFERENCES regions(id),
    district_id      bigint REFERENCES districts(id),
    school_id        bigint REFERENCES schools(id),
    teacher_id       bigint REFERENCES teachers(id),
    student_id       bigint REFERENCES students(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    legacy_mongo_id  text UNIQUE
);
-- Вход регистронезависимый (findByEmail ищет по lower(trim(email))), поэтому и уникальность
-- по тому же выражению — иначе 'A@x.com' и 'a@x.com' сосуществуют (миграция 029).
CREATE UNIQUE INDEX users_email_ci_key ON users (lower(trim(email)));

-- Массив refreshTokens[] на документе пользователя → строки. Лимит 5 сессий остаётся в коде.
CREATE TABLE user_refresh_tokens (
    id          bigserial PRIMARY KEY,
    user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       text   NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- 030: one row per successful login (auth.controller.ts::login); empty before 2026-09-30.
CREATE TABLE user_login_events (
    id            bigserial PRIMARY KEY,
    user_id       bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_in_at  timestamptz NOT NULL DEFAULT now(),
    ip            text,
    user_agent    text
);
CREATE INDEX user_login_events_logged_in_at_idx ON user_login_events (logged_in_at);
CREATE INDEX user_login_events_user_id_idx ON user_login_events (user_id, logged_in_at);

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

-- Реестр закрытых учебных годов (015_academic_year_closures.sql, ACADEMIC_YEAR_ARCHIVE_TASK.md §3).
-- closed_by NULL = закрыл не человек, а система 1 сентября (closed_reason = 'auto') — тогда
-- финальный пересчёт НЕ прогоняется (к этому моменту классы уже повышены, живые связи другие,
-- пересчёт сломал бы то, что замораживаем). Ручное закрытие (июнь-июль) прогоняет пересчёт
-- перед заморозкой. checksums — count(*)/sum(score) по каждой из пяти *_year_ratings на
-- момент закрытия, чтобы можно было доказать, что архив не поехал, не имея старого дампа.
CREATE TABLE academic_year_closures (
    academic_year int         PRIMARY KEY,
    closed_at     timestamptz NOT NULL DEFAULT now(),
    closed_by     bigint      REFERENCES users(id),
    closed_reason text        NOT NULL DEFAULT 'manual' CHECK (closed_reason IN ('manual','auto')),
    note          text,
    checksums     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    CHECK (closed_reason = 'auto' OR closed_by IS NOT NULL)
);

-- Универсальная key/value таблица настроек, меняемых админом из UI без релиза
-- (019_app_settings.sql, REYTINQ_ILI_TASK.md). Первый ключ — 'ratings.activated_academic_year',
-- value = {"academicYear": <год>} — ручной тумблер "показывать новый учебный год рейтингов
-- на главных". Отсутствие строки = новый год не активирован.
CREATE TABLE app_settings (
    key        text        PRIMARY KEY,
    value      jsonb       NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by bigint      REFERENCES users(id)
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

-- Модерация самостоятельно введённых полей профиля (017_profile_change_requests.sql,
-- BASE_FIXES_TASK.md §2.4; entity_type 'student' добавлен 020_student_profile_change_requests.sql,
-- п.3 ТЗ 04.09.2026). Полиморфная связь без FK на саму сущность — при удалении
-- школы/учителя/района/ученика заявку подчищает код удаления сущности. Уникальный индекс держит
-- ровно одну необработанную заявку на сущность: повторное сохранение владельцем
-- перезаписывает payload, а не плодит очередь. Для student заявку подаёт не сама сущность
-- (у ученика нет логина), а его учитель — владение проверяется через students.teacher_id.
CREATE TABLE profile_change_requests (
    id            bigserial   PRIMARY KEY,
    entity_type   text        NOT NULL CHECK (entity_type IN ('school','teacher','district','student')),
    entity_id     bigint      NOT NULL,
    payload       jsonb       NOT NULL,
    status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    submitted_by  bigint      NOT NULL REFERENCES users(id),
    submitted_at  timestamptz NOT NULL DEFAULT now(),
    reviewed_by   bigint      REFERENCES users(id),
    reviewed_at   timestamptz,
    review_note   text
);
CREATE UNIQUE INDEX profile_change_requests_one_pending
    ON profile_change_requests (entity_type, entity_id)
    WHERE status = 'pending';
CREATE INDEX profile_change_requests_queue
    ON profile_change_requests (status, submitted_at DESC);

-- Файлы «Uğurlar» профиля учителя/школы (036_achievement_files.sql, UGURLAR_FILES_TASK.md).
-- Настоящие FK (в отличие от profile_change_requests выше) — владелец ровно один из двух;
-- pending-файл виден только владельцу/админу, одобрение и удаление одобренного идут через
-- payload.achievementFiles { add, remove } pending-заявки. Лежат на диске вне публичной статики.
CREATE TABLE achievement_files (
    id            bigserial   PRIMARY KEY,
    teacher_id    bigint      REFERENCES teachers(id) ON DELETE CASCADE,
    school_id     bigint      REFERENCES schools(id)  ON DELETE CASCADE,
    storage_name  text        NOT NULL UNIQUE,      -- '<uuid>.<pdf|jpg|png>'
    original_name text        NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
    mime_type     text        NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
    size_bytes    integer     NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
    has_thumbnail boolean     NOT NULL DEFAULT false,
    status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved')),
    uploaded_by   bigint      REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at   timestamptz NOT NULL DEFAULT now(),
    approved_by   bigint      REFERENCES users(id) ON DELETE SET NULL,
    approved_at   timestamptz,
    CONSTRAINT achievement_files_one_owner CHECK (num_nonnulls(teacher_id, school_id) = 1)
);
CREATE INDEX achievement_files_teacher ON achievement_files (teacher_id) WHERE teacher_id IS NOT NULL;
CREATE INDEX achievement_files_school  ON achievement_files (school_id)  WHERE school_id  IS NOT NULL;

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
-- level_scale_id (026_drop_legacy_subject_columns.sql, IMTAHAN_NOVLERI_TASK.md §20.3): шаблон,
-- градуированный по pillə, привязан к конкретной шкале level_scales, как и student_results.level
-- с 024 — level_code сам по себе больше не глобально уникален (composite FK ниже). level_code и
-- level_scale_id либо оба NULL (награда без градации), либо оба заданы (CHECK ниже).
CREATE TABLE certificate_templates (
    id             bigserial PRIMARY KEY,
    award_code     text NOT NULL,                 -- 'developing_student' и далее
    level_code     text,                          -- NULL, если награда не зависит от пилли
    level_scale_id bigint REFERENCES level_scales(id),
    name           text NOT NULL,
    image_path     text NOT NULL,
    image_width    int  NOT NULL,
    image_height   int  NOT NULL,
    female_image_path text,                       -- 034: girl variant, same px size as image_path
    fields         jsonb NOT NULL DEFAULT '[]'::jsonb,
    active         boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT certificate_templates_level_band_fkey
        FOREIGN KEY (level_scale_id, level_code) REFERENCES level_scale_bands (scale_id, code),
    CONSTRAINT certificate_templates_level_pair_chk
        CHECK ((level_code IS NULL) = (level_scale_id IS NULL))
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
CREATE INDEX student_results_teacher_year_idx  ON student_results (teacher_id, academic_year);
CREATE INDEX student_results_school_year_idx   ON student_results (school_id, academic_year);
CREATE INDEX student_results_district_year_idx ON student_results (district_id, academic_year);
CREATE INDEX ON booklets (exam_id);
CREATE INDEX ON user_refresh_tokens (user_id);
CREATE INDEX issued_certificates_result_idx ON issued_certificates (student_result_id);

-- Поиск по ФИО (025b_student_fullname.sql: пересоздан на fullname, по образцу teachers_name_trgm).
CREATE INDEX students_name_trgm ON students USING gin (fullname gin_trgm_ops);
CREATE INDEX teachers_name_trgm ON teachers USING gin (fullname gin_trgm_ops);
CREATE INDEX schools_name_trgm  ON schools  USING gin (name gin_trgm_ops);


-- ============================================================ soft delete (037_soft_delete.sql, SOFT_DELETE_TASK.md)
--
-- districts / schools / teachers / students above are the BASE tables; here they are renamed to *_all and
-- replaced by same-named views that hide deleted rows. Everything that follows (the rating views below, all
-- application code) keeps reading the plain names and never sees a hidden row. Code that needs hidden rows
-- (deletion.service.pg.ts, the «Silinənlər» list, code checks, login) reads *_all explicitly.
-- FKs created above are bound by OID, so they follow the rename to *_all.
-- Rule: ALTER TABLE <x>_all ADD COLUMN must be followed by re-creating the view <x> (SELECT * is expanded at creation).
-- Placed here, after every table that references the four, so that the file stays runnable top to bottom
-- (a REFERENCES on a view is not allowed).

CREATE TABLE deletions (
    id           bigserial   PRIMARY KEY,
    entity_type  text        NOT NULL CHECK (entity_type IN ('district', 'school', 'teacher', 'student')),
    entity_id    bigint      NOT NULL,                         -- root of the batch; polymorphic, no FK
    deleted_by   bigint      REFERENCES users(id) ON DELETE SET NULL,
    deleted_at   timestamptz NOT NULL DEFAULT now(),
    counts       jsonb       NOT NULL,                         -- {"schools":n,"teachers":n,"students":n,"results":n} at delete time
    restored_at  timestamptz,
    restored_by  bigint      REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX deletions_active_idx ON deletions (deleted_at DESC) WHERE restored_at IS NULL;

ALTER TABLE students
    ADD COLUMN deleted_at  timestamptz,
    ADD COLUMN deleted_by  bigint REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN deletion_id bigint REFERENCES deletions(id),
    ADD CONSTRAINT students_deletion_consistent CHECK ((deleted_at IS NULL) = (deletion_id IS NULL));
ALTER TABLE teachers
    ADD COLUMN deleted_at  timestamptz,
    ADD COLUMN deleted_by  bigint REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN deletion_id bigint REFERENCES deletions(id),
    ADD CONSTRAINT teachers_deletion_consistent CHECK ((deleted_at IS NULL) = (deletion_id IS NULL));
ALTER TABLE schools
    ADD COLUMN deleted_at  timestamptz,
    ADD COLUMN deleted_by  bigint REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN deletion_id bigint REFERENCES deletions(id),
    ADD CONSTRAINT schools_deletion_consistent CHECK ((deleted_at IS NULL) = (deletion_id IS NULL));
ALTER TABLE districts
    ADD COLUMN deleted_at  timestamptz,
    ADD COLUMN deleted_by  bigint REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN deletion_id bigint REFERENCES deletions(id),
    ADD CONSTRAINT districts_deletion_consistent CHECK ((deleted_at IS NULL) = (deletion_id IS NULL));

CREATE INDEX students_deletion_id_idx  ON students  (deletion_id) WHERE deletion_id IS NOT NULL;
CREATE INDEX teachers_deletion_id_idx  ON teachers  (deletion_id) WHERE deletion_id IS NOT NULL;
CREATE INDEX schools_deletion_id_idx   ON schools   (deletion_id) WHERE deletion_id IS NOT NULL;
CREATE INDEX districts_deletion_id_idx ON districts (deletion_id) WHERE deletion_id IS NOT NULL;

ALTER TABLE students  RENAME TO students_all;
ALTER TABLE teachers  RENAME TO teachers_all;
ALTER TABLE schools   RENAME TO schools_all;
ALTER TABLE districts RENAME TO districts_all;

CREATE VIEW students  AS SELECT * FROM students_all  WHERE deleted_at IS NULL;
CREATE VIEW teachers  AS SELECT * FROM teachers_all  WHERE deleted_at IS NULL;
CREATE VIEW schools   AS SELECT * FROM schools_all   WHERE deleted_at IS NULL;
CREATE VIEW districts AS SELECT * FROM districts_all WHERE deleted_at IS NULL;

COMMENT ON VIEW students  IS 'Live (not deleted) students. Base table: students_all (037_soft_delete.sql). New column on students_all => re-create this view.';
COMMENT ON VIEW teachers  IS 'Live (not deleted) teachers. Base table: teachers_all (037_soft_delete.sql). New column on teachers_all => re-create this view.';
COMMENT ON VIEW schools   IS 'Live (not deleted) schools. Base table: schools_all (037_soft_delete.sql). New column on schools_all => re-create this view.';
COMMENT ON VIEW districts IS 'Live (not deleted) districts. Base table: districts_all (037_soft_delete.sql). New column on districts_all => re-create this view.';


-- ============================================================ снимок в результатах (038_result_snapshot.sql, TRANSFERS_TASK.md)
--
-- teacher_id / school_id / district_id в student_results — где ученик писал экзамен. Триггер — единственный источник
-- правды для всех путей вставки; цепочка та же, что шли вьюхи: ученик -> учитель -> школа учителя -> район школы
-- (НЕ students.school_id/district_id). *_all, чтобы результаты скрытых учеников тоже получали снимок.
-- INSERT: заполняется, только если вызывающий не передал ни одного из трёх. UPDATE OF student_id: заново от нового
-- ученика. ON CONFLICT DO UPDATE (перезаливка того же экзамена) снимок существующей строки не трогает.
COMMENT ON COLUMN student_results.teacher_id  IS 'Snapshot (038): the student''s teacher when the result was written. Rating views aggregate by it.';
COMMENT ON COLUMN student_results.school_id   IS 'Snapshot (038): the school of that teacher when the result was written.';
COMMENT ON COLUMN student_results.district_id IS 'Snapshot (038): the district of that school when the result was written.';

CREATE FUNCTION student_results_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.teacher_id IS NOT NULL OR NEW.school_id IS NOT NULL OR NEW.district_id IS NOT NULL THEN
            RETURN NEW;
        END IF;
    ELSIF NEW.student_id IS NOT DISTINCT FROM OLD.student_id THEN
        RETURN NEW;
    END IF;

    SELECT s.teacher_id, t.school_id, sc.district_id
    INTO NEW.teacher_id, NEW.school_id, NEW.district_id
    FROM students_all s
    LEFT JOIN teachers_all t ON t.id = s.teacher_id
    LEFT JOIN schools_all sc ON sc.id = t.school_id
    WHERE s.id = NEW.student_id;

    RETURN NEW;
END $$;

CREATE TRIGGER student_results_snapshot_ins
    BEFORE INSERT ON student_results
    FOR EACH ROW EXECUTE FUNCTION student_results_snapshot();

CREATE TRIGGER student_results_snapshot_upd
    BEFORE UPDATE OF student_id ON student_results
    FOR EACH ROW EXECUTE FUNCTION student_results_snapshot();


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
--
-- exam_type_id (025_ratings_by_exam_type.sql, IMTAHAN_NOVLERI_TASK.md §4 шаг 3): вся цепочка
-- ниже (годовая и месячная) партиционирована по типу экзамена — GROUP BY у *_scores,
-- PARTITION BY у *_places. Очки разных типов не смешиваются (§2 ТЗ, решение 6).
CREATE VIEW v_student_year_scores AS
SELECT sr.student_id,
       sr.academic_year,
       sr.exam_type_id,
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
       -- один grade на (ученик, год, тип) — класс самого позднего результата (009, 031)
       (array_agg(sr.grade ORDER BY sr.year DESC, sr.month DESC, sr.id DESC))[1] AS grade
FROM student_results sr
WHERE sr.academic_year IS NOT NULL
GROUP BY sr.student_id, sr.academic_year, sr.exam_type_id;

-- Ученик: места. stats.service.ts:1312 updateStudentPlaces
-- Ранг по score (НЕ по average_score), внутри класса И типа экзамена; district_place — внутри
-- класса, типа и района. Фильтра «> 0» здесь нет: у ученика с нулём место есть.
-- ВАЖНО: класс берётся из v_student_year_scores.grade (исторический, student_results.grade),
-- а не из живого students.grade — иначе массовое повышение класса (Yeni tədris ili) задним
-- числом ломает уже посчитанные места за прошедший учебный год (найдено и исправлено 14.08.2026,
-- 008_student_ranking_uses_historical_grade.sql). students всё ещё нужен — для district_id.
CREATE VIEW v_student_places AS
SELECT sc.student_id,
       sc.academic_year,
       sc.exam_type_id,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.exam_type_id, sc.grade
                          ORDER BY sc.score DESC)                AS place,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.exam_type_id, sc.grade, s.district_id
                          ORDER BY sc.score DESC)                AS district_place,
       -- 039: places by average_score and within the school, still inside the grade
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.exam_type_id, sc.grade
                          ORDER BY sc.average_score DESC)        AS average_place,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.exam_type_id, sc.grade, s.district_id
                          ORDER BY sc.average_score DESC)        AS average_district_place,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.exam_type_id, sc.grade, s.school_id
                          ORDER BY sc.score DESC)                AS school_place,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.exam_type_id, sc.grade, s.school_id
                          ORDER BY sc.average_score DESC)        AS average_school_place
FROM v_student_year_scores sc
JOIN students s ON s.id = sc.student_id;

-- Учитель: сумма баллов его учеников (по типу экзамена), делённая на СОХРАНЁННЫЙ student_count.
-- stats.service.ts:1403. Делить на count(s.id) было бы «правильнее», но это другие цифры
-- у всех учителей сразу — менять только по решению заказчика (MONGO_TO_POSTGRES.md §3.4).
-- Учителя без набравших баллы учеников строки не имеют — в API подставлять 0 через coalesce.
--
-- 038 (TRANSFERS_TASK.md): учитель/школа/район (годовые и месячные) строятся НЕ друг из друга и не по текущим связям,
-- а прямо из student_results по снимку (teacher_id / school_id / district_id в результате). Результат учитывается на
-- уровне X, если жив ученик и живы все сущности снимка от учителя до X (soft delete, 037). Регион остаётся суммой
-- районов (снимка региона нет — район относится к региону по текущей связи).
--
-- Баллы одного результата: то же четырёхслагаемое выражение, что в v_student_year_scores / v_student_month_scores.
CREATE VIEW v_result_points AS
SELECT sr.student_id,
       sr.teacher_id,
       sr.school_id,
       sr.district_id,
       sr.academic_year,
       sr.year,
       sr.month,
       sr.exam_type_id,
       coalesce(sr.participation_score, 0)
         + coalesce(sr.development_score, 0)
         + coalesce(sr.student_of_the_month_score, 0)
         + coalesce(sr.republic_wide_student_of_the_month_score, 0) AS points
FROM student_results sr;

CREATE VIEW v_teacher_year_scores AS
SELECT t.id AS teacher_id,
       r.academic_year,
       r.exam_type_id,
       sum(r.points) AS score,
       CASE WHEN t.student_count > 0 THEN sum(r.points) / t.student_count ELSE 0 END AS average_score
FROM v_result_points r
JOIN students s ON s.id = r.student_id
JOIN teachers t ON t.id = r.teacher_id
WHERE r.academic_year IS NOT NULL
GROUP BY t.id, t.student_count, r.academic_year, r.exam_type_id;

-- Учитель: места. Решение заказчика 04.08.2026 (гейт 2, db/rating-semantics.md) заменено
-- решением 20.08.2026: заказчик имел в виду места по СЫРОМУ score (как у учеников), а не по
-- среднему — «путь B по average_score» было неверным пониманием требования. Ранжирование —
-- по score, entities с score = 0 в ранжировании не участвуют (получают place = NULL, а не
-- место в хвосте — это отдельное, не пересмотренное сейчас решение). district_place —
-- та же dense_rank-логика, что и у учеников (v_student_places), просто без grade в PARTITION BY.
-- См. 013_ratings_by_raw_score.sql, 025_ratings_by_exam_type.sql (exam_type_id в PARTITION BY).
CREATE VIEW v_teacher_places AS
SELECT ts.teacher_id,
       ts.academic_year,
       ts.exam_type_id,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id ORDER BY ts.score DESC) AS place,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id, t.district_id ORDER BY ts.score DESC) AS district_place,
       -- 035: second place, by average_score (the stored place/district_place stay by raw score)
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id ORDER BY ts.average_score DESC) AS average_place,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id, t.district_id ORDER BY ts.average_score DESC) AS average_district_place,
       -- 039: place within the teacher's school
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id, t.school_id ORDER BY ts.score DESC) AS school_place,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id, t.school_id ORDER BY ts.average_score DESC) AS average_school_place
FROM v_teacher_year_scores ts
JOIN teachers t ON t.id = ts.teacher_id
WHERE ts.score > 0;

-- Школа: сумма баллов её учителей (по типу экзамена) / сохранённый student_count школы.
-- stats.service.ts:1556
CREATE VIEW v_school_year_scores AS
SELECT sch.id AS school_id,
       r.academic_year,
       r.exam_type_id,
       sum(r.points) AS score,
       CASE WHEN sch.student_count > 0 THEN sum(r.points) / sch.student_count ELSE 0 END AS average_score
FROM v_result_points r
JOIN students s   ON s.id   = r.student_id
JOIN teachers t   ON t.id   = r.teacher_id
JOIN schools sch  ON sch.id = r.school_id
WHERE r.academic_year IS NOT NULL
GROUP BY sch.id, sch.student_count, r.academic_year, r.exam_type_id;

-- Школа: места. По score — та же логика, что и у учителя (см. комментарий у v_teacher_places).
-- См. 013_ratings_by_raw_score.sql, 025_ratings_by_exam_type.sql.
CREATE VIEW v_school_places AS
SELECT ss.school_id,
       ss.academic_year,
       ss.exam_type_id,
       dense_rank() OVER (PARTITION BY ss.academic_year, ss.exam_type_id ORDER BY ss.score DESC) AS place,
       dense_rank() OVER (PARTITION BY ss.academic_year, ss.exam_type_id, sc.district_id ORDER BY ss.score DESC) AS district_place,
       -- 035: second place, by average_score
       dense_rank() OVER (PARTITION BY ss.academic_year, ss.exam_type_id ORDER BY ss.average_score DESC) AS average_place,
       dense_rank() OVER (PARTITION BY ss.academic_year, ss.exam_type_id, sc.district_id ORDER BY ss.average_score DESC) AS average_district_place
FROM v_school_year_scores ss
JOIN schools sc ON sc.id = ss.school_id
WHERE ss.score > 0;

-- Район: сумма баллов его школ (по типу экзамена). stats.service.ts:1723
--
-- Средний балл = score / ЖИВОЕ число учеников района (как у региона). Легаси-делитель Mongo
-- (ученики_района × школы_района) заменён по решению владельца 22.10.2026 — 035_average_places_and_district_average.sql.
-- Делитель НЕ зависит от типа экзамена (чистый count() учеников района).
CREATE VIEW v_district_year_scores AS
SELECT d.id AS district_id,
       r.academic_year,
       r.exam_type_id,
       sum(r.points) AS score,
       CASE WHEN cnt.students_in_district > 0 THEN sum(r.points) / cnt.students_in_district ELSE 0 END AS average_score
FROM v_result_points r
JOIN students s   ON s.id   = r.student_id
JOIN teachers t   ON t.id   = r.teacher_id
JOIN schools sch  ON sch.id = r.school_id
JOIN districts d  ON d.id   = r.district_id
CROSS JOIN LATERAL (
    SELECT count(*) AS students_in_district FROM students WHERE district_id = d.id
) cnt
WHERE r.academic_year IS NOT NULL
GROUP BY d.id, r.academic_year, r.exam_type_id, cnt.students_in_district;

-- Район: места. По score, та же логика. district_place у района не существовал ни в одном из путей.
-- См. 013_ratings_by_raw_score.sql, 025_ratings_by_exam_type.sql.
CREATE VIEW v_district_places AS
SELECT ds.district_id,
       ds.academic_year,
       ds.exam_type_id,
       dense_rank() OVER (PARTITION BY ds.academic_year, ds.exam_type_id ORDER BY ds.score DESC) AS place,
       -- 035: second place, by average_score
       dense_rank() OVER (PARTITION BY ds.academic_year, ds.exam_type_id ORDER BY ds.average_score DESC) AS average_place
FROM v_district_year_scores ds
WHERE ds.score > 0;

-- Регион (PHASE3 п.1б, 005_regions.sql): сумма баллов его районов (по типу экзамена). Делитель —
-- ЖИВОЕ число учеников региона, а не денормализованное поле — решение пользователя 08.08.2026.
-- Легаси-ошибка делителя районов (ученики_района × школы_района; исправлена в 035) сюда
-- СОЗНАТЕЛЬНО не переносится: это отдельная сущность, не обязана повторять баг района.
-- Пока район не привязан ни к одному региону (region_id IS NULL) — регион просто не
-- получает строки, это корректное поведение, а не пробел.
CREATE VIEW v_region_year_scores AS
SELECT r.id AS region_id,
       ds.academic_year,
       ds.exam_type_id,
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
GROUP BY r.id, ds.academic_year, ds.exam_type_id, cnt.students_in_region;

-- Регион: места. По score — та же логика, что и у района/школы/учителя.
-- См. 013_ratings_by_raw_score.sql, 025_ratings_by_exam_type.sql.
CREATE VIEW v_region_places AS
SELECT rs.region_id,
       rs.academic_year,
       rs.exam_type_id,
       dense_rank() OVER (PARTITION BY rs.academic_year, rs.exam_type_id ORDER BY rs.score DESC) AS place,
       -- 039: second place, by average_score
       dense_rank() OVER (PARTITION BY rs.academic_year, rs.exam_type_id ORDER BY rs.average_score DESC) AS average_place
FROM v_region_year_scores rs
WHERE rs.score > 0;



-- ============================================================ месячный срез рейтингов
-- 021_monthly_rating_views.sql, п.10 ТЗ от 04.09.2026 (MONTHLY_RATINGS_TASK.md).
-- Параллель годовой цепочки выше, но с группировкой по календарной паре (year, month).
-- Годовые вьюхи не затронуты; среднего балла в месячном срезе нет ни на одном уровне.
-- exam_type_id (025_ratings_by_exam_type.sql) добавлен во всю цепочку ниже, как и в годовой.

-- ============================================================ ученик

-- Копия v_student_year_scores с группировкой по (year, month, exam_type_id) вместо academic_year.
-- grade — исторический, из student_results (как в 008_student_ranking_uses_historical_grade.sql):
-- массовое повышение класса не должно задним числом менять уже посчитанный месяц.
--
-- ВНИМАНИЕ, отличие от годовой вьюхи: grade НЕ входит в GROUP BY, он берётся через min()
-- (исправлено в 022_student_month_scores_one_row.sql; в 021 он ошибочно был в группировке).
-- В v_student_year_scores он тоже НЕ в группировке (array_agg последнего класса, 031): там две
-- строки на (ученик, год, тип) роняли INSERT в student_year_ratings по PK. Месячный
-- путь читает вьюху напрямую и join'ит её к students, поэтому строка обязана быть одна на
-- (ученик, год, месяц, тип экзамена): иначе ученик, у которого в одном календарном месяце два
-- результата с разным grade (два экзамена в месяц, пересдача, поправленный класс), попадёт в
-- рейтинг дважды с расщеплённым баллом. exam_type_id, в отличие от grade, ДОБАВЛЕН в
-- группировку (025_ratings_by_exam_type.sql) — это сама ось партиционирования, а не атрибут
-- ученика, поэтому запрет на расширение группировки на него не распространяется.
CREATE VIEW v_student_month_scores AS
SELECT sr.student_id,
       sr.year,
       sr.month,
       sr.exam_type_id,
       count(*)::int                                                    AS participation_count,
       sum(coalesce(sr.participation_score, 0)
         + coalesce(sr.development_score, 0)
         + coalesce(sr.student_of_the_month_score, 0)
         + coalesce(sr.republic_wide_student_of_the_month_score, 0))    AS score,
       min(sr.grade)                                                    AS grade
FROM student_results sr
GROUP BY sr.student_id, sr.year, sr.month, sr.exam_type_id;

-- Места учеников — внутри класса и типа экзамена, как в v_student_places. Фильтра «score > 0»
-- здесь нет: у ученика с нулём место есть. Это отличает учеников от остальных уровней, и в
-- годовой версии ровно так же.
CREATE VIEW v_student_month_places AS
SELECT sc.student_id,
       sc.year,
       sc.month,
       sc.exam_type_id,
       dense_rank() OVER (PARTITION BY sc.year, sc.month, sc.exam_type_id, sc.grade
                          ORDER BY sc.score DESC)                       AS place,
       dense_rank() OVER (PARTITION BY sc.year, sc.month, sc.exam_type_id, sc.grade, s.district_id
                          ORDER BY sc.score DESC)                       AS district_place
FROM v_student_month_scores sc
JOIN students s ON s.id = sc.student_id;

-- ============================================================ учитель

-- Сумма баллов учеников учителя за месяц (по типу экзамена). Без average_score — см. шапку файла.
-- 038: месячные учитель/школа/район — тоже прямо из student_results по снимку (см. v_result_points).
CREATE VIEW v_teacher_month_scores AS
SELECT t.id AS teacher_id,
       r.year,
       r.month,
       r.exam_type_id,
       sum(r.points) AS score
FROM v_result_points r
JOIN students s ON s.id = r.student_id
JOIN teachers t ON t.id = r.teacher_id
GROUP BY t.id, r.year, r.month, r.exam_type_id;

CREATE VIEW v_teacher_month_places AS
SELECT ts.teacher_id,
       ts.year,
       ts.month,
       ts.exam_type_id,
       dense_rank() OVER (PARTITION BY ts.year, ts.month, ts.exam_type_id ORDER BY ts.score DESC)                   AS place,
       dense_rank() OVER (PARTITION BY ts.year, ts.month, ts.exam_type_id, t.district_id ORDER BY ts.score DESC)    AS district_place
FROM v_teacher_month_scores ts
JOIN teachers t ON t.id = ts.teacher_id
WHERE ts.score > 0;

-- ============================================================ школа

CREATE VIEW v_school_month_scores AS
SELECT sch.id AS school_id,
       r.year,
       r.month,
       r.exam_type_id,
       sum(r.points) AS score
FROM v_result_points r
JOIN students s   ON s.id   = r.student_id
JOIN teachers t   ON t.id   = r.teacher_id
JOIN schools sch  ON sch.id = r.school_id
GROUP BY sch.id, r.year, r.month, r.exam_type_id;

CREATE VIEW v_school_month_places AS
SELECT ss.school_id,
       ss.year,
       ss.month,
       ss.exam_type_id,
       dense_rank() OVER (PARTITION BY ss.year, ss.month, ss.exam_type_id ORDER BY ss.score DESC)                    AS place,
       dense_rank() OVER (PARTITION BY ss.year, ss.month, ss.exam_type_id, sc.district_id ORDER BY ss.score DESC)    AS district_place
FROM v_school_month_scores ss
JOIN schools sc ON sc.id = ss.school_id
WHERE ss.score > 0;

-- ============================================================ район (təhsil sektoru)

-- Сумма баллов школ района за месяц (по типу экзамена). Легаси-делитель среднего балла
-- (ученики_района × школы_района; в v_district_year_scores заменён в 035),
-- сюда НЕ переносится — среднего балла в месячном срезе нет вовсе, переносить нечего.
CREATE VIEW v_district_month_scores AS
SELECT d.id AS district_id,
       r.year,
       r.month,
       r.exam_type_id,
       sum(r.points) AS score
FROM v_result_points r
JOIN students s   ON s.id   = r.student_id
JOIN teachers t   ON t.id   = r.teacher_id
JOIN schools sch  ON sch.id = r.school_id
JOIN districts d  ON d.id   = r.district_id
GROUP BY d.id, r.year, r.month, r.exam_type_id;

-- district_place у района не существует ни в одном из путей — как и в v_district_places.
CREATE VIEW v_district_month_places AS
SELECT ds.district_id,
       ds.year,
       ds.month,
       ds.exam_type_id,
       dense_rank() OVER (PARTITION BY ds.year, ds.month, ds.exam_type_id ORDER BY ds.score DESC) AS place
FROM v_district_month_scores ds
WHERE ds.score > 0;

-- ============================================================ регион (regional təhsil idarəsi)

-- Район, не привязанный ни к одному региону (region_id IS NULL), в регион не попадает —
-- корректное поведение, как и в v_region_year_scores.
CREATE VIEW v_region_month_scores AS
SELECT r.id AS region_id,
       ds.year,
       ds.month,
       ds.exam_type_id,
       sum(ds.score) AS score
FROM regions r
JOIN districts d                 ON d.region_id = r.id
JOIN v_district_month_scores ds  ON ds.district_id = d.id
GROUP BY r.id, ds.year, ds.month, ds.exam_type_id;

CREATE VIEW v_region_month_places AS
SELECT rs.region_id,
       rs.year,
       rs.month,
       rs.exam_type_id,
       dense_rank() OVER (PARTITION BY rs.year, rs.month, rs.exam_type_id ORDER BY rs.score DESC) AS place
FROM v_region_month_scores rs
WHERE rs.score > 0;

COMMIT;
