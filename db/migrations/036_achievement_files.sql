-- 036_achievement_files.sql
-- Дата: 2026-10-22
-- Задача: UGURLAR_FILES_TASK.md (FIXES_14102026_TASK.md №8, бэклог п.5) — владелец профиля
-- учителя/школы прикладывает к «Uğurlar» СВОИ файлы (сертификаты, грамоты, дипломы): PDF/JPG/PNG,
-- до 10 МБ на файл, до 20 файлов на профиль (лимиты проверяет приложение, не БД).
--
-- Видимость другим — только после одобрения модератором. Модерация идёт через тот же
-- profile_change_requests, что и текстовые поля: id добавляемых/удаляемых файлов лежат в payload
-- pending-заявки ключом achievementFiles { add: [], remove: [] }. Сама таблица профильную заявку
-- не меняет — entity_type 'teacher'/'school' там уже разрешены.
--
-- В отличие от profile_change_requests здесь настоящие FK (две nullable-колонки + CHECK на ровно
-- одного владельца): целостность важнее единообразия с полиморфной связью. При удалении
-- учителя/школы строки уходят каскадом; каталог на диске (uploads/achievements/...) чистит
-- usecase удаления сущности.
--
-- Файлы на диске лежат вне публичной статики и отдаются по подписанной ссылке
-- (achievementFile.service.pg.ts) — storage_name это только '<uuid>.<pdf|jpg|png>', путь строится
-- в коде из типа сущности и её id.
BEGIN;

CREATE TABLE achievement_files (
    id            bigserial   PRIMARY KEY,
    teacher_id    bigint      REFERENCES teachers(id) ON DELETE CASCADE,
    school_id     bigint      REFERENCES schools(id)  ON DELETE CASCADE,
    storage_name  text        NOT NULL UNIQUE,      -- '<uuid>.<pdf|jpg|png>'
    original_name text        NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
    mime_type     text        NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
    size_bytes    integer     NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
    has_thumbnail boolean     NOT NULL DEFAULT false,
    status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved')),
    uploaded_by   bigint      REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at   timestamptz NOT NULL DEFAULT now(),
    approved_by   bigint      REFERENCES users(id) ON DELETE SET NULL,
    approved_at   timestamptz,
    CONSTRAINT achievement_files_one_owner CHECK (num_nonnulls(teacher_id, school_id) = 1)
);

CREATE INDEX achievement_files_teacher ON achievement_files (teacher_id) WHERE teacher_id IS NOT NULL;
CREATE INDEX achievement_files_school  ON achievement_files (school_id)  WHERE school_id  IS NOT NULL;

COMMIT;
