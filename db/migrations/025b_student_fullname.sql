-- 025b_student_fullname.sql
-- Дата: 2026-09-10
-- Задача: SAGIRD_FULLNAME_TASK.md — ФИО ученика одной колонкой (students.fullname), по образцу
-- teachers.fullname (уже есть в схеме, включая teachers_name_trgm).
--
-- Зачем. Заказчик: «у учеников ФИО это отдельные колонки, нужно объединить, мы не ранжируем по
-- ним отдельно; одна колонка fullname, как у учителей». Порядок склейки — тот, что уже применяется
-- в коде в четырёх местах: [last_name, first_name, middle_name].filter(Boolean).join(" "), то есть
-- Soyad Ad Ata adı.
--
-- Номер 025b (не 026): 026 зарезервирована под снос легаси-колонок предметов
-- (IMTAHAN_NOVLERI_TASK.md §4). Суффикс-буква уже применялась (001b_levels_fk.sql),
-- apply-pending.sh берёт файлы по порядку имён — 025b встанет после 025.
--
-- Три старые колонки (last_name/first_name/middle_name) в этой миграции НЕ удаляются. Склейка
-- необратима (двойные фамилии, отсутствующее отчество разобрать обратно нельзя) — тот же приём,
-- что спас на предметах: новое поле заполняется, старое лежит рядом нетронутым, снос — отдельной
-- миграцией после недели работы прода. Это второй путь отката помимо pg_dump.
-- last_name/middle_name уже nullable; first_name был NOT NULL — снимаем, иначе новый код
-- (который его больше не заполняет) не сможет создать ученика.
--
-- Четыре места, которые эта миграция обязана закрыть, иначе они ломаются молча (SAGIRD_FULLNAME_TASK.md §2):
--
-- 1) user_settings.*_collumns text[] (11 колонок конфигов видимых колонок на роль/пользователя,
--    db/schema.sql) + user_settings.role_settings jsonb — В ТЕКСТЕ ЗАДАЧИ НЕ НАЗВАН ЯВНО, найден
--    по факту при разведке (userSettings.model.ts::IRoleSettings, roles-columns.component.ts):
--    это ТОТ ЖЕ класс бага, что и text[]-колонки — jsonb-объект {role: {tab: string[]}}, где
--    массивы на конце тоже содержат 'lastName'/'firstName'/'middleName' (простые ключи столбца
--    ученика) и составные 'studentData.lastName'/'studentData.firstName'/'studentData.middleName'
--    (вкладка examResults). Реально читается на фронте (roles-columns.component.ts,
--    stats.component.ts, exam-results.component.ts) для решения, какие колонки показывать —
--    не мёртвые данные. Обе формы схлопываются ниже той же функцией.
--
-- 2) profile_change_requests.payload jsonb, entity_type='student', status='pending' — висящие
--    заявки на смену ФИО, поданные до миграции. Только pending; approved/rejected — история,
--    не трогаем (SAGIRD_FULLNAME_TASK.md §8).
--
-- 3) students_name_trgm — индекс по выражению из last_name/first_name, пересоздаётся на fullname.
--
-- 4) Сертификаты — ПРОВЕРЕНО ФАКТИЧЕСКИ (certificate-issue.service.ts::buildData/issueOrGet):
--    studentFullName попадает в issued_certificates.data (jsonb) СНАПШОТОМ на момент выдачи и
--    рендерится из этого снапшота (renderPdf читает issued.data, не бьёт students заново). Уже
--    выданные сертификаты НЕ читают students.* при рендере — их менять не нужно и эта миграция
--    их не трогает. Код buildData() правится отдельно (не в этой миграции) на чтение fullname
--    напрямую — повлияет только на сертификаты, выданные ПОСЛЕ деплоя.

BEGIN;

ALTER TABLE students ADD COLUMN fullname text;

UPDATE students
SET fullname = NULLIF(btrim(
        concat_ws(' ', NULLIF(btrim(last_name), ''), NULLIF(btrim(first_name), ''), NULLIF(btrim(middle_name), ''))
    ), '');

-- first_name был NOT NULL, поэтому пустых fullname быть не должно — проверено фактически на
-- одноразовом кластере перед подтверждением миграции (SAGIRD_FULLNAME_TASK.md §7), не только
-- предположено: count(*) WHERE fullname IS NULL OR btrim(fullname) = '' дал 0.
ALTER TABLE students ALTER COLUMN fullname SET NOT NULL;

ALTER TABLE students ALTER COLUMN first_name DROP NOT NULL;

DROP INDEX students_name_trgm;
CREATE INDEX students_name_trgm ON students USING gin (fullname gin_trgm_ops);

-- ============================================================ §2.1: user_settings

-- Схлопывает text[]/jsonb-массив строк: любой ключ из keys[] схлопывается в merged на месте
-- ПЕРВОГО встреченного (порядок и позиция остальных ключей сохраняются), без дублей merged.
-- Массив без единого искомого ключа возвращается как есть (учителя/школы/районы и т.п. — не тронуты).
CREATE OR REPLACE FUNCTION pg_temp.collapse_name_keys(arr text[], keys text[], merged text) RETURNS text[] AS $$
DECLARE
    result text[] := '{}';
    inserted boolean := false;
    item text;
BEGIN
    IF arr IS NULL THEN RETURN NULL; END IF;
    FOREACH item IN ARRAY arr LOOP
        IF item = ANY(keys) THEN
            IF NOT inserted THEN
                result := result || merged;
                inserted := true;
            END IF;
        ELSE
            result := result || item;
        END IF;
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 11 text[]-колонок конфигов колонок — по одному UPDATE на колонку, WHERE ловит только строки,
-- где реально есть, что схлопывать (не трогает лишний раз ряды без имени ученика в конфиге).
UPDATE user_settings SET developing_student_collumns = pg_temp.collapse_name_keys(developing_student_collumns, ARRAY['lastName','firstName','middleName'], 'fullname')
    WHERE developing_student_collumns && ARRAY['lastName','firstName','middleName'];
UPDATE user_settings SET student_collumns = pg_temp.collapse_name_keys(student_collumns, ARRAY['lastName','firstName','middleName'], 'fullname')
    WHERE student_collumns && ARRAY['lastName','firstName','middleName'];
UPDATE user_settings SET all_student_collumns = pg_temp.collapse_name_keys(all_student_collumns, ARRAY['lastName','firstName','middleName'], 'fullname')
    WHERE all_student_collumns && ARRAY['lastName','firstName','middleName'];
UPDATE user_settings SET all_teacher_collumns = pg_temp.collapse_name_keys(all_teacher_collumns, ARRAY['lastName','firstName','middleName'], 'fullname')
    WHERE all_teacher_collumns && ARRAY['lastName','firstName','middleName'];
UPDATE user_settings SET all_school_collumns = pg_temp.collapse_name_keys(all_school_collumns, ARRAY['lastName','firstName','middleName'], 'fullname')
    WHERE all_school_collumns && ARRAY['lastName','firstName','middleName'];
UPDATE user_settings SET all_district_collumns = pg_temp.collapse_name_keys(all_district_collumns, ARRAY['lastName','firstName','middleName'], 'fullname')
    WHERE all_district_collumns && ARRAY['lastName','firstName','middleName'];
UPDATE user_settings SET all_region_collumns = pg_temp.collapse_name_keys(all_region_collumns, ARRAY['lastName','firstName','middleName'], 'fullname')
    WHERE all_region_collumns && ARRAY['lastName','firstName','middleName'];
UPDATE user_settings SET teacher_view_collumns = pg_temp.collapse_name_keys(teacher_view_collumns, ARRAY['lastName','firstName','middleName'], 'fullname')
    WHERE teacher_view_collumns && ARRAY['lastName','firstName','middleName'];
UPDATE user_settings SET director_view_collumns = pg_temp.collapse_name_keys(director_view_collumns, ARRAY['lastName','firstName','middleName'], 'fullname')
    WHERE director_view_collumns && ARRAY['lastName','firstName','middleName'];
UPDATE user_settings SET district_view_collumns = pg_temp.collapse_name_keys(district_view_collumns, ARRAY['lastName','firstName','middleName'], 'fullname')
    WHERE district_view_collumns && ARRAY['lastName','firstName','middleName'];
UPDATE user_settings SET student_view_collumns = pg_temp.collapse_name_keys(student_view_collumns, ARRAY['lastName','firstName','middleName'], 'fullname')
    WHERE student_view_collumns && ARRAY['lastName','firstName','middleName'];

-- role_settings jsonb: {role: {tab: string[]}} — рекурсивный обход без знания конкретных имён
-- ролей/вкладок (устойчиво к появлению новых ролей/вкладок в будущем): jsonb-массив строк
-- схлопывается той же логикой (через jsonb-обёртку над collapse_name_keys), объект обходится
-- по всем ключам рекурсивно, остальные типы (число/строка/null) не трогаются.
CREATE OR REPLACE FUNCTION pg_temp.collapse_name_keys_jsonb(arr jsonb, keys text[], merged text) RETURNS jsonb AS $$
DECLARE
    items text[];
BEGIN
    SELECT array_agg(value #>> '{}' ORDER BY ordinality) INTO items
    FROM jsonb_array_elements(arr) WITH ORDINALITY;
    IF items IS NULL THEN RETURN arr; END IF;
    RETURN to_jsonb(pg_temp.collapse_name_keys(items, keys, merged));
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.collapse_role_settings(node jsonb) RETURNS jsonb AS $$
DECLARE
    key text;
    result jsonb;
    collapsed jsonb;
BEGIN
    IF node IS NULL THEN RETURN NULL; END IF;
    IF jsonb_typeof(node) = 'array' THEN
        collapsed := pg_temp.collapse_name_keys_jsonb(node, ARRAY['lastName','firstName','middleName'], 'fullname');
        collapsed := pg_temp.collapse_name_keys_jsonb(collapsed, ARRAY['studentData.lastName','studentData.firstName','studentData.middleName'], 'studentData.fullname');
        RETURN collapsed;
    ELSIF jsonb_typeof(node) = 'object' THEN
        result := '{}'::jsonb;
        FOR key IN SELECT jsonb_object_keys(node) LOOP
            result := result || jsonb_build_object(key, pg_temp.collapse_role_settings(node -> key));
        END LOOP;
        RETURN result;
    ELSE
        RETURN node;
    END IF;
END;
$$ LANGUAGE plpgsql;

UPDATE user_settings SET role_settings = pg_temp.collapse_role_settings(role_settings)
    WHERE role_settings::text LIKE '%lastName%' OR role_settings::text LIKE '%firstName%' OR role_settings::text LIKE '%middleName%';

-- ============================================================ §2.2: заявки на смену ФИО (pending)

UPDATE profile_change_requests
SET payload = jsonb_build_object(
    'fullname',
    NULLIF(btrim(concat_ws(' ',
        NULLIF(btrim(payload->>'lastName'), ''),
        NULLIF(btrim(payload->>'firstName'), ''),
        NULLIF(btrim(payload->>'middleName'), '')
    )), '')
)
WHERE entity_type = 'student' AND status = 'pending';

COMMIT;
