-- 020_student_profile_change_requests.sql
-- Дата: 2026-09-05
-- Задача: п.3 ТЗ заказчика от 04.09.2026 — учитель может редактировать ФИО своих учеников,
-- но не напрямую: заявка идёт через ту же очередь модерации, что и у school/teacher/district
-- (profile_change_requests, 017_profile_change_requests.sql). Имя ученика — то, по чему его
-- узнают в рейтингах и сертификатах, тихая правка без следа не годится (согласовано с
-- заказчиком 05.09.2026).
--
-- Расширяем существующий CHECK на entity_type четвёртым значением 'student'. Заявку на такую
-- запись подаёт не сама сущность (у ученика нет своего логина), а его учитель — владение
-- проверяется в коде через students.teacher_id, а не через поле req.user, как у остальных трёх
-- типов; здесь это не меняет ничего в схеме, только в приложении.
--
-- Имя ограничения (profile_change_requests_entity_type_check) — автосгенерированное Postgres
-- для безымянного column-level CHECK из 017_profile_change_requests.sql (стандартное правило
-- именования: <table>_<column>_check). DROP без IF EXISTS — если имя вдруг разойдётся, миграция
-- должна упасть и откатиться (весь файл в одной транзакции), а не молча оставить старое,
-- запрещающее 'student', ограничение висеть рядом с новым.

BEGIN;

ALTER TABLE profile_change_requests DROP CONSTRAINT profile_change_requests_entity_type_check;

ALTER TABLE profile_change_requests
    ADD CONSTRAINT profile_change_requests_entity_type_check
    CHECK (entity_type IN ('school','teacher','district','student'));

COMMIT;
