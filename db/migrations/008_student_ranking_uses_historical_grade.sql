-- 008_student_ranking_uses_historical_grade.sql
-- Дата: 2026-08-14
-- Задача: v_student_places группировала место/districtPlace ученика по ЖИВОМУ students.grade —
-- при массовом повышении класса (Yeni tədris ili) это задним числом ломает уже посчитанные места
-- за ПРОШЕДШИЙ учебный год: третьеклассник, весь год соревновавшийся с третьеклассниками,
-- после повышения в 4 класс при пересчёте рейтинга внезапно ранжируется среди четвероклассников.
-- score/averageScore не страдают (не зависят от класса) — только place/districtPlace.
--
-- student_results.grade УЖЕ хранит исторический класс на момент конкретного результата — просто
-- v_student_places его не использовал. Один ученик получает один и тот же grade во всех своих
-- результатах за один academic_year (класс меняется только раз в год, на повышении) — поэтому
-- GROUP BY sr.grade безопасно добавить в v_student_year_scores, не размножая строки.
--
-- CREATE OR REPLACE VIEW: у v_student_year_scores новая колонка добавлена в конец SELECT —
-- допустимо. У v_student_places состав колонок не меняется, меняется только источник grade
-- в PARTITION BY — тоже допустимо.

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
       sr.grade                                                         AS grade
FROM student_results sr
WHERE sr.academic_year IS NOT NULL
GROUP BY sr.student_id, sr.academic_year, sr.grade;

CREATE OR REPLACE VIEW v_student_places AS
SELECT sc.student_id,
       sc.academic_year,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.grade
                          ORDER BY sc.score DESC)                AS place,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.grade, s.district_id
                          ORDER BY sc.score DESC)                AS district_place
FROM v_student_year_scores sc
JOIN students s ON s.id = sc.student_id;

COMMIT;
