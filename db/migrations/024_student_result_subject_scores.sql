-- 024_student_result_subject_scores.sql
-- Дата: 2026-09-08
-- Задача: IMTAHAN_NOVLERI_TASK.md §4, шаг 2 — предметы из пяти колонок student_results
-- переезжают в строки новой таблицы student_result_subject_scores, чтобы произвольный тип
-- экзамена мог иметь произвольный набор предметов (не пять зашитых).
--
-- ============================================================================
-- Решение исполнителя, которого нет в тексте ТЗ (записано здесь и продублировано в
-- IMTAHAN_NOVLERI_TASK.md §11 "Журнал реализации" дословно):
--
-- (а) NOT NULL снимается с student_results.az/math/az_count/math_count.
--     Эти четыре колонки объявлены NOT NULL с самого schema.sql (унаследовано от Mongo,
--     где az/math были обязательны у КАЖДОГО результата). Пока миграция 026 не удалила
--     легаси-колонки совсем, они физически остаются частью таблицы — и INSERT новой строки
--     результата для типа экзамена, в наборе предметов которого нет "az"/"math" (то есть
--     почти любого НОВОГО типа, кроме базового), упал бы на уровне БД с "null value violates
--     not-null constraint". Сборка (tsc) этого не поймает: колонки просто не заполняются
--     новым кодом, ошибка вылезет только в рантайме на первом же импорте нового типа.
--     Снимаем NOT NULL сейчас, а не откладываем до 026, потому что 025/026 в этом шаге не
--     делаются, а падать в проде до них нельзя. life_knowledge/logic/english уже были
--     nullable — правим только эти четыре.
--
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------- новая таблица баллов
CREATE TABLE student_result_subject_scores (
    result_id      bigint NOT NULL REFERENCES student_results(id) ON DELETE CASCADE,
    subject_code   text   NOT NULL REFERENCES subjects(code),
    score          double precision NOT NULL,
    question_count int,
    PRIMARY KEY (result_id, subject_code)
);

-- ---------------------------------------------------------------- новые колонки student_results
ALTER TABLE student_results
    ADD COLUMN exam_type_id   bigint REFERENCES exam_types(id),
    ADD COLUMN section_id     bigint REFERENCES exam_type_sections(id),
    ADD COLUMN level_scale_id bigint REFERENCES level_scales(id),
    ADD COLUMN max_questions  int,
    ADD COLUMN score_percent  numeric(6,3);

-- (а) см. шапку файла.
ALTER TABLE student_results
    ALTER COLUMN az DROP NOT NULL,
    ALTER COLUMN math DROP NOT NULL,
    ALTER COLUMN az_count DROP NOT NULL,
    ALTER COLUMN math_count DROP NOT NULL;

-- ---------------------------------------------------------------- backfill баллов по предметам
-- Фильтр по классу ОБЯЗАТЕЛЕН и повторяет старую вьюху v_student_result_subject_scores
-- (002_subjects_lookup.sql): lifeKnowledge/logic только при grade <= 4, english только при
-- grade >= 5. Без фильтра затащим ~6480 фантомных строк english=0 у 1-4 классов — известный
-- артефакт переезда с Mongo (см. шапку 002_subjects_lookup.sql), который иначе попадёт в
-- любой AVG по предмету. az/math — без фильтра по классу, они были NOT NULL у всех строк
-- ровно так же, как и раньше.
INSERT INTO student_result_subject_scores (result_id, subject_code, score, question_count)
SELECT id, 'az', az, az_count FROM student_results WHERE az IS NOT NULL;

INSERT INTO student_result_subject_scores (result_id, subject_code, score, question_count)
SELECT id, 'math', math, math_count FROM student_results WHERE math IS NOT NULL;

INSERT INTO student_result_subject_scores (result_id, subject_code, score, question_count)
SELECT id, 'lifeKnowledge', life_knowledge, life_knowledge_count
FROM student_results
WHERE grade <= 4 AND life_knowledge IS NOT NULL;

INSERT INTO student_result_subject_scores (result_id, subject_code, score, question_count)
SELECT id, 'logic', logic, logic_count
FROM student_results
WHERE grade <= 4 AND logic IS NOT NULL;

INSERT INTO student_result_subject_scores (result_id, subject_code, score, question_count)
SELECT id, 'english', english, english_count
FROM student_results
WHERE grade >= 5 AND english IS NOT NULL;

-- ---------------------------------------------------------------- backfill остального
-- exam_type_id — из exams по exam_id. Решение исполнителя (в ТЗ не оговорено явно): у строк
-- с exam_id IS NULL (легаси-импорт importLegacyResultsFromJson, studentResult.service.pg.ts)
-- подставляется базовый тип (is_base = true) — тем же способом, каким уже чинился
-- processExamsFromExcel в шаге 1 (§11 ТЗ, п.3 журнала): вся история до этой задачи логически
-- принадлежит единственному существовавшему на тот момент типу, привязать её больше не к чему.
UPDATE student_results sr
SET exam_type_id = COALESCE(
    (SELECT e.exam_type_id FROM exams e WHERE e.id = sr.exam_id),
    (SELECT id FROM exam_types WHERE is_base)
);

-- level_scale_id — единственная шкала isim_percent, для всех строк без исключения.
UPDATE student_results
SET level_scale_id = (SELECT id FROM level_scales WHERE code = 'isim_percent');

-- section_id — по grade внутри уже определённого exam_type_id.
UPDATE student_results sr
SET section_id = ets.id
FROM exam_type_sections ets
WHERE ets.exam_type_id = sr.exam_type_id
  AND sr.grade BETWEEN ets.grade_from AND ets.grade_to;

-- max_questions: для grade <= 4 — сумма max_questions секции из конфига (сейчас всегда 50 —
-- секция "1-4 sinif" сеется полностью в 023). Для grade >= 5 — az_count+math_count+english_count,
-- если сумма > 0, иначе NULL (секция "5-11 sinif" в 023 без предметов, знать конфиг неоткуда,
-- да он и не нужен для истории — см. §3 ТЗ).
UPDATE student_results sr
SET max_questions = totals.total
FROM (
    SELECT section_id, SUM(max_questions) AS total
    FROM exam_type_section_subjects
    GROUP BY section_id
) totals
WHERE sr.section_id = totals.section_id
  AND sr.grade <= 4;

UPDATE student_results sr
SET max_questions = CASE
    WHEN (COALESCE(sr.az_count, 0) + COALESCE(sr.math_count, 0) + COALESCE(sr.english_count, 0)) > 0
    THEN COALESCE(sr.az_count, 0) + COALESCE(sr.math_count, 0) + COALESCE(sr.english_count, 0)
    ELSE NULL
END
WHERE sr.grade >= 5;

-- score_percent — только там, где max_questions не NULL. Остальные строки остаются с NULL:
-- это заморозка (§2 ТЗ), а не пробел, который надо заткнуть.
UPDATE student_results
SET score_percent = ROUND((total_score::numeric / max_questions::numeric) * 100, 3)
WHERE max_questions IS NOT NULL AND max_questions > 0;

-- ---------------------------------------------------------------------------------------
-- Ожидаемое расхождение в исторических строках — НЕ БАГ, НЕ "ЧИНИТЬ". У части старых
-- результатов сохранённый level не совпадёт с тем, что дала бы шкала isim_percent по их
-- score_percent. Это ровно три балла из 51 возможного: 15 (30% — в базе E, по шкале D), 25
-- (50% — D/C) и 47 (94% — Lisey/A). Так и должно быть: старые pillə выданы по прежним
-- абсолютным порогам и заморожены. Никаких CHECK, пересчётов и "выравниваний" по этому поводу
-- не добавлено; это не порча данных, если кто-то найдёт расхождение через год.
-- ---------------------------------------------------------------------------------------

-- ---------------------------------------------------------------- инварианты после бэкфилла
-- level_scale_id NOT NULL — иначе композитный FK ниже (MATCH SIMPLE) на строке с NULL в этой
-- колонке НЕ проверяет level вообще, то есть тихо слабее прежнего student_results_level_fkey.
-- Все три пути вставки (новый парсер, легаси-JSON, ручное создание) её проставляют, но это
-- гарантия «пока никто не забыл», а не гарантия БД.
--
-- exam_type_id NOT NULL — на шаге 3 (миграция 025) по нему партиционируются все рейтинги и
-- месячные награды. NULL там не «неизвестный тип», а молча выпавший из всех рейтингов
-- результат, который никто не заметит.
--
-- section_id намеренно ОСТАЁТСЯ nullable: класс результата может не попасть ни в одну секцию
-- (например, grade вне 1..11), и это законное состояние, а не ошибка.
ALTER TABLE student_results
    ALTER COLUMN level_scale_id SET NOT NULL,
    ALTER COLUMN exam_type_id   SET NOT NULL;

-- ---------------------------------------------------------------- композитный FK на шкалу
-- Сойдётся, потому что isim_percent содержит те же шесть кодов, что и старая таблица levels
-- (E, D, C, B, A, Lisey), а level_scale_id у всех строк один и тот же (backfill выше).
-- Сама levels после этого не используется — НЕ удаляется в этой миграции, снос в 026.
ALTER TABLE student_results DROP CONSTRAINT student_results_level_fkey;
ALTER TABLE student_results
    ADD CONSTRAINT student_results_level_band_fkey
    FOREIGN KEY (level_scale_id, level) REFERENCES level_scale_bands (scale_id, code);

-- ---------------------------------------------------------------- вьюха совместимости
-- Та же форма результата, что была у версии над колонками (002_subjects_lookup.sql), чтобы не
-- искать всех её читателей в один заход. db.ts уже описывает VStudentResultSubjectScores с
-- этими же полями (добавлено вручную в шаге 1, до этой миграции таблица под вьюхой не
-- существовала).
CREATE VIEW v_student_result_subject_scores AS
SELECT srs.result_id, sr.student_id, sr.exam_id, sr.grade, sr.academic_year,
       srs.subject_code, srs.score, srs.question_count
FROM student_result_subject_scores srs
JOIN student_results sr ON sr.id = srs.result_id;

COMMIT;

-- ============================================================================
-- Проверки данных (§3 ТЗ) — НЕ блокируют применение, прогнать на проде после миграции и
-- вписать результат в IMTAHAN_NOVLERI_TASK.md §3:
--
-- П1 (целостность счётчиков вопросов):
-- SELECT CASE WHEN grade >= 5 THEN '5+' ELSE '1-4' END AS grp,
--        coalesce(az_count,0)+coalesce(math_count,0)+coalesce(english_count,0)
--      + coalesce(life_knowledge_count,0)+coalesce(logic_count,0) AS total_q,
--        count(*)
-- FROM student_results GROUP BY 1,2 ORDER BY 1,2;
--
-- П2 (кого задели бы новые границы при пересчёте истории — справочно):
-- SELECT total_score, level, count(*) FROM student_results
-- WHERE total_score IN (15,25,47) GROUP BY 1,2 ORDER BY 1;
--
-- П3 (есть ли уже результаты в 2026/2027 — ЕДИНСТВЕННОЕ, что требует решения заказчика):
-- SELECT academic_year, count(*) FROM student_results
-- WHERE academic_year >= 2026 GROUP BY 1 ORDER BY 1;
--
-- Сверка после 024 (§8 ТЗ, должна дать ноль расхождений во всех пяти строках):
-- SELECT 'az' AS s, (SELECT sum(az) FROM student_results) AS was,
--        (SELECT sum(score) FROM student_result_subject_scores WHERE subject_code='az') AS now
-- UNION ALL SELECT 'math', (SELECT sum(math) FROM student_results),
--        (SELECT sum(score) FROM student_result_subject_scores WHERE subject_code='math')
-- UNION ALL SELECT 'lifeKnowledge', (SELECT sum(life_knowledge) FROM student_results WHERE grade <= 4),
--        (SELECT sum(score) FROM student_result_subject_scores WHERE subject_code='lifeKnowledge')
-- UNION ALL SELECT 'logic', (SELECT sum(logic) FROM student_results WHERE grade <= 4),
--        (SELECT sum(score) FROM student_result_subject_scores WHERE subject_code='logic')
-- UNION ALL SELECT 'english', (SELECT sum(english) FROM student_results WHERE grade >= 5),
--        (SELECT sum(score) FROM student_result_subject_scores WHERE subject_code='english');
-- ============================================================================
