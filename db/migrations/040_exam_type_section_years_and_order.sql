-- 040_exam_type_section_years_and_order.sql
-- Date: 2026-10-29
-- Owner's request 29.10.2026: the base type had "1-4 sinif" / "5-11 sinif"; from 2026/2027 grade 4 sits a
-- separate two-subject exam, so the sections become 1-3 / 4 / 5-8. Narrowing "1-4 sinif" was refused (409):
-- 4359 results of grade 4 (2024/2025, 2025/2026 and 21 of October 2026) are filed under it.
--
-- Sections get an academic-year validity window instead of being rewritten in place:
--
--   from_year / to_year  — academic years (start year, as student_results.academic_year) the section is in force,
--                          both inclusive, NULL = unbounded. Existing sections stay NULL/NULL (always in force).
--   sort_order           — order in the exam-type editor and every section list (drag and drop), was grade_from.
--
-- A section that has results from past academic years is never changed in grades or subjects: the editor's
-- change archives it (to_year = current year - 1, keeps id, name, subjects and every result pointing at it) and
-- creates a new section from the current year (examType.service.pg.ts::upsertSections). Results of the current
-- year move to the new section that covers their grade. So a re-upload or an edit of a 2025/2026 result still
-- resolves its section by (type, grade, year of the exam) to the config that was in force then.
--
-- Ratings do not read sections at all (*_year_ratings and the v_* views have no section_id), so nothing here
-- touches the archive or the seal of 2025/2026.
BEGIN;

ALTER TABLE exam_type_sections
    ADD COLUMN from_year  int,
    ADD COLUMN to_year    int,
    ADD COLUMN sort_order int NOT NULL DEFAULT 0,
    ADD CONSTRAINT exam_type_sections_years_check CHECK (from_year IS NULL OR to_year IS NULL OR from_year <= to_year);

-- Keep the order the editor showed so far (by grade_from).
UPDATE exam_type_sections s
SET sort_order = o.rn
FROM (
    SELECT id, row_number() OVER (PARTITION BY exam_type_id ORDER BY grade_from, id) - 1 AS rn
    FROM exam_type_sections
) o
WHERE o.id = s.id;

-- Grade ranges may now overlap across years, not within one. int4range(NULL, x) / int4range(x, NULL) is unbounded
-- on that side, and to_year + 1 stays NULL for an open section — so NULL/NULL meets every year.
ALTER TABLE exam_type_sections DROP CONSTRAINT exam_type_sections_exam_type_id_int4range_excl;
ALTER TABLE exam_type_sections
    ADD CONSTRAINT exam_type_sections_grades_years_excl EXCLUDE USING gist (
        exam_type_id WITH =,
        int4range(grade_from, grade_to + 1) WITH &&,
        int4range(from_year, to_year + 1) WITH &&
    );

COMMIT;
