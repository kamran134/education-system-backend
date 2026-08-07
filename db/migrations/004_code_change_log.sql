-- Каскадное обновление кодов teacher/school → потомки (student/teacher), + журнал изменений.
-- Задача заказчика (PHASE3_PLAN.md п.4): смена кода учителя авто-обновляет коды его учеников;
-- смена кода школы — коды её учителей и, каскадом, учеников этих учителей.
-- Дата: 2026-08-08

BEGIN;

CREATE TABLE code_change_logs (
    id                      bigserial   PRIMARY KEY,
    entity_type             text        NOT NULL CHECK (entity_type IN ('teacher','school','student')),
    entity_id               bigint      NOT NULL,
    old_code                bigint      NOT NULL,
    new_code                bigint      NOT NULL,
    -- NULL = прямая правка (корень каскада). Заполнено = эта строка изменилась потому, что
    -- изменился родитель (school → teacher, teacher → student) — см. code-cascade.util.ts.
    caused_by_entity_type    text       CHECK (caused_by_entity_type IN ('teacher','school')),
    caused_by_entity_id      bigint,
    changed_by               bigint     NOT NULL REFERENCES users(id),
    changed_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX code_change_logs_entity_idx ON code_change_logs (entity_type, entity_id);
CREATE INDEX code_change_logs_changed_at_idx ON code_change_logs (changed_at);

COMMIT;
