-- 002_subjects_lookup.sql
-- Дата: 05.08.2026
-- Задача: DB_REFACTOR_TASKS.md §3 (справочник предметов + view + валидация booklets.disciplines)
--
-- Зачем: понятие "предмет" размазано по трём местам (колонки student_results,
-- ключи booklets.disciplines jsonb, позиции в Excel-парсере) и БД их не связывает.
-- Хранение колонками остаётся (заказчик решил не нормализовывать), справочник даёт
-- понятию "предмет" единственный дом.
--
-- min_grade/max_grade подтверждены пользователем 05.08.2026 как исходное намерение
-- (совпадает с веткой Number(row[2])>=5 в Excel-импорте studentResult.service.pg.ts,
-- унаследованной от Mongo-версии без изменений): english — с 5 класса, lifeKnowledge/logic —
-- по 4 класс включительно. Реальные данные это не всегда соблюдают (см. отчёт: ~6480 строк
-- english=0 в 1-4 классах — давний артефакт хранения из Mongo, не новый баг), поэтому view
-- ниже фильтрует по границе классов из этой таблицы, а не по "колонка не NULL" — иначе
-- эти фантомные нулевые строки попали бы в любой AVG по предмету.
--
-- name_az — взяты из уже существующих подписей во фронтенде
-- (result-editing-dialog.component.html), не придуманы заново.
--
-- Валидация 22 существующих booklets.disciplines (запрос 05.08.2026): посторонних ключей
-- не найдено, все входят в {az, math, lifeKnowledge, logic, english}. Триггер ниже защищает
-- от появления посторонних ключей в будущем.

BEGIN;

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

INSERT INTO subjects (code, name_az, result_column, count_column, min_grade, max_grade, sort_order) VALUES
    ('az',            'Azərbaycan dili', 'az',             'az_count',             NULL, NULL, 1),
    ('math',          'Riyaziyyat',      'math',           'math_count',           NULL, NULL, 2),
    ('lifeKnowledge', 'Həyat bilgisi',   'life_knowledge', 'life_knowledge_count', NULL, 4,    3),
    ('logic',         'Məntiq',          'logic',          'logic_count',          NULL, 4,    4),
    ('english',       'İngilis dili',    'english',        'english_count',        5,    NULL, 5);

-- "Развёрнутая" в строки версия колонок student_results — read-only, хранение не меняет.
-- az/math не ограничены классом (min_grade/max_grade NULL) — берутся все строки, они NOT NULL
-- в student_results всегда. lifeKnowledge/logic/english фильтруются по грани классов из
-- subjects, а не по "колонка не NULL", чтобы не считать фантомные нулевые записи вне
-- предназначенного диапазона классов как реально сданный предмет.
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

-- Защита ключей booklets.disciplines (jsonb) от посторонних кодов предметов.
-- CHECK не может ссылаться на другую таблицу, поэтому — триггер.
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

COMMIT;
