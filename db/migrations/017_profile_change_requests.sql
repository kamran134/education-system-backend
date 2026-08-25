-- 017_profile_change_requests.sql
-- Дата: 2026-08-25
-- Задача: BASE_FIXES_TASK.md §2.4 — школа/учитель/район теперь сами вводят часть полей
-- своего профиля, но эти данные должны пройти подтверждение админа и быть невидимыми
-- никому, кроме владельца и админов, пока не подтверждены.
--
-- FK на саму сущность (school/teacher/district) намеренно нет — связь полиморфная
-- (entity_type + entity_id на три разные таблицы). При удалении сущности её заявку
-- подчищает код удаления в соответствующем usecase.
--
-- Уникальный индекс держит не более одной pending-заявки на сущность: повторное сохранение
-- владельцем перезаписывает payload существующей заявки, а не создаёт вторую в очереди.

BEGIN;

CREATE TABLE profile_change_requests (
    id            bigserial   PRIMARY KEY,
    entity_type   text        NOT NULL CHECK (entity_type IN ('school','teacher','district')),
    entity_id     bigint      NOT NULL,
    payload       jsonb       NOT NULL,
    status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    submitted_by  bigint      NOT NULL REFERENCES users(id),
    submitted_at  timestamptz NOT NULL DEFAULT now(),
    reviewed_by   bigint      REFERENCES users(id),
    reviewed_at   timestamptz,
    review_note   text
);

CREATE UNIQUE INDEX profile_change_requests_one_pending
    ON profile_change_requests (entity_type, entity_id)
    WHERE status = 'pending';

CREATE INDEX profile_change_requests_queue
    ON profile_change_requests (status, submitted_at DESC);

COMMIT;
