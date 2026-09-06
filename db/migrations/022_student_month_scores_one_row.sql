-- 022_student_month_scores_one_row.sql
-- Дата: 2026-09-06
-- Задача: чинит v_student_month_scores из 021_monthly_rating_views.sql.
--
-- Что было не так. В 021 `grade` попал в GROUP BY — по аналогии с v_student_year_scores, где он
-- в группировке и это безвредно: годовой путь читает не вьюху, а материализованную
-- student_year_ratings, где строка на (ученик, год) ровно одна. Месячный путь читает вьюху
-- НАПРЯМУЮ и join'ит её к students (student.service.pg.ts::getFilteredStudentsByMonth), поэтому
-- строка обязана быть одна на (ученик, год, месяц). Иначе ученик, у которого в одном
-- календарном месяце два результата с разным grade (два экзамена за месяц, пересдача,
-- поправленный класс), попадал в месячный рейтинг дважды с расщеплённым баллом.
--
-- Почему отдельной миграцией, а не правкой 021. 021 уже отработала на проде: apply-pending.sh
-- сверяется по имени файла через таблицу schema_migrations и повторно её не запустит, так что
-- правка «на месте» изменила бы файл, но не базу — расхождение, которое всплыло бы позже и
-- молча. Файл 021 возвращён к тому виду, в котором он реально выполнился.
--
-- CREATE OR REPLACE VIEW, а не DROP + CREATE: набор и порядок колонок не меняются
-- (student_id, year, month, participation_count, score, grade), поэтому зависимая
-- v_student_month_places переживает замену и пересоздавать её не требуется.
-- grade берётся через min() — детерминированный выбор одного значения; на практике у обоих
-- результатов месяца класс один и тот же, min() нужен лишь чтобы убрать grade из группировки.

BEGIN;

CREATE OR REPLACE VIEW v_student_month_scores AS
SELECT sr.student_id,
       sr.year,
       sr.month,
       count(*)::int                                                    AS participation_count,
       sum(coalesce(sr.participation_score, 0)
         + coalesce(sr.development_score, 0)
         + coalesce(sr.student_of_the_month_score, 0)
         + coalesce(sr.republic_wide_student_of_the_month_score, 0))    AS score,
       min(sr.grade)                                                    AS grade
FROM student_results sr
GROUP BY sr.student_id, sr.year, sr.month;

COMMIT;
