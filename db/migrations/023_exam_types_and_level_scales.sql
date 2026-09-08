-- 023_exam_types_and_level_scales.sql
-- Дата: 2026-09-08
-- Задача: IMTAHAN_NOVLERI_TASK.md §4, шаг 1
--
-- Зачем (§0-§1 ТЗ). Сегодня экзамен — это exams(code, name, date, active) и всё: набор
-- предметов зашит пятью колонками student_results и веткой grade >= 5 в парсере Excel;
-- шкала pillə — абсолютные пороги total_score в таблице levels, пригодные ровно для экзамена
-- на 50 вопросов. Эта миграция заводит справочники под произвольные виды экзаменов:
--   - level_scales / level_scale_bands — процентные шкалы pillə (таблица, не константа,
--     чтобы проценты правились без миграции; разные типы экзаменов могут ссылаться на
--     разные шкалы);
--   - exam_types / exam_type_sections / exam_type_section_subjects — тип экзамена → секции
--     по классам → набор предметов секции с max_questions;
--   - subjects перестаёт описывать колонки student_results (result_column/count_column/
--     min_grade/max_grade уходят) и становится чистым справочником кодов предметов.
-- Все нынешние экзамены переводятся на единственный базовый тип isim_merkezlesdirilmis
-- (is_base = true) — существующие рейтинги ничего не замечают (IMTAHAN_NOVLERI_TASK.md §2,
-- решения 3-5,7).
--
-- Секция "5-11 sinif" создаётся БЕЗ предметов, и это намеренно (IMTAHAN_NOVLERI_TASK.md §3).
-- Набор предметов и max_questions для неё заводит админ через редактор типов — ровно так же,
-- как для любого нового типа экзамена. Знаменатель процента берётся из конфига секции, а не
-- из истории, поэтому "археологический" запрос к проду для этого не нужен. Секция 1-4 сеется
-- полностью только потому, что её состав зафиксирован в методике (15+15+10+10=50).
--
-- Импорт результатов по секции без предметов обязан падать с внятной ошибкой, а не делить
-- на ноль — см. IMTAHAN_NOVLERI_TASK.md §7.

BEGIN;

-- Нужен для EXCLUDE USING gist ниже (диапазонные типы int4range/numrange в индексе-исключении).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- subjects: перестаёт описывать колонки student_results, становится чистым справочником.
-- code (PK, text), name_az, sort_order, active остаются как есть.
DROP VIEW IF EXISTS v_student_result_subject_scores;   -- пересоздаётся в 024 над новой таблицей
ALTER TABLE subjects
    DROP COLUMN result_column,
    DROP COLUMN count_column,
    DROP COLUMN min_grade,
    DROP COLUMN max_grade;

CREATE TABLE level_scales (
    id      bigserial PRIMARY KEY,
    code    text NOT NULL UNIQUE,
    name_az text NOT NULL,
    note    text,
    active  boolean NOT NULL DEFAULT true
);

-- Диапазоны — ПОЛУИНТЕРВАЛЫ [min_percent, max_percent): иначе дробный процент
-- (29.5%) не попадает ни в один бэнд. Верхний бэнд закрывает 100 включительно
-- (max_percent = 100.001 у Lisey, см. сиды ниже).
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

CREATE TABLE exam_types (
    id                   bigserial PRIMARY KEY,
    code                 text    NOT NULL UNIQUE,
    name_az              text    NOT NULL,
    level_scale_id       bigint  NOT NULL REFERENCES level_scales(id),
    has_question_counts  boolean NOT NULL DEFAULT true,
    month_award_min_rank int,          -- NULL = награда месяца не зависит от pillə
    is_base              boolean NOT NULL DEFAULT false,
    active               boolean NOT NULL DEFAULT true,
    sort_order           int     NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX exam_types_single_base ON exam_types (is_base) WHERE is_base;

CREATE TABLE exam_type_sections (
    id           bigserial PRIMARY KEY,
    exam_type_id bigint NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
    name_az      text   NOT NULL,
    grade_from   int    NOT NULL,
    grade_to     int    NOT NULL,
    CHECK (grade_from <= grade_to),
    -- int4range(grade_from, grade_to) сам по себе полуоткрытый ([grade_from, grade_to)) —
    -- секция "1-4 sinif" (grade_to=4) и "5-11 sinif" (grade_from=5) с ним считались бы
    -- НЕ пересекающимися, но диапазон классов секции должен включать grade_to целиком.
    -- + 1 переводит верхнюю границу в исключающую форму диапазона классов, который сама
    -- секция трактует как ВКЛЮЧАЮЩИЙ (grade_from..grade_to) — иначе 1-4 и 5-11 не были бы
    -- обнаружены как корректно соседствующие (не должны пересекаться, но должны примыкать
    -- на границе класса 4/5).
    EXCLUDE USING gist (exam_type_id WITH =, int4range(grade_from, grade_to + 1) WITH &&)
);

CREATE TABLE exam_type_section_subjects (
    section_id    bigint NOT NULL REFERENCES exam_type_sections(id) ON DELETE CASCADE,
    subject_code  text   NOT NULL REFERENCES subjects(code),
    max_questions int    NOT NULL CHECK (max_questions > 0),
    sort_order    int    NOT NULL DEFAULT 0,
    PRIMARY KEY (section_id, subject_code)
);

ALTER TABLE exams ADD COLUMN exam_type_id bigint REFERENCES exam_types(id);

-- ============================================================ сиды

-- Одна шкала pillə: проценты из методики, действующий и единственный стандарт
-- (IMTAHAN_NOVLERI_TASK.md §2, решение по границам pillə).
INSERT INTO level_scales (code, name_az, note)
VALUES ('isim_percent', 'İSİM metodikası (faiz əsaslı)',
        'Proseslər metodikadan götürülüb — hazırkı və yeganə standart.');

-- name_az бэнда = его код — тот же устоявшийся паттерн, что и в 001_levels_lookup.sql
-- (name_az = code для E/D/C/B/A/Lisey). ТЗ не даёт отдельных человеческих названий бэндов.
INSERT INTO level_scale_bands (scale_id, code, name_az, rank, participation_score, min_percent, max_percent)
SELECT (SELECT id FROM level_scales WHERE code = 'isim_percent'), v.code, v.code, v.rank,
       v.participation_score, v.min_percent, v.max_percent
FROM (VALUES
    ('E',     1, 1, 0::numeric,  30::numeric),
    ('D',     2, 2, 30,          50),
    ('C',     3, 3, 50,          70),
    ('B',     4, 4, 70,          84),
    ('A',     5, 5, 84,          95),
    ('Lisey', 6, 6, 95,          100.001)
) AS v(code, rank, participation_score, min_percent, max_percent);

-- Базовый тип: все нынешние экзамены. month_award_min_rank = 6 — нынешнее правило
-- «награда месяца только на Lisey» (rank Lisey = 6 в шкале isim_percent).
INSERT INTO exam_types (code, name_az, level_scale_id, has_question_counts, is_base, month_award_min_rank)
VALUES ('isim_merkezlesdirilmis', 'Mərkəzləşmiş İmtahan',
        (SELECT id FROM level_scales WHERE code = 'isim_percent'),
        true, true, 6);

INSERT INTO exam_type_sections (exam_type_id, name_az, grade_from, grade_to)
SELECT (SELECT id FROM exam_types WHERE code = 'isim_merkezlesdirilmis'), v.name_az, v.grade_from, v.grade_to
FROM (VALUES
    ('1-4 sinif',  1, 4),
    ('5-11 sinif', 5, 11)
) AS v(name_az, grade_from, grade_to);

-- Секция "1-4 sinif": az 15, math 15, lifeKnowledge 10, logic 10 (из методики, сумма 50).
-- Коды предметов сверены буква-в-букву с 002_subjects_lookup.sql.
INSERT INTO exam_type_section_subjects (section_id, subject_code, max_questions, sort_order)
SELECT (SELECT id FROM exam_type_sections
        WHERE name_az = '1-4 sinif'
          AND exam_type_id = (SELECT id FROM exam_types WHERE code = 'isim_merkezlesdirilmis')),
       v.code, v.max_questions, v.sort_order
FROM (VALUES
    ('az',            15, 1),
    ('math',          15, 2),
    ('lifeKnowledge', 10, 3),
    ('logic',         10, 4)
) AS v(code, max_questions, sort_order);

-- Секция "5-11 sinif" намеренно остаётся без строк в exam_type_section_subjects:
-- предметы и max_questions заводит админ в редакторе типов (см. шапку файла и §3 ТЗ).

-- Привязка существующих экзаменов к базовому типу.
UPDATE exams SET exam_type_id = (SELECT id FROM exam_types WHERE code = 'isim_merkezlesdirilmis');
ALTER TABLE exams ALTER COLUMN exam_type_id SET NOT NULL;

COMMIT;
