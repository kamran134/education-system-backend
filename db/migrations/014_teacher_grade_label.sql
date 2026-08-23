-- 014_teacher_grade_label.sql
-- Дата: 2026-08-24
-- Задача: PROFILES_V3_TASK.md §2 — класс учителя вводится вручную.
-- Текст, а не int/int[]: учитель ведёт «5-ci sinif», «5–6-cı siniflər» или «7A, 7B» —
-- любая числовая схема ломается на первом же таком случае. Автоматический расчёт из
-- классов учеников (attachProfileCounts → grades[]) остаётся нетронутым, см. §5.

BEGIN;

ALTER TABLE teachers ADD COLUMN grade_label text
    CHECK (grade_label IS NULL OR char_length(btrim(grade_label)) BETWEEN 1 AND 40);

COMMIT;
