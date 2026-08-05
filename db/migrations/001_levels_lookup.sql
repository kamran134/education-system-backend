-- 001_levels_lookup.sql
-- Дата: 05.08.2026
-- Задача: DB_REFACTOR_TASKS.md §2 (справочник уровней)
--
-- Зачем: семантика уровня продублирована в коде четырежды (calculateLevel,
-- calculateLevelNumb, ParticipationScoreMap, SQL CASE в stats/examResults) и нигде
-- не проверяется на уровне БД. student_results.level — text без ограничений.
--
-- ВАЖНО: FK student_results.level -> levels(code) в этой миграции НЕ добавляется.
-- В проде уже есть мусорные значения level (минимум '7'), гейт по ним требует решения
-- пользователя (см. DB_REFACTOR_TASKS.md §2, "Гейт: мусорные значения level").
-- FK будет добавлен отдельной миграцией после решения по мусору.

BEGIN;

CREATE TABLE levels (
    code                text PRIMARY KEY,              -- 'E','D','C','B','A','Lisey'
    name_az             text NOT NULL,
    rank                int  NOT NULL UNIQUE,           -- 1..6, порядок силы уровня (бывш. calculateLevelNumb)
    participation_score double precision NOT NULL,      -- бывш. ParticipationScoreMap
    min_total_score     int  NOT NULL,                  -- нижняя граница total_score включительно (бывш. calculateLevel)
    max_total_score     int,                             -- верхняя граница включительно, NULL = без предела
    active              boolean NOT NULL DEFAULT true
);

-- Наполнение — 1:1 из common.service.ts calculateLevel/calculateLevelNumb
-- и types/participation.types.ts ParticipationScoreMap. Ничего не изобретено.
INSERT INTO levels (code, name_az, rank, participation_score, min_total_score, max_total_score) VALUES
    ('E',     'E',     1, 1, 0,  15),
    ('D',     'D',     2, 2, 16, 25),
    ('C',     'C',     3, 3, 26, 34),
    ('B',     'B',     4, 4, 35, 41),
    ('A',     'A',     5, 5, 42, 46),
    ('Lisey', 'Lisey', 6, 6, 47, NULL);

COMMIT;
