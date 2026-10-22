-- 035_average_places_and_district_average.sql
-- Date: 2026-10-22
-- RATING_PLACES_TASK.md (FIXES_14102026_TASK.md №6, backlog item 2). Decisions agreed with the owner on 22.10.2026:
--
-- 1. District average_score is now score / number of students of the district, same as for a region
--    (v_region_year_scores). The legacy Mongo divisor (students_in_district × schools_in_district), which
--    understated the average by a factor of "number of schools", is dropped. District places rank by raw score
--    and are not affected (013_ratings_by_raw_score.sql).
-- 2. Teachers, schools and districts get a second stored place, ranked by average_score:
--    average_place (and average_district_place for teachers and schools). The old place/district_place
--    (by raw score) are untouched. Only entities with score > 0 get a place, as before.
--
-- CREATE OR REPLACE VIEW is legal here: v_district_year_scores keeps the same column names/types/order, and
-- the three *_places views only append new columns at the end. Dependents (v_district_places,
-- v_region_year_scores, v_region_places, the monthly views of 021/025) read only score from the district view
-- or do not read it at all (v_district_month_scores has no average), so they keep working unchanged.
--
-- Archive: district_year_ratings.average_score is recomputed from the stored score and the CURRENT number of
-- students of the district. score itself is NOT touched: academic_year_closures.checksums hold only count(*)
-- and sum(score) per table (academicYearClosure.service.pg.ts computeChecksums), so the seals stay valid.
-- The *_year_ratings average_place columns are not part of the checksums either.
BEGIN;

-- 1. District average: live number of students of the district as divisor.
CREATE OR REPLACE VIEW v_district_year_scores AS
SELECT d.id AS district_id,
       ss.academic_year,
       ss.exam_type_id,
       sum(ss.score) AS score,
       CASE WHEN cnt.students_in_district > 0 THEN sum(ss.score) / cnt.students_in_district ELSE 0 END AS average_score
FROM districts d
JOIN schools sch              ON sch.district_id = d.id
JOIN v_school_year_scores ss  ON ss.school_id = sch.id
CROSS JOIN LATERAL (
    SELECT count(*) AS students_in_district FROM students WHERE district_id = d.id
) cnt
GROUP BY d.id, ss.academic_year, ss.exam_type_id, cnt.students_in_district;

-- 2. Archive: recompute the stored district average (all years, all exam types).
UPDATE district_year_ratings dyr
SET average_score = CASE WHEN n.cnt > 0 THEN dyr.score / n.cnt ELSE 0 END
FROM (
    SELECT d.id AS district_id, (SELECT count(*) FROM students st WHERE st.district_id = d.id) AS cnt
    FROM districts d
) n
WHERE n.district_id = dyr.district_id;

-- 3. New stored columns.
ALTER TABLE teacher_year_ratings  ADD COLUMN average_place int, ADD COLUMN average_district_place int;
ALTER TABLE school_year_ratings   ADD COLUMN average_place int, ADD COLUMN average_district_place int;
ALTER TABLE district_year_ratings ADD COLUMN average_place int;

-- 4. Views: same columns as before + the new ones at the end.
CREATE OR REPLACE VIEW v_teacher_places AS
SELECT ts.teacher_id,
       ts.academic_year,
       ts.exam_type_id,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id ORDER BY ts.score DESC) AS place,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id, t.district_id ORDER BY ts.score DESC) AS district_place,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id ORDER BY ts.average_score DESC) AS average_place,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id, t.district_id ORDER BY ts.average_score DESC) AS average_district_place
FROM v_teacher_year_scores ts
JOIN teachers t ON t.id = ts.teacher_id
WHERE ts.score > 0;

CREATE OR REPLACE VIEW v_school_places AS
SELECT ss.school_id,
       ss.academic_year,
       ss.exam_type_id,
       dense_rank() OVER (PARTITION BY ss.academic_year, ss.exam_type_id ORDER BY ss.score DESC) AS place,
       dense_rank() OVER (PARTITION BY ss.academic_year, ss.exam_type_id, sc.district_id ORDER BY ss.score DESC) AS district_place,
       dense_rank() OVER (PARTITION BY ss.academic_year, ss.exam_type_id ORDER BY ss.average_score DESC) AS average_place,
       dense_rank() OVER (PARTITION BY ss.academic_year, ss.exam_type_id, sc.district_id ORDER BY ss.average_score DESC) AS average_district_place
FROM v_school_year_scores ss
JOIN schools sc ON sc.id = ss.school_id
WHERE ss.score > 0;

CREATE OR REPLACE VIEW v_district_places AS
SELECT ds.district_id,
       ds.academic_year,
       ds.exam_type_id,
       dense_rank() OVER (PARTITION BY ds.academic_year, ds.exam_type_id ORDER BY ds.score DESC) AS place,
       dense_rank() OVER (PARTITION BY ds.academic_year, ds.exam_type_id ORDER BY ds.average_score DESC) AS average_place
FROM v_district_year_scores ds
WHERE ds.score > 0;

-- 5. Backfill the stored places of every existing row (all years, all exam types). Rows without a positive
--    score keep NULL. The district block runs after step 2 (it ranks by the recomputed average).
UPDATE teacher_year_ratings tyr
SET average_place = r.average_place,
    average_district_place = r.average_district_place
FROM (
    SELECT x.teacher_id, x.year, x.exam_type_id,
           dense_rank() OVER (PARTITION BY x.year, x.exam_type_id ORDER BY x.average_score DESC NULLS LAST) AS average_place,
           dense_rank() OVER (PARTITION BY x.year, x.exam_type_id, t.district_id ORDER BY x.average_score DESC NULLS LAST) AS average_district_place
    FROM teacher_year_ratings x
    JOIN teachers t ON t.id = x.teacher_id
    WHERE x.score > 0
) r
WHERE tyr.teacher_id = r.teacher_id AND tyr.year = r.year AND tyr.exam_type_id = r.exam_type_id;

UPDATE school_year_ratings syr
SET average_place = r.average_place,
    average_district_place = r.average_district_place
FROM (
    SELECT x.school_id, x.year, x.exam_type_id,
           dense_rank() OVER (PARTITION BY x.year, x.exam_type_id ORDER BY x.average_score DESC NULLS LAST) AS average_place,
           dense_rank() OVER (PARTITION BY x.year, x.exam_type_id, s.district_id ORDER BY x.average_score DESC NULLS LAST) AS average_district_place
    FROM school_year_ratings x
    JOIN schools s ON s.id = x.school_id
    WHERE x.score > 0
) r
WHERE syr.school_id = r.school_id AND syr.year = r.year AND syr.exam_type_id = r.exam_type_id;

UPDATE district_year_ratings dyr
SET average_place = r.average_place
FROM (
    SELECT x.district_id, x.year, x.exam_type_id,
           dense_rank() OVER (PARTITION BY x.year, x.exam_type_id ORDER BY x.average_score DESC NULLS LAST) AS average_place
    FROM district_year_ratings x
    WHERE x.score > 0
) r
WHERE dyr.district_id = r.district_id AND dyr.year = r.year AND dyr.exam_type_id = r.exam_type_id;

COMMIT;
