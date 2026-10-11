-- 031_student_year_scores_single_grade_again.sql
-- Дата: 2026-10-11
-- Регрессия: 025_ratings_by_exam_type.sql пересоздала v_student_year_scores с
-- GROUP BY (student_id, academic_year, exam_type_id, grade) и тем самым потеряла фикс
-- 009_student_year_scores_single_grade.sql. Если у ученика в одном учебном году и одном типе
-- экзамена есть результаты с разным grade (опечатка класса в файле района — в 2024 таких было
-- 5, в 2025 — 40), вьюха отдаёт две строки на (ученик, год, тип), INSERT в student_year_ratings
-- (PK student_id, year, exam_type_id) падает, и «Reytinqləri yenilə» возвращает 500 для всех.
-- Воспроизведено на копии прода 11.10.2026 (EXAMS_LIVE_TEST_2026-10-11.md, проблема №1).
--
-- Фикс — тот же, что в 009: один grade на (student_id, academic_year, exam_type_id), класс из
-- САМОГО ПОЗДНЕГО результата этого года и типа. exam_type_id остаётся осью группировки.
-- Имена, порядок и типы колонок не меняются, поэтому CREATE OR REPLACE без пересоздания
-- зависимых вьюх (v_student_places, v_teacher_year_scores и выше по цепочке).
BEGIN;
CREATE OR REPLACE VIEW v_student_year_scores AS
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
       (array_agg(sr.grade ORDER BY sr.year DESC, sr.month DESC, sr.id DESC))[1] AS grade
FROM student_results sr
WHERE sr.academic_year IS NOT NULL
GROUP BY sr.student_id, sr.academic_year, sr.exam_type_id;
COMMIT;
