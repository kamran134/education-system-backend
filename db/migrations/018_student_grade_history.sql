-- 018_student_grade_history.sql
-- Дата: 2026-09-01
-- Задача: SINIF_TARIXCESI_TASK.md — заказчик (Samir Vəliyev, WhatsApp 01.09.2026, второе
-- обращение по тому же поводу) второй раз жалуется, что после ежегодного повышения классов
-- (GradePromotionServicePg.execute()) реестры/статистика за ПРОШЛЫЙ учебный год показывают
-- ученика в его НОВОМ (живом) классе, хотя рейтинговые баллы за тот год он заработал в
-- старом. students.grade — живое поле без истории, и всё, что читает его в разрезе
-- конкретного учебного года, после повышения врёт задним числом.
--
-- Решение: отдельная таблица "в каком классе ученик был в таком-то учебном году" —
-- самостоятельный факт, а не побочный продукт экзаменационных результатов (это покрывало бы
-- только учеников, у которых в этом году были результаты). Пишет её повышение классов
-- (единственное место, где класс меняется массово, см. gradePromotion.service.pg.ts), а
-- прошлое здесь восстанавливается однократным бэкфиллом, ниже, в двух шагах.

BEGIN;

CREATE TABLE student_grade_history (
    student_id    bigint NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    academic_year int    NOT NULL,   -- год НАЧАЛА учебного года, как везде в схеме
    grade         int    NOT NULL,
    PRIMARY KEY (student_id, academic_year)
);

-- Шаг 1: прошлое — из результатов. v_student_year_scores уже даёт ровно одну строку на
-- (student_id, academic_year) и уже применяет правило "класс из самого позднего результата
-- в году" (009_student_year_scores_single_grade.sql). Берём тот же источник, что и
-- ранжирование (v_student_places), чтобы показываемый класс не разошёлся с классом, по
-- которому посчитано место.
INSERT INTO student_grade_history (student_id, academic_year, grade)
SELECT student_id, academic_year, grade
FROM v_student_year_scores;

-- Шаг 2: текущий 2026/2027 — из живого students.grade, только там, где результаты (шаг 1)
-- ещё не оставили строку за этот год: ON CONFLICT DO NOTHING значит, что результаты, если
-- они уже есть, побеждают.
--
-- Эти строки НЕ читаются, пока 2026/2027 — текущий год: класс за текущий год берётся из живого
-- students.grade (см. yearGradeExpr в student.service.pg.ts), иначе правка класса ученика в
-- середине года не была бы видна в списках. Они — заготовка архива на случай, если повышение
-- на 2027/2028 почему-то не запустят: тогда 2026/2027 всё равно останется читаемым годом.
-- Само повышение эти строки перезапишет свежими (снимок уходящего года, DO UPDATE).
--
-- 2026 здесь — не хардкод "на будущее", а буквально getCurrentAcademicYear() на дату этой
-- миграции (01.09.2026, сентябрь уже наступил). Допущение, без которого шаг 2 неверен:
-- повышение классов на 2026/2027 к моменту накатки этой миграции УЖЕ проведено
-- (grade_promotion_logs, academic_year = 2026, status = 'completed') — то есть живой
-- students.grade прямо сейчас и есть класс 2026/2027, а не 2025/2026.
INSERT INTO student_grade_history (student_id, academic_year, grade)
SELECT id, 2026, grade
FROM students
WHERE grade IS NOT NULL
ON CONFLICT (student_id, academic_year) DO NOTHING;

COMMIT;
