-- 001b_levels_fk.sql
-- Дата: 05.08.2026
-- Задача: DB_REFACTOR_TASKS.md §2, гейт "мусорные значения level" — закрыт решением пользователя.
--
-- Единственная мусорная запись во всей базе (20 879 результатов): student_results.id=10014
-- (ученик code=1403707018, İsgəndərova Əsra Polad), level='7', total_score=39.
-- По total_score=39 уровень однозначно 'B' (граница 35-41 в levels). Баллы по предметам
-- складываются в total_score корректно (14+11+7+7+0=39) — это не подмена данных, просто
-- в level когда-то попала цифра вместо буквы. Пользователь подтвердил: исправить на 'B'
-- и добавить FK (05.08.2026).

BEGIN;

UPDATE student_results SET level = 'B' WHERE id = 10014 AND level = '7';

ALTER TABLE student_results
    ADD CONSTRAINT student_results_level_fkey FOREIGN KEY (level) REFERENCES levels(code);

COMMIT;
