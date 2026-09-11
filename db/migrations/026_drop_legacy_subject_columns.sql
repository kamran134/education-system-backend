-- 026_drop_legacy_subject_columns.sql
-- Дата: 2026-09-11
-- Задача: IMTAHAN_NOVLERI_TASK.md §20 — уборка легаси после переезда предметов/pillə на
-- справочники (023/024/025/025d). Единственная миграция серии, после которой пути отката,
-- кроме pg_dump, не остаётся: все предыдущие миграции оставляли старые данные рядом с новыми,
-- эта их физически удаляет.
--
-- Предполётная проверка на проде (§20.1, выполнена 11.09.2026, всё сошлось):
--   - суммы предметов (student_results.az/math/life_knowledge/logic/english vs
--     student_result_subject_scores) совпали по всем пяти до единицы;
--   - students.fullname vs склейка last_name/first_name/middle_name — 0 расхождений;
--   - строк student_results без легаси-az — 0 из 20 879 (новых импортов после 024 ещё не было);
--   - вьюх, зависящих от levels — нет; зависимостей от v_student_result_subject_scores — нет;
--   - НАЙДЕН живой FK на levels: certificate_templates.level_code -> levels(code). Это ради чего
--     и делалась проверка — не увидев её, эта миграция либо упала бы на DROP TABLE levels, либо
--     (при CASCADE) молча сняла бы ограничение с шаблонов сертификатов.
--
-- ПЕРЕД ПРИМЕНЕНИЕМ НА ПРОД эти проверки нужно прогнать ЗАНОВО — между написанием миграции и
-- её применением могли пройти новые импорты результатов.
--
-- Что удаляется:
--   - student_results: 10 колонок (az, math, life_knowledge, logic, english + их *_count).
--     Данные живут в student_result_subject_scores с 024_student_result_subject_scores.sql,
--     суммы сверены (§20.1). max_questions/score_percent/level/participation_score НЕ трогаются
--     (справочная сумма/процент по конкретной работе, заморозка §2 ТЗ) —
--     student_result_subject_scores тоже не трогается, это и есть новый дом данных.
--   - students: 4 колонки. last_name/first_name/middle_name переехали в fullname
--     (025b_student_fullname.sql), max_level перестал влиять на любое решение после §15
--     этого ТЗ (maxPriorBandRank считает "прошлый максимум" из student_results, а не из
--     lifetime-колонки без разбивки по типу экзамена).
--   - v_student_result_subject_scores — вьюха-совместимость на время переезда (024), читателей
--     не осталось уже с шага 2 (проверено grep'ом и повторно компилятором в этой задаче).
--   - levels — таблица целиком, заменена level_scales/level_scale_bands (023). Единственный
--     живой читатель в коде — levels.cache.ts::loadLevelsCache при старте приложения (снесён
--     этой же задачей), единственная зависимость на уровне схемы — FK из certificate_templates
--     (см. следующий пункт).
--
-- Порядок операторов (обязателен именно такой — IMTAHAN_NOVLERI_TASK.md §20.4):
--   1. certificate_templates -> level_scale_bands (ДО DROP TABLE levels, иначе она упадёт на
--      живом FK, либо CASCADE молча снял бы ограничение с шаблонов сертификатов).
--   2. DROP VIEW v_student_result_subject_scores.
--   3. student_results DROP COLUMN — все десять одним ALTER.
--   4. students DROP COLUMN — все четыре одним ALTER.
--   5. DROP TABLE levels.
-- Всё в одной транзакции: если упадёт что-то одно — не применится ничего.
--
-- Смысл шага 1: шаблон сертификата, градуированный по pillə (certificate_templates.level_code),
-- отвязывается от снесённой таблицы levels и привязывается к конкретной шкале level_scales —
-- как и student_results.level с 024. Композитный FK (level_scale_id, level_code) ->
-- level_scale_bands(scale_id, code) сходится, потому что level_scale_bands.isim_percent несёт
-- те же шесть кодов (E/D/C/B/A/Lisey), что и старая levels, а level_scale_id бэкфиллится
-- единственной существующей шкалой для всех НЕ-NULL level_code (award без градации по пилле
-- как был NULL/NULL, так и остаётся). certificate_templates_level_pair_chk фиксирует инвариант
-- на будущее: level_code и level_scale_id либо оба NULL, либо оба заданы — так работает и
-- certificate-template.service.ts::findActive/create после правки кода этой же задачи.
--
-- Код (§20.5, приведён в соответствие ДО этой миграции, проверено компилятором tsc после
-- ужесточения src/types/db.ts — полный список читателей см. отчёт по задаче):
--   - levels.cache.ts: loadLevelsCache/getLevelsCache/getLevelByCode/getLevelByScore и приватный
--     cache — удалены. getBands(scaleId)/getBandsByScaleCode(code) — единственный источник
--     правды про pillə. src/index.ts запускает только loadLevelScaleBandsCache() при старте.
--   - common.service.ts (calculateLevel/calculateLevelNumb), types/participation.types.ts
--     (calculateParticipationScore) — переведены на getBandsByScaleCode("isim_percent").
--     Единственный живой (недостижимый) читатель обеих функций — studentResult.service.ts
--     (Mongo, мёртвый код, не запускается) — переписаны ради компилируемости, не "починки".
--   - controllers/reference.controller.ts (GET /api/reference/levels) — та же замена; форма
--     ответа меняется (minPercent/maxPercent вместо minTotalScore/maxTotalScore) — эндпоинт
--     не вызывается фронтом (проверено grep'ом), ломать нечего.
--   - stats.service.pg.ts, examResults.service.pg.ts — JOIN levels as lvl ON lvl.code = sr.level
--     заменён на композитный JOIN level_scale_bands по (scale_id, code) — sr.level_scale_id.
--   - certificate-issue.service.ts — то же самое в raw SQL (JOIN levels lvl ON lvl.code =
--     sr2.level внутри prevLevel), которое tsc не мог поймать: строка "levels" в шаблонном
--     `sql` — не типизированный Kysely-запрос. Плюс buildData()/issueOrGet() теперь резолвят
--     шаблон по (award_code, level_scale_id, level_code), а не только (award_code, level_code).
--   - certificate-template.service.ts — CertificateTemplate.levelScaleId, findActive() и
--     create() учитывают шкалу (create() резолвит её через resolveExamTypeId() -> is_base ->
--     exam_types.level_scale_id, как и остальной код при единственной шкале в системе).
--   - student.service.pg.ts, studentResult.service.pg.ts — все чтения/записи max_level убраны
--     (интерфейсы Student/StudentCreate, create()/update(), studentMaxLevelUpdates при импорте
--     Excel, insert/lookup новых студентов).
--   - studentResult.service.pg.ts::importLegacyResultsFromJson (легаси JSON-импорт, §7/§9 ТЗ
--     "не трогаем" — но столбцов, в которые он писал баллы, физически больше нет): "не трогаем"
--     защищает логику сопоставления по ФИО/баллам/статусу, а не освобождает от снятия колонок.
--     ВАЖНО для истории: этот блок был "слепым пятном" компилятора — `const values = {...}`
--     с лишними полями (az/math/...), присвоенный переменной перед `.values(values)`, проходит
--     structural typing TypeScript без ошибки (excess property check работает только для
--     литералов, переданных НАПРЯМУЮ в вызов, а не через промежуточную переменную) — tsc молчал
--     бы, а INSERT/UPDATE упал бы в рантайме на "column az does not exist" при первом реальном
--     вызове этого маршрута после миграции. Найдено и исправлено вручную (не компилятором):
--     те же пять значений переписаны в student_result_subject_scores тем же фильтром по классу,
--     что и backfill 024 (lifeKnowledge/logic только 1-4, english только 5+), а не отброшены.
--
-- Проверка (§20.6, прогнана на локальном одноразовом Postgres — детали и результат см. отчёт по
-- задаче, а не эту шапку): применение миграции, наличие/отсутствие ожидаемых объектов схемы,
-- старт скомпилированного dist/index.js на той же базе (ключевая проверка — раньше
-- loadLevelsCache() читал levels при старте и без неё контейнер не поднимался бы), выдача
-- сертификата «İnkişaf edən şagird» через dist/ по новой связке (award_code, level_scale_id,
-- level_code).

BEGIN;

-- 1. certificate_templates -> level_scale_bands (ДО DROP TABLE levels).
ALTER TABLE certificate_templates ADD COLUMN level_scale_id bigint REFERENCES level_scales(id);
UPDATE certificate_templates SET level_scale_id = (SELECT id FROM level_scales WHERE code = 'isim_percent')
    WHERE level_code IS NOT NULL;
ALTER TABLE certificate_templates DROP CONSTRAINT certificate_templates_level_code_fkey;
ALTER TABLE certificate_templates ADD CONSTRAINT certificate_templates_level_band_fkey
    FOREIGN KEY (level_scale_id, level_code) REFERENCES level_scale_bands (scale_id, code);
ALTER TABLE certificate_templates ADD CONSTRAINT certificate_templates_level_pair_chk
    CHECK ((level_code IS NULL) = (level_scale_id IS NULL));

-- 2. Вьюха-совместимость 024 — читателей не осталось.
DROP VIEW v_student_result_subject_scores;

-- 3. student_results — десять легаси-колонок предметов, одним ALTER.
ALTER TABLE student_results
    DROP COLUMN az,
    DROP COLUMN math,
    DROP COLUMN life_knowledge,
    DROP COLUMN logic,
    DROP COLUMN english,
    DROP COLUMN az_count,
    DROP COLUMN math_count,
    DROP COLUMN life_knowledge_count,
    DROP COLUMN logic_count,
    DROP COLUMN english_count;

-- 4. students — четыре легаси-колонки.
ALTER TABLE students
    DROP COLUMN last_name,
    DROP COLUMN first_name,
    DROP COLUMN middle_name,
    DROP COLUMN max_level;

-- 5. levels — заменена level_scales/level_scale_bands, последняя зависимость (certificate_templates)
-- снята шагом 1 выше.
DROP TABLE levels;

COMMIT;
