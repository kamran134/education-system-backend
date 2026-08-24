-- 015_academic_year_closures.sql
-- Дата: 2026-08-24
-- Задача: ACADEMIC_YEAR_ARCHIVE_TASK.md §3 — закрытый учебный год нельзя пересчитать.
--
-- Зачем таблица, а не флаг в конфиге: закрытие — событие с автором и временем, его нужно
-- показывать в админке и предъявлять, если заказчик спросит «почему цифры такие».
-- closed_by NULL = закрыл не человек, а система 1 сентября (closed_reason = 'auto').
-- checksums — снимок контрольных сумм на момент закрытия (count(*) и sum(score) по каждой
-- из пяти *_year_ratings). Нужен, чтобы доказать, что архив не поехал: сравнить текущее
-- состояние с записанным можно в любой момент, не имея старого дампа.

BEGIN;

CREATE TABLE academic_year_closures (
    academic_year int         PRIMARY KEY,
    closed_at     timestamptz NOT NULL DEFAULT now(),
    closed_by     bigint      REFERENCES users(id),
    closed_reason text        NOT NULL DEFAULT 'manual' CHECK (closed_reason IN ('manual','auto')),
    note          text,
    checksums     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    CHECK (closed_reason = 'auto' OR closed_by IS NOT NULL)
);

COMMIT;
