-- 010_school_teacher_profile_text_fields.sql
-- Дата: 2026-08-14
-- Задача: заказчик попросил добавить свободные текстовые поля для профилей школ и учителей —
-- первый шаг набора, дальше уточнит что делать с ними на UI (публичная страница школы/учителя?).
-- Все три nullable — заполняются постепенно, не при импорте/создании.

BEGIN;

ALTER TABLE schools ADD COLUMN description text;
ALTER TABLE schools ADD COLUMN history     text;

ALTER TABLE teachers ADD COLUMN biography text;

COMMIT;
