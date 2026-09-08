-- 025_ratings_by_exam_type.sql
-- Дата: 2026-09-08
-- Задача: IMTAHAN_NOVLERI_TASK.md §4, шаг 3 — рейтинги в разрезе типа экзамена.
--
-- Зачем. §2 ТЗ, решения 3 и 6: рейтинги учителей/школ/районов/регионов дробятся по типу
-- экзамена, очки за разные типы не смешиваются. Сегодня все пять *_year_ratings хранят одну
-- строку на (сущность, год) — если появится второй тип экзамена, его результаты неизбежно
-- попадут в тот же агрегат, что и базовый тип. Эта миграция:
--   1) добавляет exam_type_id в student_year_ratings/teacher_year_ratings/school_year_ratings/
--      district_year_ratings/region_year_ratings, бэкфиллит базовым типом (все существующие
--      строки принадлежат ему одному — расщепления НЕ происходит: было N строк, стало N строк,
--      проверено сверкой count(*)/sum(score) до и после, см. журнал приёмки);
--   2) расширяет PK каждой из пяти таблиц до (сущность, год, exam_type_id);
--   3) партиционирует по exam_type_id всю цепочку views (годовую и месячную) — GROUP BY у
--      *_scores, PARTITION BY у *_places.
--
-- Отступление от буквы ТЗ (см. IMTAHAN_NOVLERI_TASK.md §12 "хвост"/отчёт по шагу 3): §4 явно
-- называет только v_student_month_scores из месячной цепочки, но раз она получает exam_type_id
-- в GROUP BY, её грануляция меняется на (student, year, month, exam_type_id) — без такого же
-- добавления в v_teacher_month_scores/v_school_month_scores/v_district_month_scores/
-- v_region_month_scores (которые JOIN'ят её и суммируют sc.score) очки разных типов молча
-- смешались бы в одну сумму, что прямо противоречит §2 решению 6. Поэтому вся месячная цепочка
-- партиционирована по exam_type_id целиком, а не только студенческий уровень, как буквально
-- перечислено в тексте параграфа.
--
-- v_district_year_scores/v_district_month_scores: легаси-делитель среднего балла (students_in_district
-- × schools_in_district, см. 013_ratings_by_raw_score.sql и db/rating-semantics.md) остаётся
-- НЕ партиционированным по типу — это чистый count() учеников/школ района, к типу экзамена
-- никак не привязанный, трогать его не за чем и не велено (§9 ТЗ "не пересматривать").

BEGIN;

-- ============================================================ *_year_ratings: exam_type_id + PK

ALTER TABLE student_year_ratings ADD COLUMN exam_type_id bigint REFERENCES exam_types(id);
UPDATE student_year_ratings SET exam_type_id = (SELECT id FROM exam_types WHERE is_base);
ALTER TABLE student_year_ratings ALTER COLUMN exam_type_id SET NOT NULL;
ALTER TABLE student_year_ratings DROP CONSTRAINT student_year_ratings_pkey;
ALTER TABLE student_year_ratings ADD PRIMARY KEY (student_id, year, exam_type_id);

ALTER TABLE teacher_year_ratings ADD COLUMN exam_type_id bigint REFERENCES exam_types(id);
UPDATE teacher_year_ratings SET exam_type_id = (SELECT id FROM exam_types WHERE is_base);
ALTER TABLE teacher_year_ratings ALTER COLUMN exam_type_id SET NOT NULL;
ALTER TABLE teacher_year_ratings DROP CONSTRAINT teacher_year_ratings_pkey;
ALTER TABLE teacher_year_ratings ADD PRIMARY KEY (teacher_id, year, exam_type_id);

ALTER TABLE school_year_ratings ADD COLUMN exam_type_id bigint REFERENCES exam_types(id);
UPDATE school_year_ratings SET exam_type_id = (SELECT id FROM exam_types WHERE is_base);
ALTER TABLE school_year_ratings ALTER COLUMN exam_type_id SET NOT NULL;
ALTER TABLE school_year_ratings DROP CONSTRAINT school_year_ratings_pkey;
ALTER TABLE school_year_ratings ADD PRIMARY KEY (school_id, year, exam_type_id);

ALTER TABLE district_year_ratings ADD COLUMN exam_type_id bigint REFERENCES exam_types(id);
UPDATE district_year_ratings SET exam_type_id = (SELECT id FROM exam_types WHERE is_base);
ALTER TABLE district_year_ratings ALTER COLUMN exam_type_id SET NOT NULL;
ALTER TABLE district_year_ratings DROP CONSTRAINT district_year_ratings_pkey;
ALTER TABLE district_year_ratings ADD PRIMARY KEY (district_id, year, exam_type_id);

ALTER TABLE region_year_ratings ADD COLUMN exam_type_id bigint REFERENCES exam_types(id);
UPDATE region_year_ratings SET exam_type_id = (SELECT id FROM exam_types WHERE is_base);
ALTER TABLE region_year_ratings ALTER COLUMN exam_type_id SET NOT NULL;
ALTER TABLE region_year_ratings DROP CONSTRAINT region_year_ratings_pkey;
ALTER TABLE region_year_ratings ADD PRIMARY KEY (region_id, year, exam_type_id);

-- ============================================================ views: годовая цепочка

DROP VIEW IF EXISTS v_region_places, v_region_year_scores,
                     v_district_places, v_district_year_scores,
                     v_school_places, v_school_year_scores,
                     v_teacher_places, v_teacher_year_scores,
                     v_student_places, v_student_year_scores CASCADE;

-- Ученик: очки. exam_type_id добавлен в SELECT и GROUP BY — строка теперь на
-- (student, academic_year, exam_type_id, grade) вместо (student, academic_year, grade).
CREATE VIEW v_student_year_scores AS
SELECT sr.student_id,
       sr.academic_year,
       sr.exam_type_id,
       count(*)::int                                                    AS participation_count,
       sum(coalesce(sr.participation_score, 0))                         AS participation_score,
       sum(coalesce(sr.development_score, 0))                           AS development_score,
       sum(coalesce(sr.student_of_the_month_score, 0))                  AS student_of_the_month_score,
       sum(coalesce(sr.republic_wide_student_of_the_month_score, 0))    AS republic_wide_student_of_the_month_score,
       sum(coalesce(sr.participation_score, 0)
         + coalesce(sr.development_score, 0)
         + coalesce(sr.student_of_the_month_score, 0)
         + coalesce(sr.republic_wide_student_of_the_month_score, 0))    AS score,
       CASE WHEN count(*) > 0
            THEN sum(coalesce(sr.participation_score, 0)
                   + coalesce(sr.development_score, 0)
                   + coalesce(sr.student_of_the_month_score, 0)
                   + coalesce(sr.republic_wide_student_of_the_month_score, 0)) / count(*)
            ELSE 0 END                                                  AS average_score,
       sr.grade                                                         AS grade
FROM student_results sr
WHERE sr.academic_year IS NOT NULL
GROUP BY sr.student_id, sr.academic_year, sr.exam_type_id, sr.grade;

-- Ученик: места. PARTITION BY получает exam_type_id — классы 1-4/5-11 внутри разных типов
-- больше не конкурируют друг с другом (и не конкурировали бы даже без этого, но теперь это
-- гарантировано структурой запроса, а не совпадением набора типов).
CREATE VIEW v_student_places AS
SELECT sc.student_id,
       sc.academic_year,
       sc.exam_type_id,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.exam_type_id, sc.grade
                          ORDER BY sc.score DESC)                AS place,
       dense_rank() OVER (PARTITION BY sc.academic_year, sc.exam_type_id, sc.grade, s.district_id
                          ORDER BY sc.score DESC)                AS district_place
FROM v_student_year_scores sc
JOIN students s ON s.id = sc.student_id;

-- Учитель: очки. exam_type_id в GROUP BY — сумма баллов учеников учителя больше НЕ смешивает
-- разные типы экзаменов в одну сумму.
CREATE VIEW v_teacher_year_scores AS
SELECT t.id AS teacher_id,
       sc.academic_year,
       sc.exam_type_id,
       sum(sc.score) AS score,
       CASE WHEN t.student_count > 0 THEN sum(sc.score) / t.student_count ELSE 0 END AS average_score
FROM teachers t
JOIN students s               ON s.teacher_id = t.id
JOIN v_student_year_scores sc ON sc.student_id = s.id
GROUP BY t.id, t.student_count, sc.academic_year, sc.exam_type_id;

CREATE VIEW v_teacher_places AS
SELECT ts.teacher_id,
       ts.academic_year,
       ts.exam_type_id,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id ORDER BY ts.score DESC) AS place,
       dense_rank() OVER (PARTITION BY ts.academic_year, ts.exam_type_id, t.district_id ORDER BY ts.score DESC) AS district_place
FROM v_teacher_year_scores ts
JOIN teachers t ON t.id = ts.teacher_id
WHERE ts.score > 0;

-- Школа: очки. exam_type_id в GROUP BY.
CREATE VIEW v_school_year_scores AS
SELECT sch.id AS school_id,
       ts.academic_year,
       ts.exam_type_id,
       sum(ts.score) AS score,
       CASE WHEN sch.student_count > 0 THEN sum(ts.score) / sch.student_count ELSE 0 END AS average_score
FROM schools sch
JOIN teachers t                ON t.school_id = sch.id
JOIN v_teacher_year_scores ts  ON ts.teacher_id = t.id
GROUP BY sch.id, sch.student_count, ts.academic_year, ts.exam_type_id;

CREATE VIEW v_school_places AS
SELECT ss.school_id,
       ss.academic_year,
       ss.exam_type_id,
       dense_rank() OVER (PARTITION BY ss.academic_year, ss.exam_type_id ORDER BY ss.score DESC) AS place,
       dense_rank() OVER (PARTITION BY ss.academic_year, ss.exam_type_id, sc.district_id ORDER BY ss.score DESC) AS district_place
FROM v_school_year_scores ss
JOIN schools sc ON sc.id = ss.school_id
WHERE ss.score > 0;

-- Район: очки. exam_type_id в GROUP BY — сумма баллов школ района, по типу.
-- Легаси-делитель среднего балла (students_in_district × schools_in_district) остаётся
-- как есть, см. шапку файла — он не про экзамены, партиционировать нечего.
CREATE VIEW v_district_year_scores AS
SELECT d.id AS district_id,
       ss.academic_year,
       ss.exam_type_id,
       sum(ss.score) AS score,
       CASE WHEN cnt.legacy_divisor > 0 THEN sum(ss.score) / cnt.legacy_divisor ELSE 0 END AS average_score
FROM districts d
JOIN schools sch              ON sch.district_id = d.id
JOIN v_school_year_scores ss  ON ss.school_id = sch.id
CROSS JOIN LATERAL (
    SELECT st.students_in_district,
           sc2.schools_in_district,
           st.students_in_district * sc2.schools_in_district AS legacy_divisor
    FROM (SELECT count(*) AS students_in_district FROM students  WHERE district_id = d.id) st,
         (SELECT count(*) AS schools_in_district  FROM schools   WHERE district_id = d.id) sc2
) cnt
GROUP BY d.id, ss.academic_year, ss.exam_type_id, cnt.legacy_divisor, cnt.students_in_district;

CREATE VIEW v_district_places AS
SELECT ds.district_id,
       ds.academic_year,
       ds.exam_type_id,
       dense_rank() OVER (PARTITION BY ds.academic_year, ds.exam_type_id ORDER BY ds.score DESC) AS place
FROM v_district_year_scores ds
WHERE ds.score > 0;

-- Регион: очки. exam_type_id в GROUP BY.
CREATE VIEW v_region_year_scores AS
SELECT r.id AS region_id,
       ds.academic_year,
       ds.exam_type_id,
       sum(ds.score) AS score,
       CASE WHEN cnt.students_in_region > 0
            THEN sum(ds.score) / cnt.students_in_region ELSE 0 END AS average_score,
       cnt.students_in_region
FROM regions r
JOIN districts d               ON d.region_id = r.id
JOIN v_district_year_scores ds ON ds.district_id = d.id
CROSS JOIN LATERAL (
    SELECT count(*) AS students_in_region
    FROM students st
    JOIN districts d2 ON d2.id = st.district_id
    WHERE d2.region_id = r.id
) cnt
GROUP BY r.id, ds.academic_year, ds.exam_type_id, cnt.students_in_region;

CREATE VIEW v_region_places AS
SELECT rs.region_id,
       rs.academic_year,
       rs.exam_type_id,
       dense_rank() OVER (PARTITION BY rs.academic_year, rs.exam_type_id ORDER BY rs.score DESC) AS place
FROM v_region_year_scores rs
WHERE rs.score > 0;

-- ============================================================ views: месячная цепочка

DROP VIEW IF EXISTS v_region_month_places, v_region_month_scores,
                     v_district_month_places, v_district_month_scores,
                     v_school_month_places, v_school_month_scores,
                     v_teacher_month_places, v_teacher_month_scores,
                     v_student_month_places, v_student_month_scores CASCADE;

-- Ученик: очки за месяц. Оговорка из 022_student_month_scores_one_row.sql сохранена буква в
-- букву: grade берётся через min() и НЕ входит в группировку (иначе ученик с двумя результатами
-- в одном календарном месяце и разным grade расщепится на две строки с разбитым баллом).
-- exam_type_id, наоборот, ДОБАВЛЕН в группировку — это ровно то новое измерение, ради которого
-- задумана вся миграция; расширение группировки grade'ом остаётся под запретом, exam_type_id
-- под этот запрет не подпадает, у него другая природа (не атрибут ученика, а сама ось агрегации).
CREATE VIEW v_student_month_scores AS
SELECT sr.student_id,
       sr.year,
       sr.month,
       sr.exam_type_id,
       count(*)::int                                                    AS participation_count,
       sum(coalesce(sr.participation_score, 0)
         + coalesce(sr.development_score, 0)
         + coalesce(sr.student_of_the_month_score, 0)
         + coalesce(sr.republic_wide_student_of_the_month_score, 0))    AS score,
       min(sr.grade)                                                    AS grade
FROM student_results sr
GROUP BY sr.student_id, sr.year, sr.month, sr.exam_type_id;

CREATE VIEW v_student_month_places AS
SELECT sc.student_id,
       sc.year,
       sc.month,
       sc.exam_type_id,
       dense_rank() OVER (PARTITION BY sc.year, sc.month, sc.exam_type_id, sc.grade
                          ORDER BY sc.score DESC)                       AS place,
       dense_rank() OVER (PARTITION BY sc.year, sc.month, sc.exam_type_id, sc.grade, s.district_id
                          ORDER BY sc.score DESC)                       AS district_place
FROM v_student_month_scores sc
JOIN students s ON s.id = sc.student_id;

CREATE VIEW v_teacher_month_scores AS
SELECT t.id AS teacher_id,
       sc.year,
       sc.month,
       sc.exam_type_id,
       sum(sc.score) AS score
FROM teachers t
JOIN students s                ON s.teacher_id = t.id
JOIN v_student_month_scores sc ON sc.student_id = s.id
GROUP BY t.id, sc.year, sc.month, sc.exam_type_id;

CREATE VIEW v_teacher_month_places AS
SELECT ts.teacher_id,
       ts.year,
       ts.month,
       ts.exam_type_id,
       dense_rank() OVER (PARTITION BY ts.year, ts.month, ts.exam_type_id ORDER BY ts.score DESC)                   AS place,
       dense_rank() OVER (PARTITION BY ts.year, ts.month, ts.exam_type_id, t.district_id ORDER BY ts.score DESC)    AS district_place
FROM v_teacher_month_scores ts
JOIN teachers t ON t.id = ts.teacher_id
WHERE ts.score > 0;

CREATE VIEW v_school_month_scores AS
SELECT sch.id AS school_id,
       ts.year,
       ts.month,
       ts.exam_type_id,
       sum(ts.score) AS score
FROM schools sch
JOIN teachers t                 ON t.school_id = sch.id
JOIN v_teacher_month_scores ts  ON ts.teacher_id = t.id
GROUP BY sch.id, ts.year, ts.month, ts.exam_type_id;

CREATE VIEW v_school_month_places AS
SELECT ss.school_id,
       ss.year,
       ss.month,
       ss.exam_type_id,
       dense_rank() OVER (PARTITION BY ss.year, ss.month, ss.exam_type_id ORDER BY ss.score DESC)                    AS place,
       dense_rank() OVER (PARTITION BY ss.year, ss.month, ss.exam_type_id, sc.district_id ORDER BY ss.score DESC)    AS district_place
FROM v_school_month_scores ss
JOIN schools sc ON sc.id = ss.school_id
WHERE ss.score > 0;

CREATE VIEW v_district_month_scores AS
SELECT d.id AS district_id,
       ss.year,
       ss.month,
       ss.exam_type_id,
       sum(ss.score) AS score
FROM districts d
JOIN schools sch                ON sch.district_id = d.id
JOIN v_school_month_scores ss   ON ss.school_id = sch.id
GROUP BY d.id, ss.year, ss.month, ss.exam_type_id;

CREATE VIEW v_district_month_places AS
SELECT ds.district_id,
       ds.year,
       ds.month,
       ds.exam_type_id,
       dense_rank() OVER (PARTITION BY ds.year, ds.month, ds.exam_type_id ORDER BY ds.score DESC) AS place
FROM v_district_month_scores ds
WHERE ds.score > 0;

CREATE VIEW v_region_month_scores AS
SELECT r.id AS region_id,
       ds.year,
       ds.month,
       ds.exam_type_id,
       sum(ds.score) AS score
FROM regions r
JOIN districts d                 ON d.region_id = r.id
JOIN v_district_month_scores ds  ON ds.district_id = d.id
GROUP BY r.id, ds.year, ds.month, ds.exam_type_id;

CREATE VIEW v_region_month_places AS
SELECT rs.region_id,
       rs.year,
       rs.month,
       rs.exam_type_id,
       dense_rank() OVER (PARTITION BY rs.year, rs.month, rs.exam_type_id ORDER BY rs.score DESC) AS place
FROM v_region_month_scores rs
WHERE rs.score > 0;

COMMIT;

-- ============================================================================
-- Проверки (§8 ТЗ) — прогнать после применения:
--
-- 1) Расщепления исторических строк быть не должно: было N строк в каждой из пяти
--    *_year_ratings, стало N строк (все существующие принадлежат базовому типу):
--    SELECT count(*) FROM student_year_ratings;   -- и так же для teacher/school/district/region
--
-- 2) Чек-суммы закрытия года (academic_year_closures.checksums) должны сойтись до и после:
--    count(*)/sum(score) по каждой из пяти *_year_ratings за закрытый год не меняется миграцией,
--    добавляющей столбец и переносящей PK, — расхождение здесь означает откат по дампу.
-- ============================================================================
