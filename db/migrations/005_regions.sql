-- 005_regions.sql
-- Дата: 08.08.2026
-- Задача: REGIONS_TASKS.md (PHASE3 п.1б) — региональные управления образования (RTİ)
-- как новый уровень иерархии над районом.
--
-- Зачем: заказчик просит отдельную сущность "Regional Təhsil İdarəsi" со своим аккаунтом
-- и отдельным фильтром/вкладкой в рейтинге. См. REGIONS_TASKS.md §0 для решений,
-- зафиксированных заранее (делитель среднего балла, отсутствие каскадного удаления,
-- коды районов НЕ перенумеровываются).
--
-- ВАЖНО: коды районов остаются как есть. Регион получает собственное 2-значное кодовое
-- пространство (10-21), никак не связанное с 3-значными кодами районов.
--
-- ПРИВЯЗКА РАЙОН → РЕГИОН НЕ ДЕЛАЕТСЯ ЭТОЙ МИГРАЦИЕЙ (решение пользователя 08.08.2026).
-- Причина: dry-run (BEGIN...ROLLBACK на живых данных) вскрыл, что состав районов в проде
-- разошёлся со справочником 2024 года — есть Şabran (117) и Şərqi Zəngəzur (191, реальный
-- район с 1024 учениками и 16 школами), которых нет в исходном дампе, при этом Ağcəbədi (104)
-- и Ağsu (106) из дампа в проде не заведены вовсе. Особенно спорен Şərqi Zəngəzur — код
-- дословно совпадает с названием одного из 12 РТИ, но неясно, район это внутри РТИ или
-- ошибочно заведённая сущность самого РТИ. Пользователь решил: миграция заводит только
-- сущность region_id = NULL у всех районов, привязку каждого района к региону сделает
-- сам через UI (district-editing-dialog, см. REGIONS_TASKS.md шаг 10).

BEGIN;

-- ============================================================ сущность region

CREATE TABLE regions (
    id                       bigserial PRIMARY KEY,
    code                     bigint  NOT NULL UNIQUE,   -- 2 знака, собственное кодовое пространство
    name                     text    NOT NULL,
    region_of_the_year_score double precision DEFAULT 0,
    active                   boolean NOT NULL DEFAULT true,
    avatar_url               text
);

ALTER TABLE districts ADD COLUMN region_id bigint REFERENCES regions(id);
CREATE INDEX ON districts (region_id);

CREATE TABLE region_year_ratings (
    region_id      bigint NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    year           int    NOT NULL,
    score          double precision,
    average_score  double precision,
    place          int,                    -- district_place у региона не существует, как и у района
    PRIMARY KEY (region_id, year)
);

ALTER TABLE users ADD COLUMN region_id bigint REFERENCES regions(id);
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
    'superadmin','admin','moderator','districtRepresenter',
    'schoolDirector','teacher','student','regionRepresenter'));

-- Настройки колонок таблицы регионов в /stats — см. user_settings в schema.sql
ALTER TABLE user_settings ADD COLUMN all_region_collumns text[] NOT NULL DEFAULT '{}';

-- ============================================================ сид: 12 регионов (RTİ)
-- Названия — дословно из Regional Təhsil İdarələri və rayonları.docx (заказчик).
-- Районы к ним НЕ привязываются здесь — см. шапку файла.

INSERT INTO regions (code, name) VALUES
    (10, 'Abşeron – Xızı Regional Təhsil İdarəsi'),
    (11, 'Dağlıq Şirvan Regional Təhsil İdarəsi'),
    (12, 'Gəncə – Daşkəsən Regional Təhsil İdarəsi'),
    (13, 'Qarabağ Regional Təhsil İdarəsi'),
    (14, 'Qazax – Tovuz Regional Təhsil İdarəsi'),
    (15, 'Quba – Xaçmaz Regional Təhsil İdarəsi'),
    (16, 'Lənkəran – Astara Regional Təhsil İdarəsi'),
    (17, 'Mərkəzi Aran Regional Təhsil İdarəsi'),
    (18, 'Mil – Muğan Regional Təhsil İdarəsi'),
    (19, 'Şəki – Zaqatala Regional Təhsil İdarəsi'),
    (20, 'Şərqi Zəngəzur Regional Təhsil İdarəsi'),
    (21, 'Şirvan – Salyan Regional Təhsil İdarəsi');

-- districts.region (text) была NULL у всех 41 района (аудит 25.07.2026) и не читалась ни
-- одной бизнес-логикой — заменена на region_id.
ALTER TABLE districts DROP COLUMN region;

-- ============================================================ VIEWS: рейтинг региона
--
-- До ручной привязки районов эти views просто не дают строк ни для одного региона —
-- это корректное поведение (регион без районов не участвует в рейтинге), а не баг.

-- Регион: сумма баллов его районов. Делитель — ЖИВОЕ число учеников региона (решение
-- пользователя 08.08.2026), легаси-ошибка делителя из v_district_year_scores
-- (ученики_района × школы_района) сюда СОЗНАТЕЛЬНО не переносится.
CREATE VIEW v_region_year_scores AS
SELECT r.id AS region_id,
       ds.academic_year,
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
GROUP BY r.id, ds.academic_year, cnt.students_in_region;

-- Места: путь B — dense-rank по average_score, нули не ранжируются (см. rating-semantics.md).
CREATE VIEW v_region_places AS
SELECT rs.region_id,
       rs.academic_year,
       dense_rank() OVER (PARTITION BY rs.academic_year ORDER BY rs.average_score DESC) AS place
FROM v_region_year_scores rs
WHERE rs.average_score > 0;

COMMIT;
