-- 021_monthly_rating_views.sql
-- Дата: 2026-09-06
-- Задача: п.10 ТЗ заказчика от 04.09.2026 — «Bütün akkauntlarda Reytinqlərdə ay filtri əlavə
-- edək və həmin ay üzrə ən çox reytinq xalı toplayan Şagirləri, müəllimləri, məktəbləri,
-- təhsil sektorlarını və regional təhsil idarələrini müəyyənləşdirə bilək».
-- Разбор и принятые решения: MONTHLY_RATINGS_TASK.md.
--
-- Зачем новая цепочка вьюх. Вся существующая цепочка рейтинга сгруппирована по
-- student_results.academic_year (v_student_year_scores → v_teacher_year_scores →
-- v_school_year_scores → v_district_year_scores → v_region_year_scores + *_places), и месячного
-- среза выше уровня ученика нет нигде. Здесь — точная параллель тех же вьюх, но с группировкой
-- по КАЛЕНДАРНОЙ паре (year, month): именно её присылает фронт строкой «YYYY-MM», и именно она,
-- в отличие от academic_year, определена для июля и августа.
--
-- Годовые вьюхи НЕ ТРОГАЮТСЯ. Годовой путь обязан остаться байт-в-байт прежним: месячный срез —
-- дополнительный режим чтения, а не замена.
--
-- Материализации нет намеренно. Годовые цифры читаются из *_year_ratings, которые заполняет
-- recompute*Ratings; повторить это для месяцев значило бы завести ещё 5 таблиц × 10 месяцев и
-- вторую точку, где данные протухают. Данных за один месяц мало (результаты одного экзамена по
-- республике), а прецедент расчёта ранга прямо в запросе уже есть — filterPlace в
-- stats.service.pg.ts. Если когда-нибудь упрётся в скорость — это повод для индексов или
-- materialized view, а не для копирования схемы *_year_ratings.
--
-- Среднего балла (average_score) в месячном срезе нет НИ НА ОДНОМ уровне. Делитель годовых
-- средних — сохранённое teachers.student_count / schools.student_count (а у района ещё и
-- легаси-ошибка «ученики × школы», см. v_district_year_scores). За один месяц такой делитель
-- заведомо неверен, а показанное число кто-нибудь неизбежно прочтёт как настоящее. Заказчик
-- просил «кто набрал больше всего баллов за месяц» — это про сырой балл.
--
-- Места считаются по той же логике, что годовые (решение 20.08.2026,
-- 013_ratings_by_raw_score.sql): dense_rank по сырому score. Учителя/школы/районы/регионы с
-- score = 0 места не получают, у учеников фильтра «> 0» нет — ровно как в годовых вьюхах.
-- Две разные логики мест на соседних вкладках одного экрана породили бы вопросы вида «почему
-- у меня 3-е место за год и 5-е за октябрь при том же балле».

BEGIN;

-- ============================================================ ученик

-- Копия v_student_year_scores с группировкой по (year, month) вместо academic_year.
-- grade — исторический, из student_results (как в 008_student_ranking_uses_historical_grade.sql):
-- массовое повышение класса не должно задним числом менять уже посчитанный месяц.
--
-- ИСПРАВЛЕНО ПОЗЖЕ: см. 022_student_month_scores_one_row.sql — grade здесь оставлен в GROUP BY,
-- из-за чего ученик с двумя результатами в одном календарном месяце и разным grade попадал в
-- месячный рейтинг дважды с расщеплённым баллом. Этот файл НЕ правится задним числом: он уже
-- отработал на проде (apply-pending.sh сверяется по имени файла и повторно его не запустит),
-- и содержимое обязано соответствовать тому, что реально выполнилось.
CREATE VIEW v_student_month_scores AS
SELECT sr.student_id,
       sr.year,
       sr.month,
       count(*)::int                                                    AS participation_count,
       sum(coalesce(sr.participation_score, 0)
         + coalesce(sr.development_score, 0)
         + coalesce(sr.student_of_the_month_score, 0)
         + coalesce(sr.republic_wide_student_of_the_month_score, 0))    AS score,
       sr.grade                                                         AS grade
FROM student_results sr
GROUP BY sr.student_id, sr.year, sr.month, sr.grade;

-- Места учеников — внутри класса, как в v_student_places. Фильтра «score > 0» здесь нет:
-- у ученика с нулём место есть. Это отличает учеников от остальных уровней, и в годовой
-- версии ровно так же.
CREATE VIEW v_student_month_places AS
SELECT sc.student_id,
       sc.year,
       sc.month,
       dense_rank() OVER (PARTITION BY sc.year, sc.month, sc.grade
                          ORDER BY sc.score DESC)                       AS place,
       dense_rank() OVER (PARTITION BY sc.year, sc.month, sc.grade, s.district_id
                          ORDER BY sc.score DESC)                       AS district_place
FROM v_student_month_scores sc
JOIN students s ON s.id = sc.student_id;

-- ============================================================ учитель

-- Сумма баллов учеников учителя за месяц. Без average_score — см. шапку файла.
CREATE VIEW v_teacher_month_scores AS
SELECT t.id AS teacher_id,
       sc.year,
       sc.month,
       sum(sc.score) AS score
FROM teachers t
JOIN students s                ON s.teacher_id = t.id
JOIN v_student_month_scores sc ON sc.student_id = s.id
GROUP BY t.id, sc.year, sc.month;

CREATE VIEW v_teacher_month_places AS
SELECT ts.teacher_id,
       ts.year,
       ts.month,
       dense_rank() OVER (PARTITION BY ts.year, ts.month ORDER BY ts.score DESC)                   AS place,
       dense_rank() OVER (PARTITION BY ts.year, ts.month, t.district_id ORDER BY ts.score DESC)    AS district_place
FROM v_teacher_month_scores ts
JOIN teachers t ON t.id = ts.teacher_id
WHERE ts.score > 0;

-- ============================================================ школа

CREATE VIEW v_school_month_scores AS
SELECT sch.id AS school_id,
       ts.year,
       ts.month,
       sum(ts.score) AS score
FROM schools sch
JOIN teachers t                 ON t.school_id = sch.id
JOIN v_teacher_month_scores ts  ON ts.teacher_id = t.id
GROUP BY sch.id, ts.year, ts.month;

CREATE VIEW v_school_month_places AS
SELECT ss.school_id,
       ss.year,
       ss.month,
       dense_rank() OVER (PARTITION BY ss.year, ss.month ORDER BY ss.score DESC)                    AS place,
       dense_rank() OVER (PARTITION BY ss.year, ss.month, sc.district_id ORDER BY ss.score DESC)    AS district_place
FROM v_school_month_scores ss
JOIN schools sc ON sc.id = ss.school_id
WHERE ss.score > 0;

-- ============================================================ район (təhsil sektoru)

-- Сумма баллов школ района. Легаси-делитель среднего балла (ученики_района × школы_района),
-- который дословно воспроизведён в v_district_year_scores, сюда НЕ переносится — среднего
-- балла в месячном срезе нет вовсе, переносить нечего.
CREATE VIEW v_district_month_scores AS
SELECT d.id AS district_id,
       ss.year,
       ss.month,
       sum(ss.score) AS score
FROM districts d
JOIN schools sch                ON sch.district_id = d.id
JOIN v_school_month_scores ss   ON ss.school_id = sch.id
GROUP BY d.id, ss.year, ss.month;

-- district_place у района не существует ни в одном из путей — как и в v_district_places.
CREATE VIEW v_district_month_places AS
SELECT ds.district_id,
       ds.year,
       ds.month,
       dense_rank() OVER (PARTITION BY ds.year, ds.month ORDER BY ds.score DESC) AS place
FROM v_district_month_scores ds
WHERE ds.score > 0;

-- ============================================================ регион (regional təhsil idarəsi)

-- Район, не привязанный ни к одному региону (region_id IS NULL), в регион не попадает —
-- корректное поведение, как и в v_region_year_scores.
CREATE VIEW v_region_month_scores AS
SELECT r.id AS region_id,
       ds.year,
       ds.month,
       sum(ds.score) AS score
FROM regions r
JOIN districts d                 ON d.region_id = r.id
JOIN v_district_month_scores ds  ON ds.district_id = d.id
GROUP BY r.id, ds.year, ds.month;

CREATE VIEW v_region_month_places AS
SELECT rs.region_id,
       rs.year,
       rs.month,
       dense_rank() OVER (PARTITION BY rs.year, rs.month ORDER BY rs.score DESC) AS place
FROM v_region_month_scores rs
WHERE rs.score > 0;

COMMIT;
