-- 025d_question_counts_from_file.sql
-- Дата: 2026-09-11
-- Задача: IMTAHAN_NOVLERI_TASK.md §16 — «количество вопросов по предмету не свойство типа
-- экзамена, а свойство конкретной работы».
--
-- Зачем. §16 отменяет часть §4/§7 того же ТЗ (023_exam_types_and_level_scales.sql,
-- 024_student_result_subject_scores.sql): раньше знаменатель score_percent брался из
-- exam_type_section_subjects.max_questions (конфиг типа экзамена, заполняется админом один раз
-- в редакторе типов), а число вопросов, реально приходящее из файла импорта, писалось в
-- student_result_subject_scores.question_count и НИГДЕ не читалось. Это неверная модель: два
-- варианта одной и той же контрольной работы (скажем, 26/22/23 вопроса по трём предметам вместо
-- «типовых» 15/15/10/10) требуют разных знаменателей, а конфиг типа один на всех. Решение:
-- конфиг секции (exam_type_section_subjects) отныне задаёт ТОЛЬКО состав предметов секции;
-- число вопросов по каждому предмету обязательно приходит с каждой конкретной работой
-- (question_count) и суммируется построчно — код уже переписан на этот принцип
-- (studentResult.service.pg.ts::computeScoreSummary/processStudentResultsFromExcel,
-- resultTemplate.service.ts) до применения этой миграции.
--
-- Что делает.
--   1. exam_type_section_subjects.max_questions — снесена. Только эта колонка задавала число
--      вопросов на уровне конфига типа; после неё в таблице остаются section_id/subject_code/
--      sort_order — чистый состав предметов, без чисел.
--   2. exam_types.has_question_counts — снесена. Колонка "sual sayı hesablanır" гейтила, нужна
--      ли колонка "(sual sayı)" в шаблоне Excel; теперь эта колонка присутствует ВСЕГДА (§16:
--      "колонки (sual sayı) генерируются всегда, для каждого предмета"), гейт больше не нужен.
--   3. Сид секции "5-11 sinif" базового типа — az/math/english, sort_order 1/2/3, БЕЗ чисел
--      (колонки для чисел уже нет). Секция пустовала с 023_exam_types_and_level_scales.sql
--      (§3 того ТЗ: "предметы заводит админ") — в этом учебном году по ней пишут 1674 ученика
--      из 5-го класса, оставлять пустой дальше нельзя.
--
-- Что НЕ трогает (важно для читающего этот файл после факта).
--   - student_results.max_questions/score_percent — сумма/процент по КОНКРЕТНОЙ строке
--     результата, не по конфигу. Это ровно то, что §16 просит оставить: "max_questions — не
--     трогать, это сумма по конкретной работе, она остаётся".
--   - student_result_subject_scores.question_count — колонка уже существовала (024), уже
--     nullable, тип не меняется. Обязательность (NOT NULL по факту) для НОВЫХ строк обеспечена
--     на уровне приложения (computeScoreSummary/processStudentResultsFromExcel бросают ошибку
--     при отсутствии/нуле), а не CHECK constraint — история (строки, где счётчик действительно
--     не был известен на момент импорта, до этой задачи) не переоценивается и не блокируется.
--   - История: строки student_results/student_result_subject_scores за прошлые импорты не
--     пересчитываются этой миграцией. Их level/score_percent — заморожены (§2 ТЗ, п.2),
--     это не задание §16 и не в его границах.
--   - Легаси-колонки student_results.az/math/.../*_count и таблица levels — снос отдельно,
--     миграция 026 (см. шапку 024_student_result_subject_scores.sql), эта миграция её не занимает.
--
-- Прод на момент написания: применены миграции по 025c включительно (025c сама на прод НЕ
-- применена — см. её гейт, к этой миграции отношения не имеет). Два типа экзамена: базовый
-- "Mərkəzləşmiş İmtahan" (секция "1-4 sinif" — 4 предмета с max_questions, секция "5-11 sinif" —
-- пусто) и "Test imtahan növü" (секция "Test bölmə" — 2 предмета с max_questions). После DROP
-- COLUMN числа max_questions обеих секций теряются безвозвратно — это ожидаемо и есть смысл
-- миграции: они больше не нужны, знаменатель считается по работе. pg_dump перед миграцией
-- (apply-pending.sh) — путь отката, если это решение придётся пересматривать.
--
-- Прогон на одноразовом Postgres — см. отчёт по задаче (журнал в IMTAHAN_NOVLERI_TASK.md).

BEGIN;

ALTER TABLE exam_type_section_subjects DROP COLUMN max_questions;
ALTER TABLE exam_types DROP COLUMN has_question_counts;

-- Сеем секцию "5-11 sinif" базового типа. Матчим по grade_from/grade_to, а не только по
-- name_az — структурно это тот же критерий, которым 023 определила эту секцию, и он переживёт
-- переименование секции в UI. ON CONFLICT DO NOTHING — идемпотентность на случай повторного
-- прогона (PRIMARY KEY (section_id, subject_code) в exam_type_section_subjects).
INSERT INTO exam_type_section_subjects (section_id, subject_code, sort_order)
SELECT s.id, v.subject_code, v.sort_order
FROM exam_type_sections s
JOIN exam_types t ON t.id = s.exam_type_id AND t.is_base
CROSS JOIN (VALUES ('az', 1), ('math', 2), ('english', 3)) AS v(subject_code, sort_order)
WHERE s.grade_from = 5 AND s.grade_to = 11
ON CONFLICT (section_id, subject_code) DO NOTHING;

COMMIT;
