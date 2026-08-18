-- 012_profile_fields.sql
-- Дата: 2026-08-18
-- Задача: PROFILES_TASK.md §2.1 — недостающие поля профильных страниц учителя/школы/района
-- (переделка по ТЗ заказчика). Все nullable — заполняются вручную владельцем или админом,
-- не при импорте.
--
-- pedagogical_start_year хранит год начала пед. работы, а не готовое число лет стажа:
-- число лет устаревает молча с каждым учебным годом, год начала — нет. Отображение
-- "N il" считается на фронте (currentYear - pedagogical_start_year).
--
-- Верхняя граница CHECK — 2100, а не EXTRACT(year FROM now()): CHECK-выражение в Postgres
-- обязано быть immutable, now() в нём запрещён. Верхняя граница "не больше текущего года"
-- валидируется в usecase при сохранении.

BEGIN;

ALTER TABLE teachers ADD COLUMN pedagogical_start_year int
    CHECK (pedagogical_start_year BETWEEN 1950 AND 2100);
ALTER TABLE teachers ADD COLUMN achievements text;

ALTER TABLE schools ADD COLUMN director_name text;
ALTER TABLE schools ADD COLUMN founded_year int
    CHECK (founded_year BETWEEN 1800 AND 2100);
ALTER TABLE schools ADD COLUMN achievements text;

ALTER TABLE districts ADD COLUMN education_head_name text;

COMMIT;
