-- 009_student_year_scores_single_grade.sql
-- Дата: 2026-08-14
-- Инцидент: 008_student_ranking_uses_historical_grade.sql добавила sr.grade в GROUP BY
-- v_student_year_scores, предполагая один grade на ученика за учебный год. Оказалось — не всегда:
-- у 40 учеников grade в разных результатах ОДНОГО academic_year расходится (реальная грязь в
-- данных, диапазон расхождения от 1 до 3-4 классов — не связано с этой миграцией, существовало
-- и раньше, просто ничего не ломало, пока grade не участвовал в группировке).
-- Следствие: v_student_year_scores отдала 2 строки на (student_id, academic_year) вместо одной,
-- INSERT в student_year_ratings упал на PK (student_id, year), DELETE перед ним уже прошёл —
-- таблица student_year_ratings осталась ПУСТОЙ (не только для затронутых 40, для всех).
--
-- Фикс: один grade на (student_id, academic_year) гарантированно — берём класс из САМОГО
-- ПОЗДНЕГО по дате результата в этом учебном году (array_agg ORDER BY year DESC, month DESC,
-- первый элемент). Не самое строгое решение — таблица student_results не трогается, реальная
-- аномалия остаётся видна для точечного разбора; список 40 id — у пользователя.

BEGIN;

CREATE OR REPLACE VIEW v_student_year_scores AS
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
       (array_agg(sr.grade ORDER BY sr.year DESC, sr.month DESC))[1]    AS grade
FROM student_results sr
WHERE sr.academic_year IS NOT NULL
GROUP BY sr.student_id, sr.academic_year;

COMMIT;
