-- 016_teacher_pedagogical_experience.sql
-- Дата: 2026-08-25
-- Задача: BASE_FIXES_TASK.md §2.3 — стаж учителя вводится числом лет, не годом начала работы:
-- человек мог работать не непрерывно, и «2011 → сейчас 15 лет» тогда врёт.
--
-- pedagogical_start_year НЕ удаляется (решение пользователя, «вдруг пригодится») — из UI и
-- всех чтений убран, новых записей в него больше не пишем.
--
-- Перенос: год начала → число лет по состоянию на текущий учебный год (2025/2026). Число
-- «протухает» линейно, поэтому при закрытии учебного года всем, у кого поле не NULL,
-- прибавляется +1 (см. academicYearClosure.service.pg.ts, closeManually/ensureFinishedYearsClosed).

BEGIN;

ALTER TABLE teachers ADD COLUMN pedagogical_experience_years int
    CHECK (pedagogical_experience_years IS NULL OR pedagogical_experience_years BETWEEN 0 AND 70);

UPDATE teachers
   SET pedagogical_experience_years = GREATEST(0, 2025 - pedagogical_start_year)
 WHERE pedagogical_start_year IS NOT NULL;

COMMIT;
