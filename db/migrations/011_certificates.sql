-- 011_certificates.sql
-- Дата: 18.08.2026
-- Задача: CERTIFICATES_TASK.md §4 (именные сертификаты «İnkişaf edən şagird»)
--
-- Две таблицы:
--   certificate_templates — картинка шаблона + раскладка полей (координаты в px картинки),
--                            редактируется визуальным конструктором в админке.
--   issued_certificates    — снапшот на момент выдачи: копия картинки/раскладки/данных.
--                            Школа и учитель в схеме не историчны (нет FK на "школу на дату
--                            экзамена"), а статистику пересчитывают задним числом — без
--                            снапшота повторное скачивание давало бы другой документ.
--                            UNIQUE(student_result_id, award_code) — выдача идемпотентна.
--
-- serial — человекочитаемый номер на печать (ISIM-2026-000123), verify_token — отдельный
-- неугадываемый токен для публичной проверки по QR. Разделены сознательно: serial можно
-- перебрать подряд, token — нет.

BEGIN;

CREATE TABLE certificate_templates (
    id           bigserial PRIMARY KEY,
    award_code   text NOT NULL,                 -- 'developing_student' и далее (см. §12 п.4)
    level_code   text REFERENCES levels(code),   -- NULL, если награда не зависит от пилли
    name         text NOT NULL,
    image_path   text NOT NULL,                  -- uploads/certificates/<sha1>.jpg, файл иммутабельный
    image_width  int  NOT NULL,
    image_height int  NOT NULL,
    fields       jsonb NOT NULL DEFAULT '[]'::jsonb,
    active       boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- coalesce: NULL level_code (награда без градации по пилле) тоже должен быть уникален сам с собой
CREATE UNIQUE INDEX certificate_templates_award_level_uq
    ON certificate_templates (award_code, coalesce(level_code, ''));

CREATE SEQUENCE certificate_serial_seq;

CREATE TABLE issued_certificates (
    id                bigserial PRIMARY KEY,
    serial            text NOT NULL UNIQUE,    -- ISIM-2026-000123
    verify_token      text NOT NULL UNIQUE,    -- 12 символов base64url, для публичной проверки
    student_result_id bigint NOT NULL REFERENCES student_results(id) ON DELETE CASCADE,
    award_code        text NOT NULL,
    template_id       bigint NOT NULL REFERENCES certificate_templates(id),
    image_path        text  NOT NULL,          -- копия пути на момент выдачи
    image_width       int   NOT NULL,
    image_height      int   NOT NULL,
    layout            jsonb NOT NULL,          -- копия certificate_templates.fields на момент выдачи
    data              jsonb NOT NULL,          -- снапшот значений: ФИО, школа, класс, месяц и т.д.
    issued_at         timestamptz NOT NULL DEFAULT now(),
    revoked_at        timestamptz,
    revoke_reason     text,
    UNIQUE (student_result_id, award_code)
);

CREATE INDEX issued_certificates_result_idx ON issued_certificates (student_result_id);

COMMIT;
