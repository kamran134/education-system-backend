-- 013_ratings_by_raw_score.sql
-- Дата: 2026-08-20
-- Задача: заказчик уточнил требование из db/rating-semantics.md (решение 04.08.2026) — все
-- рейтинги мест (İlin müəllimləri/məktəbləri/rayonları, регионы), КРОМЕ İnkişaf (отдельный
-- помесячный механизм markDevelopingStudents, эту миграцию не затрагивает), должны считаться
-- по сырому score, а не по среднему баллу. "Путь B по average_score" было неверным пониманием
-- требования заказчика, а не его решением. Ученики (v_student_places) уже считались по score —
-- не трогаются.
--
-- CREATE OR REPLACE VIEW допустим здесь: набор и порядок колонок не меняется, меняется только
-- выражение place/district_place и фильтр WHERE (тот же приём, что в 007).
--
-- Бэкфилл текущего года НЕ включён: recomputeTeacherRatings/recomputeSchoolRatings/
-- recomputeDistrictRatings/recomputeRegionRatings (stats.service.pg.ts) делают DELETE+INSERT
-- из этих же views и уже вызываются обычным "Reytinqləri yenilə" — после этой миграции
-- достаточно нажать её один раз для 2025/2026.

BEGIN;

CREATE OR REPLACE VIEW v_teacher_places AS
SELECT ts.teacher_id,
       ts.academic_year,
       dense_rank() OVER (PARTITION BY ts.academic_year ORDER BY ts.score DESC) AS place,
       dense_rank() OVER (PARTITION BY ts.academic_year, t.district_id ORDER BY ts.score DESC) AS district_place
FROM v_teacher_year_scores ts
JOIN teachers t ON t.id = ts.teacher_id
WHERE ts.score > 0;

CREATE OR REPLACE VIEW v_school_places AS
SELECT ss.school_id,
       ss.academic_year,
       dense_rank() OVER (PARTITION BY ss.academic_year ORDER BY ss.score DESC) AS place,
       dense_rank() OVER (PARTITION BY ss.academic_year, sc.district_id ORDER BY ss.score DESC) AS district_place
FROM v_school_year_scores ss
JOIN schools sc ON sc.id = ss.school_id
WHERE ss.score > 0;

CREATE OR REPLACE VIEW v_district_places AS
SELECT ds.district_id,
       ds.academic_year,
       dense_rank() OVER (PARTITION BY ds.academic_year ORDER BY ds.score DESC) AS place
FROM v_district_year_scores ds
WHERE ds.score > 0;

CREATE OR REPLACE VIEW v_region_places AS
SELECT rs.region_id,
       rs.academic_year,
       dense_rank() OVER (PARTITION BY rs.academic_year ORDER BY rs.score DESC) AS place
FROM v_region_year_scores rs
WHERE rs.score > 0;

COMMIT;
