-- 032_reseal_2025_closure_checksums.sql
-- Дата: 2026-10-11
-- Пломба (checksums) 2025/2026 снята авто-закрытием 2026-09-01 03:08 с недосчитанных
-- *_year_ratings: классы повысили 2026-08-03, ручного закрытия с финальным пересчётом не было,
-- авто-закрытие пересчёта не делает (by design). Позже архив был досчитан, и пломба
-- перестала совпадать с содержимым (student_year_ratings: 5476/71221 в пломбе против 5775/74710
-- в таблице; 74710 = сумма баллов student_results за 2025 — архив учеников полный).
-- См. EXAMS_LIVE_TEST_2026-10-11.md.
--
-- Что делает: перезаписывает checksums 2025 текущим содержимым пяти таблиц тем же расчётом,
-- что academicYearClosure.service.pg.ts::computeChecksums (count(*), sum(score)). Сами рейтинги
-- 2025 НЕ пересчитываются и не меняются — они посчитаны по правилам того года (pillə из файла
-- по количеству правильных ответов), пересчёт по нынешней процентной шкале и живым связям после
-- повышения классов их бы исказил. Прежняя пломба сохраняется в note.
--
-- Защита: срабатывает только если в пломбе всё ещё старые 5476/71221 — на базе с другой
-- историей миграция ничего не делает.
BEGIN;
UPDATE academic_year_closures c
SET note = concat_ws(E'\n', c.note,
        'checksums resealed 2026-10-11 (032): original seal was taken before the final recompute; previous: '
        || c.checksums::text),
    checksums = (
        SELECT jsonb_object_agg(t.name, jsonb_build_object('count', t.cnt, 'sumScore', t.sum_score))
        FROM (
            SELECT 'student_year_ratings' AS name, count(*) AS cnt, coalesce(sum(score), 0) AS sum_score FROM student_year_ratings WHERE year = 2025
            UNION ALL SELECT 'teacher_year_ratings', count(*), coalesce(sum(score), 0) FROM teacher_year_ratings WHERE year = 2025
            UNION ALL SELECT 'school_year_ratings', count(*), coalesce(sum(score), 0) FROM school_year_ratings WHERE year = 2025
            UNION ALL SELECT 'district_year_ratings', count(*), coalesce(sum(score), 0) FROM district_year_ratings WHERE year = 2025
            UNION ALL SELECT 'region_year_ratings', count(*), coalesce(sum(score), 0) FROM region_year_ratings WHERE year = 2025
        ) t
    )
WHERE c.academic_year = 2025
  AND (c.checksums -> 'student_year_ratings' ->> 'count')::int = 5476
  AND (c.checksums -> 'student_year_ratings' ->> 'sumScore')::numeric = 71221;
COMMIT;
