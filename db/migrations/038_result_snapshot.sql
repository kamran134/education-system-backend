-- 038_result_snapshot.sql
-- Date: 2026-10-23
-- TRANSFERS_TASK.md (FIXES_14102026_TASK.md №3-5). Decisions of the owner (19.10.2026, forks 0.1-0.3 settled 23.10.2026):
--
-- Points stay with the teacher, the school and the district where the student SAT the exam. When a teacher moves to
-- another school or a student moves to another teacher, past results must not follow them.
--
-- Until now the teacher / school / district sums walked the CURRENT links (student -> teacher -> school -> district),
-- so any move silently re-attributed all earlier points. Now every student_results row carries a snapshot
-- (teacher_id, school_id, district_id) taken when the result was written, and the teacher / school / district
-- views aggregate by that snapshot. The region stays a sum of its districts (a district belongs to a region by its
-- current link, there is no region snapshot).
--
-- Snapshot semantics:
--   * Taken by a BEFORE INSERT trigger from the CURRENT chain student -> teacher -> teacher's school -> school's
--     district (the same chain the old views walked, NOT students.school_id / district_id), so every insert path
--     (Excel import, manual create, future ones) gets it from a single place.
--   * A re-upload of the same exam (INSERT ... ON CONFLICT (student_id, exam_id) DO UPDATE) does not touch the
--     snapshot of the existing row: it is an edit of the same exam, written when the student sat it under the old teacher.
--   * Existing rows are back-filled from the current links; for closed years that is the best source there is.
--     The archive tables *_year_ratings are not affected.
--
-- Liveness (soft delete, 037): a result counts at level X if the student is alive and every entity of the snapshot
-- from the teacher up to X is alive. For rows that never moved this is exactly what the old views counted.
--
-- Column types of the views are kept (double precision sums), so CREATE OR REPLACE VIEW works and the *_places views
-- and everything built on them stay untouched. Step 2 captures every affected view before the replacement, step 6
-- compares after it: a back-filled snapshot repeats the current links, so the output must be identical.
--
-- academic_year_closures and *_year_ratings are not touched.
BEGIN;

-- 1. Capture the current content of every affected view (dynamic, so it cannot drift from 025/031/035/037).
CREATE TEMP TABLE _sn_views (name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _sn_views (name) VALUES
    ('v_teacher_year_scores'), ('v_school_year_scores'), ('v_district_year_scores'), ('v_region_year_scores'),
    ('v_teacher_places'),      ('v_school_places'),      ('v_district_places'),      ('v_region_places'),
    ('v_teacher_month_scores'), ('v_school_month_scores'), ('v_district_month_scores'), ('v_region_month_scores');

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT name FROM _sn_views ORDER BY name LOOP
        EXECUTE format('CREATE TEMP TABLE %I ON COMMIT DROP AS SELECT * FROM %I', '_sn_before_' || r.name, r.name);
    END LOOP;
END $$;

-- 2. Snapshot columns and back-fill from the CURRENT links, exactly the chain the old views walk:
--    student -> teacher -> teacher's school -> school's district. *_all, not the views: results of hidden
--    students get a snapshot too. Nullable: students.teacher_id and teachers.school_id may be NULL.
ALTER TABLE student_results
    ADD COLUMN teacher_id  bigint REFERENCES teachers_all(id)  ON DELETE SET NULL,
    ADD COLUMN school_id   bigint REFERENCES schools_all(id)   ON DELETE SET NULL,
    ADD COLUMN district_id bigint REFERENCES districts_all(id) ON DELETE SET NULL;

UPDATE student_results sr
SET teacher_id = s.teacher_id, school_id = t.school_id, district_id = sc.district_id
FROM students_all s
LEFT JOIN teachers_all t ON t.id = s.teacher_id
LEFT JOIN schools_all sc ON sc.id = t.school_id
WHERE s.id = sr.student_id;

CREATE INDEX student_results_teacher_year_idx  ON student_results (teacher_id, academic_year);
CREATE INDEX student_results_school_year_idx   ON student_results (school_id, academic_year);
CREATE INDEX student_results_district_year_idx ON student_results (district_id, academic_year);

COMMENT ON COLUMN student_results.teacher_id  IS 'Snapshot (038): the student''s teacher when the result was written. Rating views aggregate by it.';
COMMENT ON COLUMN student_results.school_id   IS 'Snapshot (038): the school of that teacher when the result was written.';
COMMENT ON COLUMN student_results.district_id IS 'Snapshot (038): the district of that school when the result was written.';

-- 3. Trigger: one source of truth for the snapshot on every insert path.
--    INSERT: filled only when the caller supplied none of the three (an explicit snapshot, e.g. a restore, is kept).
--    UPDATE OF student_id: a result re-assigned to another student is snapshotted again from the new student.
--    Other updates (including ON CONFLICT DO UPDATE of a re-uploaded exam) leave the snapshot alone.
CREATE FUNCTION student_results_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.teacher_id IS NOT NULL OR NEW.school_id IS NOT NULL OR NEW.district_id IS NOT NULL THEN
            RETURN NEW;
        END IF;
    ELSIF NEW.student_id IS NOT DISTINCT FROM OLD.student_id THEN
        RETURN NEW;
    END IF;

    SELECT s.teacher_id, t.school_id, sc.district_id
    INTO NEW.teacher_id, NEW.school_id, NEW.district_id
    FROM students_all s
    LEFT JOIN teachers_all t ON t.id = s.teacher_id
    LEFT JOIN schools_all sc ON sc.id = t.school_id
    WHERE s.id = NEW.student_id;

    RETURN NEW;
END $$;

CREATE TRIGGER student_results_snapshot_ins
    BEFORE INSERT ON student_results
    FOR EACH ROW EXECUTE FUNCTION student_results_snapshot();

CREATE TRIGGER student_results_snapshot_upd
    BEFORE UPDATE OF student_id ON student_results
    FOR EACH ROW EXECUTE FUNCTION student_results_snapshot();

-- 4. Points of one result: the same four-term expression as v_student_year_scores / v_student_month_scores.
--    Helper for the six views below; carries the snapshot and the period.
CREATE VIEW v_result_points AS
SELECT sr.student_id,
       sr.teacher_id,
       sr.school_id,
       sr.district_id,
       sr.academic_year,
       sr.year,
       sr.month,
       sr.exam_type_id,
       coalesce(sr.participation_score, 0)
         + coalesce(sr.development_score, 0)
         + coalesce(sr.student_of_the_month_score, 0)
         + coalesce(sr.republic_wide_student_of_the_month_score, 0) AS points
FROM student_results sr;

-- 5. The views, by snapshot. Column names, types and order are those of 025/035/037.
-- 5.1 Year chain: teacher, school, district straight from the results (not each level from the one below).
--     Averages as before: teacher / teachers.student_count, school / schools.student_count, district / live students.
CREATE OR REPLACE VIEW v_teacher_year_scores AS
SELECT t.id AS teacher_id,
       r.academic_year,
       r.exam_type_id,
       sum(r.points) AS score,
       CASE WHEN t.student_count > 0 THEN sum(r.points) / t.student_count ELSE 0 END AS average_score
FROM v_result_points r
JOIN students s ON s.id = r.student_id
JOIN teachers t ON t.id = r.teacher_id
WHERE r.academic_year IS NOT NULL
GROUP BY t.id, t.student_count, r.academic_year, r.exam_type_id;

CREATE OR REPLACE VIEW v_school_year_scores AS
SELECT sch.id AS school_id,
       r.academic_year,
       r.exam_type_id,
       sum(r.points) AS score,
       CASE WHEN sch.student_count > 0 THEN sum(r.points) / sch.student_count ELSE 0 END AS average_score
FROM v_result_points r
JOIN students s   ON s.id   = r.student_id
JOIN teachers t   ON t.id   = r.teacher_id
JOIN schools sch  ON sch.id = r.school_id
WHERE r.academic_year IS NOT NULL
GROUP BY sch.id, sch.student_count, r.academic_year, r.exam_type_id;

CREATE OR REPLACE VIEW v_district_year_scores AS
SELECT d.id AS district_id,
       r.academic_year,
       r.exam_type_id,
       sum(r.points) AS score,
       CASE WHEN cnt.students_in_district > 0 THEN sum(r.points) / cnt.students_in_district ELSE 0 END AS average_score
FROM v_result_points r
JOIN students s   ON s.id   = r.student_id
JOIN teachers t   ON t.id   = r.teacher_id
JOIN schools sch  ON sch.id = r.school_id
JOIN districts d  ON d.id   = r.district_id
CROSS JOIN LATERAL (
    SELECT count(*) AS students_in_district FROM students WHERE district_id = d.id
) cnt
WHERE r.academic_year IS NOT NULL
GROUP BY d.id, r.academic_year, r.exam_type_id, cnt.students_in_district;

-- 5.2 Month chain (no academic_year filter, as before).
CREATE OR REPLACE VIEW v_teacher_month_scores AS
SELECT t.id AS teacher_id,
       r.year,
       r.month,
       r.exam_type_id,
       sum(r.points) AS score
FROM v_result_points r
JOIN students s ON s.id = r.student_id
JOIN teachers t ON t.id = r.teacher_id
GROUP BY t.id, r.year, r.month, r.exam_type_id;

CREATE OR REPLACE VIEW v_school_month_scores AS
SELECT sch.id AS school_id,
       r.year,
       r.month,
       r.exam_type_id,
       sum(r.points) AS score
FROM v_result_points r
JOIN students s   ON s.id   = r.student_id
JOIN teachers t   ON t.id   = r.teacher_id
JOIN schools sch  ON sch.id = r.school_id
GROUP BY sch.id, r.year, r.month, r.exam_type_id;

CREATE OR REPLACE VIEW v_district_month_scores AS
SELECT d.id AS district_id,
       r.year,
       r.month,
       r.exam_type_id,
       sum(r.points) AS score
FROM v_result_points r
JOIN students s   ON s.id   = r.student_id
JOIN teachers t   ON t.id   = r.teacher_id
JOIN schools sch  ON sch.id = r.school_id
JOIN districts d  ON d.id   = r.district_id
GROUP BY d.id, r.year, r.month, r.exam_type_id;

-- 6. Self-check: every affected view must return exactly what it returned before (both directions), and no
--    result of a student that has a teacher may be left without a teacher snapshot.
DO $$
DECLARE
    r        record;
    lost     bigint;
    gained   bigint;
    n        bigint;
    total    bigint := 0;
    orphans  bigint;
    snapshot bigint;
BEGIN
    FOR r IN SELECT name FROM _sn_views ORDER BY name LOOP
        EXECUTE format('SELECT count(*) FROM (SELECT * FROM %I EXCEPT SELECT * FROM %I) x',
                       '_sn_before_' || r.name, r.name) INTO lost;
        EXECUTE format('SELECT count(*) FROM (SELECT * FROM %I EXCEPT SELECT * FROM %I) x',
                       r.name, '_sn_before_' || r.name) INTO gained;
        IF lost <> 0 OR gained <> 0 THEN
            RAISE EXCEPTION '038 self-check failed: % differs from the pre-migration content (% rows lost, % rows new)',
                r.name, lost, gained;
        END IF;
        EXECUTE format('SELECT count(*) FROM %I', r.name) INTO n;
        total := total + n;
    END LOOP;

    SELECT count(*) INTO orphans
    FROM student_results sr
    JOIN students_all s ON s.id = sr.student_id
    WHERE s.teacher_id IS NOT NULL AND sr.teacher_id IS NULL;
    IF orphans <> 0 THEN
        RAISE EXCEPTION '038 self-check failed: % results of students with a teacher have no teacher snapshot', orphans;
    END IF;

    SELECT count(*) INTO snapshot FROM student_results WHERE teacher_id IS NOT NULL;
    SELECT count(*) INTO n FROM student_results;

    RAISE NOTICE '038 self-check OK: % views identical to the pre-migration content (% rows compared), snapshot set on %/% results',
        (SELECT count(*) FROM _sn_views), total, snapshot, n;
END $$;

COMMIT;
