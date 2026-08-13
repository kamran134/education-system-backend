-- 007_teacher_school_district_place.sql
-- Дата: 2026-08-13
-- Задача: посчитать district_place для учителей и школ — путь B (ранжирование по среднему
-- баллу, db/rating-semantics.md) сознательно не считал его вовсе (v_teacher_places/
-- v_school_places отдавали NULL::bigint константой), а UI-колонка "Şəhər/rayon üzrə yer"
-- есть у учителей и школ и всегда показывала «—». Решение пользователя 13.08.2026: досчитать,
-- той же логикой, что уже работает у учеников (dense_rank в рамках района, v_student_places).
--
-- CREATE OR REPLACE VIEW допустим здесь: district_place остаётся последней колонкой в том же
-- месте и типе (bigint), меняется только его выражение — колонки не переставляются и не пропадают.
--
-- Бэкфилл текущего года НЕ включён в эту миграцию: recomputeTeacherRatings/recomputeSchoolRatings
-- (stats.service.pg.ts) делают DELETE+INSERT из этих же views и уже вызываются обычным
-- "Reytinqləri yenilə" — после этой миграции достаточно нажать её один раз.

BEGIN;

CREATE OR REPLACE VIEW v_teacher_places AS
SELECT ts.teacher_id,
       ts.academic_year,
       dense_rank() OVER (PARTITION BY ts.academic_year ORDER BY ts.average_score DESC) AS place,
       dense_rank() OVER (PARTITION BY ts.academic_year, t.district_id ORDER BY ts.average_score DESC) AS district_place
FROM v_teacher_year_scores ts
JOIN teachers t ON t.id = ts.teacher_id
WHERE ts.average_score > 0;

CREATE OR REPLACE VIEW v_school_places AS
SELECT ss.school_id,
       ss.academic_year,
       dense_rank() OVER (PARTITION BY ss.academic_year ORDER BY ss.average_score DESC) AS place,
       dense_rank() OVER (PARTITION BY ss.academic_year, sc.district_id ORDER BY ss.average_score DESC) AS district_place
FROM v_school_year_scores ss
JOIN schools sc ON sc.id = ss.school_id
WHERE ss.average_score > 0;

COMMIT;
