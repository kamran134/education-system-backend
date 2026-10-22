-- 037_soft_delete.sql
-- Date: 2026-10-23
-- SOFT_DELETE_TASK.md (FIXES_14102026_TASK.md №2, backlog item 3). Decisions of the owner (19.10.2026 / 23.10.2026):
--
-- Students, teachers, schools and districts are no longer deleted for good. A delete hides the entity and its
-- descendants (a "deletion batch" in `deletions`); an admin can bring the whole batch back from the «Silinənlər»
-- section. There is NO permanent delete: the FKs from *_year_ratings are ON DELETE CASCADE, so a hard DELETE would
-- wipe rows of already closed academic years and break the academic_year_closures checksums.
--
-- Mechanics: every one of the four tables is renamed to <name>_all and gets deleted_at / deleted_by / deletion_id;
-- a view with the ORIGINAL name (SELECT * FROM <name>_all WHERE deleted_at IS NULL) takes its place. All existing
-- code and all rating views keep reading `students`, `teachers`, `schools`, `districts` and silently stop seeing
-- hidden rows. Code that needs hidden rows (delete, restore, the «Silinənlər» list, code checks, login) reads *_all.
-- Simple views are auto-updatable in Postgres, so INSERT / UPDATE / DELETE ... RETURNING through them keep working.
--
-- Invariant the rest of the design rests on: a live row never references a hidden one
-- (students.teacher_id/school_id/district_id, teachers.school_id/district_id, schools.district_id). Deleting a parent
-- hides its descendants in the same batch; restoring checks the invariant (deletion.service.pg.ts).
--
-- Consequences worth remembering:
--   * UNIQUE(code) lives on the base table, so a hidden entity still owns its code.
--   * INSERT ... ON CONFLICT (code) DO UPDATE through a view would silently update a HIDDEN row (the conflict is
--     detected on the base table) — importers must read codes from *_all first.
--   * `SELECT *` in a view is expanded at creation time. Any future migration that does
--     ALTER TABLE <x>_all ADD COLUMN must re-create the view <x>, otherwise nobody sees the new column.
--   * After RENAME the existing rating views stay bound to *_all by OID; step 4 re-creates them from their own
--     (dynamically captured) definitions so that they bind to the filtering views instead.
--
-- academic_year_closures and *_year_ratings are not touched.
BEGIN;

-- 1. Deletion batches. One row per delete operation (a bulk delete of students = one batch per student).
--    The row stays after a restore as a journal («who deleted / who restored»).
CREATE TABLE deletions (
    id           bigserial   PRIMARY KEY,
    entity_type  text        NOT NULL CHECK (entity_type IN ('district', 'school', 'teacher', 'student')),
    entity_id    bigint      NOT NULL,                         -- root of the batch; polymorphic, no FK
    deleted_by   bigint      REFERENCES users(id) ON DELETE SET NULL,
    deleted_at   timestamptz NOT NULL DEFAULT now(),
    counts       jsonb       NOT NULL,                         -- {"schools":n,"teachers":n,"students":n,"results":n} at delete time
    restored_at  timestamptz,
    restored_by  bigint      REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX deletions_active_idx ON deletions (deleted_at DESC) WHERE restored_at IS NULL;

-- 2. Capture the definitions of every view that depends DIRECTLY on the four tables, BEFORE renaming
--    (captured dynamically, not copied into this file, so they cannot drift from 025/031/035).
CREATE TEMP TABLE _sd_view_defs ON COMMIT DROP AS
SELECT DISTINCT v.oid::regclass::text AS name,
                regexp_replace(pg_get_viewdef(v.oid), ';\s*$', '') AS def
FROM pg_depend d
JOIN pg_rewrite r ON r.oid = d.objid
JOIN pg_class v ON v.oid = r.ev_class
WHERE d.refobjid IN ('students'::regclass, 'teachers'::regclass, 'schools'::regclass, 'districts'::regclass)
  AND v.relkind = 'v';

CREATE TEMP TABLE _sd_checks ON COMMIT DROP AS
SELECT (SELECT count(*) FROM v_student_places) AS student_places_before,
       (SELECT count(*) FROM students)         AS students_before,
       (SELECT count(*) FROM teachers)         AS teachers_before,
       (SELECT count(*) FROM schools)          AS schools_before,
       (SELECT count(*) FROM districts)        AS districts_before,
       (SELECT count(*) FROM _sd_view_defs)    AS views_captured;

-- 3. Soft-delete columns on the four base tables.
--    deletion_id says "which batch hid this row"; the batch root is the row where
--    (type, id) = (deletions.entity_type, deletions.entity_id), all others in the batch were hidden by cascade.
ALTER TABLE students
    ADD COLUMN deleted_at  timestamptz,
    ADD COLUMN deleted_by  bigint REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN deletion_id bigint REFERENCES deletions(id),
    ADD CONSTRAINT students_deletion_consistent CHECK ((deleted_at IS NULL) = (deletion_id IS NULL));
ALTER TABLE teachers
    ADD COLUMN deleted_at  timestamptz,
    ADD COLUMN deleted_by  bigint REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN deletion_id bigint REFERENCES deletions(id),
    ADD CONSTRAINT teachers_deletion_consistent CHECK ((deleted_at IS NULL) = (deletion_id IS NULL));
ALTER TABLE schools
    ADD COLUMN deleted_at  timestamptz,
    ADD COLUMN deleted_by  bigint REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN deletion_id bigint REFERENCES deletions(id),
    ADD CONSTRAINT schools_deletion_consistent CHECK ((deleted_at IS NULL) = (deletion_id IS NULL));
ALTER TABLE districts
    ADD COLUMN deleted_at  timestamptz,
    ADD COLUMN deleted_by  bigint REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN deletion_id bigint REFERENCES deletions(id),
    ADD CONSTRAINT districts_deletion_consistent CHECK ((deleted_at IS NULL) = (deletion_id IS NULL));

CREATE INDEX students_deletion_id_idx  ON students  (deletion_id) WHERE deletion_id IS NOT NULL;
CREATE INDEX teachers_deletion_id_idx  ON teachers  (deletion_id) WHERE deletion_id IS NOT NULL;
CREATE INDEX schools_deletion_id_idx   ON schools   (deletion_id) WHERE deletion_id IS NOT NULL;
CREATE INDEX districts_deletion_id_idx ON districts (deletion_id) WHERE deletion_id IS NOT NULL;

-- 4. Rename the tables, put the filtering views in their place, re-create the dependent views.
ALTER TABLE students  RENAME TO students_all;
ALTER TABLE teachers  RENAME TO teachers_all;
ALTER TABLE schools   RENAME TO schools_all;
ALTER TABLE districts RENAME TO districts_all;

CREATE VIEW students  AS SELECT * FROM students_all  WHERE deleted_at IS NULL;
CREATE VIEW teachers  AS SELECT * FROM teachers_all  WHERE deleted_at IS NULL;
CREATE VIEW schools   AS SELECT * FROM schools_all   WHERE deleted_at IS NULL;
CREATE VIEW districts AS SELECT * FROM districts_all WHERE deleted_at IS NULL;

COMMENT ON VIEW students  IS 'Live (not deleted) students. Base table: students_all (037_soft_delete.sql). New column on students_all => re-create this view.';
COMMENT ON VIEW teachers  IS 'Live (not deleted) teachers. Base table: teachers_all (037_soft_delete.sql). New column on teachers_all => re-create this view.';
COMMENT ON VIEW schools   IS 'Live (not deleted) schools. Base table: schools_all (037_soft_delete.sql). New column on schools_all => re-create this view.';
COMMENT ON VIEW districts IS 'Live (not deleted) districts. Base table: districts_all (037_soft_delete.sql). New column on districts_all => re-create this view.';

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT name, def FROM _sd_view_defs ORDER BY name LOOP
        EXECUTE format('CREATE OR REPLACE VIEW %s AS %s', r.name, r.def);
    END LOOP;
END $$;

-- 5. Self-check: nothing but the four filtering views may depend on the *_all tables, and the live row counts
--    (and the places view) must be exactly what they were before (nothing is deleted yet).
DO $$
DECLARE
    leaked  text;
    c       record;
    n       bigint;
BEGIN
    SELECT string_agg(DISTINCT v.oid::regclass::text, ', ') INTO leaked
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class v ON v.oid = r.ev_class
    WHERE d.refobjid IN ('students_all'::regclass, 'teachers_all'::regclass, 'schools_all'::regclass, 'districts_all'::regclass)
      AND v.relkind = 'v'
      AND v.relname NOT IN ('students', 'teachers', 'schools', 'districts');
    IF leaked IS NOT NULL THEN
        RAISE EXCEPTION '037 self-check failed: views still bound to *_all: %', leaked;
    END IF;

    SELECT * INTO c FROM _sd_checks;

    SELECT count(*) INTO n FROM v_student_places;
    IF n <> c.student_places_before THEN
        RAISE EXCEPTION '037 self-check failed: v_student_places rows % -> %', c.student_places_before, n;
    END IF;
    SELECT count(*) INTO n FROM students;
    IF n <> c.students_before THEN RAISE EXCEPTION '037 self-check failed: students rows % -> %', c.students_before, n; END IF;
    SELECT count(*) INTO n FROM teachers;
    IF n <> c.teachers_before THEN RAISE EXCEPTION '037 self-check failed: teachers rows % -> %', c.teachers_before, n; END IF;
    SELECT count(*) INTO n FROM schools;
    IF n <> c.schools_before THEN RAISE EXCEPTION '037 self-check failed: schools rows % -> %', c.schools_before, n; END IF;
    SELECT count(*) INTO n FROM districts;
    IF n <> c.districts_before THEN RAISE EXCEPTION '037 self-check failed: districts rows % -> %', c.districts_before, n; END IF;

    -- Every captured view must have been re-created on top of the filtering views.
    SELECT count(DISTINCT v.oid) INTO n
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class v ON v.oid = r.ev_class
    WHERE d.refobjid IN ('students'::regclass, 'teachers'::regclass, 'schools'::regclass, 'districts'::regclass)
      AND v.relkind = 'v'
      AND v.relname NOT IN ('students', 'teachers', 'schools', 'districts');   -- a view's rule depends on the view itself
    IF n <> c.views_captured THEN
        RAISE EXCEPTION '037 self-check failed: % views captured, % now depend on the filtering views', c.views_captured, n;
    END IF;

    RAISE NOTICE '037 self-check OK: % views re-created, v_student_places = % rows, students/teachers/schools/districts = %/%/%/%',
        c.views_captured, c.student_places_before, c.students_before, c.teachers_before, c.schools_before, c.districts_before;
END $$;

COMMIT;
