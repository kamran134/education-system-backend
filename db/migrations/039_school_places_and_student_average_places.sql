-- 039_school_places_and_student_average_places.sql
-- Date: 2026-10-24
-- Owner's decision 24.10.2026 (teachers could not find their own place among the rating columns): the
-- fullscreen view of the yearly /stats tabs shows only name, scores and places, each place by ümumi and by
-- orta xal. The places that were missing get stored next to the existing ones:
--
--   student_year_ratings: average_place, average_district_place, school_place, average_school_place
--   teacher_year_ratings: school_place, average_school_place
--   region_year_ratings:  average_place
--
-- Schools and districts already have everything (035). Same rules as the existing places: dense rank, students
-- within their grade, teachers / schools / districts / regions only with score > 0. "Filtr üzrə yer" is not
-- stored, it stays computed on read.
--
-- CREATE OR REPLACE VIEW is legal: the three *_places views keep their columns and only append new ones, and
-- nothing depends on them except the recompute in stats.service.pg.ts.
--
-- Archive: only the new columns are filled; score, average_score and the old places are NOT touched, and no
-- row is added or removed. academic_year_closures.checksums hold only count(*) and sum(score) per table, so
-- the seal of 2025/2026 stays valid. Unlike the live views (current links, like the existing district_place),
-- the archive backfill takes grade / school / district of a student and the school of a teacher from the
-- student's latest result of that year (the result snapshot of 038): it is where the points were earned, and
-- a later transfer or promotion must not regroup a closed year.
BEGIN;

-- 1. New stored columns.
ALTER TABLE student_year_ratings
    ADD COLUMN average_place int,
    ADD COLUMN average_district_place int,
    ADD COLUMN school_place int,
    ADD COLUMN average_school_place int;
ALTER TABLE teacher_year_ratings
    ADD COLUMN school_place int,
    ADD COLUMN average_school_place int;
ALTER TABLE region_year_ratings
    ADD COLUMN average_place int;

-- 2. Views: same columns as before + the new ones at the end.
CREATE OR REPLACE VIEW v_student_places AS
SELECT sc.student_id,
       sc.academic_year,
       sc.exam_type_id,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.exam_type_id, sc.grade ORDER BY sc.score DESC) AS place,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.exam_type_id, sc.grade, s.district_id ORDER BY sc.score DESC) AS district_place,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.exam_type_id, sc.grade ORDER BY sc.average_score DESC) AS average_place,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.exam_type_id, sc.grade, s.district_id ORDER BY sc.average_score DESC) AS average_district_place,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.exam_type_id, sc.grade, s.school_id ORDER BY sc.score DESC) AS school_place,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.exam_type_id, sc.grade, s.school_id ORDER BY sc.average_score DESC) AS average_school_place
FROM v_student_year_scores sc
JOIN students s ON s.id = sc.student_id;

CREATE OR REPLACE VIEW v_teacher_places AS
SELECT ts.teacher_id,
       ts.academic_year,
       ts.exam_type_id,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id ORDER BY ts.score DESC) AS place,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id, t.district_id ORDER BY ts.score DESC) AS district_place,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id ORDER BY ts.average_score DESC) AS average_place,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id, t.district_id ORDER BY ts.average_score DESC) AS average_district_place,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id, t.school_id ORDER BY ts.score DESC) AS school_place,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id, t.school_id ORDER BY ts.average_score DESC) AS average_school_place
FROM v_teacher_year_scores ts
JOIN teachers t ON t.id = ts.teacher_id
WHERE ts.score > 0;

CREATE OR REPLACE VIEW v_region_places AS
SELECT rs.region_id,
       rs.academic_year,
       rs.exam_type_id,
       dense_rank() OVER (PARTITION BY rs.academic_year, rs.exam_type_id ORDER BY rs.score DESC) AS place,
       dense_rank() OVER (PARTITION BY rs.academic_year, rs.exam_type_id ORDER BY rs.average_score DESC) AS average_place
FROM v_region_year_scores rs
WHERE rs.score > 0;

-- 3. Backfill the new columns of every existing row (all years, all exam types) from the stored scores.
--    The latest result of the year: same ordering as the grade in v_student_year_scores.
UPDATE student_year_ratings syr
SET average_place = r.average_place,
    average_district_place = r.average_district_place,
    school_place = r.school_place,
    average_school_place = r.average_school_place
FROM (
    SELECT x.student_id, x.year, x.exam_type_id,
           dense_rank() OVER (PARTITION BY x.year, x.exam_type_id, lr.grade ORDER BY x.average_score DESC NULLS LAST) AS average_place,
           dense_rank() OVER (PARTITION BY x.year, x.exam_type_id, lr.grade, lr.district_id ORDER BY x.average_score DESC NULLS LAST) AS average_district_place,
           dense_rank() OVER (PARTITION BY x.year, x.exam_type_id, lr.grade, lr.school_id ORDER BY x.score DESC NULLS LAST) AS school_place,
           dense_rank() OVER (PARTITION BY x.year, x.exam_type_id, lr.grade, lr.school_id ORDER BY x.average_score DESC NULLS LAST) AS average_school_place
    FROM student_year_ratings x
    JOIN LATERAL (
        SELECT sr.grade, sr.school_id, sr.district_id
        FROM student_results sr
        WHERE sr.student_id = x.student_id AND sr.academic_year = x.year AND sr.exam_type_id = x.exam_type_id
        ORDER BY sr.year DESC, sr.month DESC, sr.id DESC
        LIMIT 1
    ) lr ON true
) r
WHERE syr.student_id = r.student_id AND syr.year = r.year AND syr.exam_type_id = r.exam_type_id;

UPDATE teacher_year_ratings tyr
SET school_place = r.school_place,
    average_school_place = r.average_school_place
FROM (
    SELECT x.teacher_id, x.year, x.exam_type_id,
           dense_rank() OVER (PARTITION BY x.year, x.exam_type_id, lr.school_id ORDER BY x.score DESC NULLS LAST) AS school_place,
           dense_rank() OVER (PARTITION BY x.year, x.exam_type_id, lr.school_id ORDER BY x.average_score DESC NULLS LAST) AS average_school_place
    FROM teacher_year_ratings x
    JOIN LATERAL (
        SELECT sr.school_id
        FROM student_results sr
        WHERE sr.teacher_id = x.teacher_id AND sr.academic_year = x.year AND sr.exam_type_id = x.exam_type_id
        ORDER BY sr.year DESC, sr.month DESC, sr.id DESC
        LIMIT 1
    ) lr ON true
    WHERE x.score > 0
) r
WHERE tyr.teacher_id = r.teacher_id AND tyr.year = r.year AND tyr.exam_type_id = r.exam_type_id;

UPDATE region_year_ratings ryr
SET average_place = r.average_place
FROM (
    SELECT x.region_id, x.year, x.exam_type_id,
           dense_rank() OVER (PARTITION BY x.year, x.exam_type_id ORDER BY x.average_score DESC NULLS LAST) AS average_place
    FROM region_year_ratings x
    WHERE x.score > 0
) r
WHERE ryr.region_id = r.region_id AND ryr.year = r.year AND ryr.exam_type_id = r.exam_type_id;

COMMIT;
