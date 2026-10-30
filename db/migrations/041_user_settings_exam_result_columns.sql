-- 041_user_settings_exam_result_columns.sql
-- Date: 2026-10-30
-- Customer fix 29.10.2026 p.3 (DUZELISLER_2026-10-29_TASK.md, G2): admins choose the /exam-results columns for
-- every role (user_settings.role_settings -> examResults), but not for themselves. The admin's own column sets
-- live in the per-user text[] columns of user_settings (all_student_collumns, ...), so the exam-results set goes
-- next to them. The misspelling "collumns" is kept on purpose: it is how the frontend names every such field.
--
-- Empty array = no own choice: /exam-results then shows its default column order, same as before this
-- migration. ADD COLUMN with a constant default only touches the catalog (no table rewrite) and every existing
-- row reads '{}', so nothing changes for anyone until an admin saves the new tab. Safe to re-run.
BEGIN;

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS exam_result_collumns text[] NOT NULL DEFAULT '{}';

COMMIT;
